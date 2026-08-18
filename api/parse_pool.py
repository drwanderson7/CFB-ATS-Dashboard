"""
Vercel Python serverless function: POST /api/parse_pool

Parses a pool pick-sheet into the week's slate as JSON. Sources supported:

  - Splash Sports  (splashsports.com)  -- implemented, layout confirmed from a
    real Week-1 2026 export.
  - ESPN College Pick'em (espn.com)    -- implemented, TWO input shapes:
      * espn_paste (RECOMMENDED, primary path): plain text copy-pasted
        directly from the live ESPN picks page. Confirmed against a real
        Week-1 2026 paste to be a clean, strictly sequential block per team
        -- [name, spread, record, picked%], away then home, repeating --
        with none of the two-column mess below. The one real trade-off:
        it carries NO kickoff date/time at all (every game's commence comes
        back null; the app already handles that gracefully elsewhere). The
        client sends {"format": "espn_paste"} to select this path
        explicitly -- see parse_espn_paste().
      * PDF export (fallback, best-effort): ESPN's page is genuinely
        two-column (a wide picks column + an unrelated "Related Games"/
        prizes/legal sidebar on the SAME page), unlike Splash's single
        column. extractPdfTextLines() (app/js/pool-contexts.js) drops the
        sidebar by x-position and clusters each row's remaining content by
        horizontal gap into away/home lines -- this correctly parses 9 of
        10 real Week-1 2026 games, with ONE known, understood failure mode:
        an unusually long away team name can shrink the visual gap between
        the two team cards below the clustering threshold and merge them
        onto a single line (confirmed: "Washington State Cougars" produced
        a 38px gap against a 40px threshold). A per-page fixed-column-split
        alternative was tried and rejected -- it fixes that case but
        incorrectly slices full-width rows (e.g. the "LOCKS @" header)
        in half instead, a strictly worse failure since it breaks every
        game on the page rather than one. Given the paste path above
        parses the same real export with zero edge cases, this PDF path is
        intentionally left as a best-effort fallback rather than chasing a
        second complexity pass for a rare edge case. See parse_espn().
  - OfficeFootballPool (OFP)           -- stubbed; will be added once a real
    export is available. detect_source() routes to the right parser.

INPUT SHAPE -- text lines, not a raw PDF file.
A Splash export is a screenshot-style PDF: ~230 lines of real text plus dozens
of jersey-icon images, which routinely pushes the file past 20MB. Vercel's
serverless functions have a hard 4.5MB request body limit on every plan (an
AWS API Gateway limit Vercel sits on top of) -- not configurable in
vercel.json, and a 24MB pick sheet blew through it by 5x, so every import
failed with 413 Content Too Large. The images were never needed for parsing:
extracting text in the BROWSER first (via pdf.js) and sending only that text
shrinks the request from ~23MB to ~5KB, comfortably under the limit, and is
the actual fix -- not a bigger limit, which doesn't exist to raise.

So this endpoint takes JSON: {"lines": [...text lines in reading order...],
"year": 2026}. It never touches pdfplumber or raw PDF bytes; text extraction
already happened client-side.

Splash export layout (clean text layer, one game per block):
    Thu, Sep 3 • 5:00 PM   Preview
    <Away Team>(<spread or TBD>)
    (0-0-0)
    <Home Team>(<spread or TBD>)
    (0-0-0)
Before the Wednesday spread lock every line reads "(TBD)"; after lock the number
appears in that slot. The footer "N/M picks made" gives the pool's pick limit.

Team names are sometimes truncated with an ellipsis in the export
("Eastern Michig…"); we return them verbatim and let the app prefix-match.

ESPN College Pick'em export layout (also screenshot-style; one game per
block, but the spread number is its own line and always a real number --
ESPN shows the current spread immediately, there is no Splash-style
pre-lock "TBD" state):
    SAT 9/5 • LOCKS @ 11:00 AM
    Who will win this matchup against the spread?
    +23.5
    Ohio Bobcats
    0-0
    36% Picked
    -23.5
    Nebraska Cornhuskers
    0-0
    64% Picked
    Preview • Spread Info FS1
Ranked teams carry a "#13 " prefix ("#13 Alabama Crimson Tide") which is
stripped. The "% Picked" line can be missing (seen in the real sample, on a
game that fell right at a page/screenshot boundary) so it is never required
-- only used as one of several "this isn't the team name" signals when
scanning forward from a spread line. The footer "N/M Picks Made" gives the
pool's pick limit (case-insensitive vs Splash's "picks made" -- one shared
regex covers both). A once-per-week "TIEBREAKER • ... • LOCKS @ ..." block
(total-points prediction, not a spread pick) is detected and skipped rather
than parsed as a game.

Response:
  {
    "source": "splash",   # or "espn"
    "pickLimit": 7,                # from "0/7 picks made" / "0/10 Picks Made", or null
    "count": 43,
    "games": [
      {"away","home","commence","line","awaySpread","homeSpread"}, ...
    ]
  }
line is the home-perspective spread once locked (else null). awaySpread/homeSpread
keep the raw per-team values for when the sign convention is confirmed post-lock.
"""
from http.server import BaseHTTPRequestHandler
import json, re, os, sys
import urllib.request
import jwt
from jwt import PyJWKClient

# See api/state.py's own GENERIC_SERVER_ERROR/_log_server_error() comment.
GENERIC_SERVER_ERROR = "Something went wrong processing that request — try again shortly."


def _log_server_error(context, exc):
    print(f"[api/parse_pool.py] {context}: {exc}", file=sys.stderr)

MONTHS = {"Jan":1,"Feb":2,"Mar":3,"Apr":4,"May":5,"Jun":6,
          "Jul":7,"Aug":8,"Sep":9,"Oct":10,"Nov":11,"Dec":12}

# "Thu, Sep 3 • 5:00 PM" (the bullet may come through as • or similar)
HDR_RE = re.compile(r"^[A-Z][a-z]{2},\s+([A-Z][a-z]{2})\s+(\d{1,2})\s*[•·・]\s*(\d{1,2}):(\d{2})\s*([AP]M)")
# "Team Name(TBD)" or "Team Name(-3.5)" / "(+7)" ; excludes the "(0-0-0)" record line
TEAM_RE = re.compile(r"^(.*?)\((TBD|pk|PK|[-+]?\d+(?:\.\d+)?)\)\s*$")
RECORD_RE = re.compile(r"^\(\d+-\d+-\d+\)$")
# "0/7 picks made" -- confirmed against a real Splash export, so this is primary.
PICKS_RE = re.compile(r"(\d+)\s*/\s*(\d+)\s+picks\s+made", re.I)
# Not every Splash pool is pick-7, and this app must never assume it is. Splash
# pools with a different pick count almost certainly phrase this line
# differently (a plausible guess: "3 of 10 picks", "Picks: 0/10") -- this
# fallback is UNVERIFIED (no real non-pick-7 sample has been seen yet). If
# neither pattern matches, pick_limit comes back None and the app ASKS the
# user rather than silently defaulting to 7 -- that's the real safety net,
# not this regex's coverage.
PICKS_RE_ALT = re.compile(r"(\d+)\s+of\s+(\d+)\s+picks", re.I)

# --- ESPN College Pick'em -------------------------------------------------
# "SAT 9/5 • LOCKS @ 11:00 AM" -- weekday abbreviation + numeric month/day,
# distinct from Splash's "Thu, Sep 3 • 5:00 PM" (month name + no "LOCKS @").
ESPN_HDR_RE = re.compile(
    r"^[A-Z]{3}\s+(\d{1,2})/(\d{1,2})\s*[•·・]\s*LOCKS\s*@\s*(\d{1,2}):(\d{2})\s*([AP]M)",
    re.I,
)
ESPN_TIEBREAK_RE = re.compile(r"^TIEBREAKER\b", re.I)
# A spread line stands completely alone on its own line -- "+23.5", "-3", "PK".
ESPN_SPREAD_RE = re.compile(r"^([+-]\d+(?:\.\d+)?|PK)$", re.I)
ESPN_RECORD_RE = re.compile(r"^\d+-\d+$")
ESPN_PICKED_RE = re.compile(r"^\d+%\s*Picked$", re.I)
# Ranked teams: "#13 Alabama Crimson Tide" -> strip the rank prefix. No
# space is required after the number -- a real export showed the rank
# glued directly onto the team name with no gap at all ("#13Alabama Crimson
# Tide"), not just a normal single space.
ESPN_RANK_PREFIX_RE = re.compile(r"^#\d+\s*")
# Static ESPN UI chrome that can end up sitting between a game's spread
# pair and its team-name pair when the export's sticky bottom bar ("0/10
# Picks Made" / "Submit Your Picks") happens to fall at a page/screenshot
# boundary mid-block -- confirmed against a real export. Neither line has
# any distinguishing shape (both are ordinary title-case-ish text, same as
# a real team name), so they need an explicit exact-ish match rather than
# a generic pattern -- without this, "Submit Your Picks" reads exactly like
# a plausible team name to the name-pair scan below.
ESPN_UI_CHROME_RE = re.compile(r"^(Submit Your Picks|Autofill)$", re.I)


def _espn_commence(month, day, hour, minute, ampm, year):
    try:
        m = int(month)
    except (TypeError, ValueError):
        return None
    h = int(hour) % 12
    if ampm.upper() == "PM":
        h += 12
    return f"{year:04d}-{m:02d}-{int(day):02d}T{h:02d}:{int(minute):02d}:00"


def _espn_is_noise(ln):
    """True for a line that can never be part of a name pair -- a record,
    a picked%, another spread, UI chrome, or the start of the next
    game/tiebreaker."""
    return bool(
        ESPN_RECORD_RE.match(ln) or ESPN_PICKED_RE.match(ln)
        or ESPN_SPREAD_RE.match(ln) or ESPN_HDR_RE.match(ln) or ESPN_TIEBREAK_RE.match(ln)
        or ESPN_UI_CHROME_RE.match(ln) or bool(PICKS_RE.search(ln)) or bool(PICKS_RE_ALT.search(ln))
    )


def parse_espn(lines, year):
    """Client-side extraction (extractPdfTextLines(), app/js/pool-contexts.js)
    splits each visual row into left-to-right clusters on a horizontal-gap
    threshold, so ESPN's side-by-side away/home team cards -- both on the
    SAME row in the source PDF -- arrive here as two separate, adjacent
    lines (away first, then home), not as one team's full spread/name/
    record/picked block followed by the other's (that would be true if
    away and home were stacked vertically, which is Splash's layout, not
    ESPN's). So per game, the two things this function actually needs --
    the spread pair and the name pair -- each show up as two CONSECUTIVE
    lines, but with an unpredictable amount of sidebar-bleed noise (single,
    unpaired lines -- "Total Prizes", "$86,000", "NFL Pick'em", etc.) drifting
    in around them, confirmed against a real Week-1 2026 export. This scans
    forward from each "LOCKS @" header for the first adjacent SPREAD/SPREAD
    pair, then the first adjacent non-noise/non-noise pair after that (the
    team names) -- skipping anything else in between -- rather than assuming
    a fixed line count or offset from the header.
    """
    games = []
    pick_limit = None
    i, n = 0, len(lines)

    while i < n:
        ln = lines[i]
        pm = PICKS_RE.search(ln) or PICKS_RE_ALT.search(ln)
        if pm:
            pick_limit = int(pm.group(2))
            i += 1
            continue
        h = ESPN_HDR_RE.match(ln)
        if not h:
            i += 1
            continue
        cur = _espn_commence(h.group(1), h.group(2), h.group(3), h.group(4), h.group(5), year)

        # Scan forward from just after this header for the spread pair, then
        # the name pair, bailing early if the next header/tiebreaker shows up
        # first (an incomplete block -- e.g. cut off at a page boundary --
        # is skipped rather than guessed at).
        j = i + 1
        spread_pair = None
        name_pair = None
        while j < n:
            cj = lines[j]
            if ESPN_HDR_RE.match(cj) or ESPN_TIEBREAK_RE.match(cj):
                break
            if spread_pair is None:
                if ESPN_SPREAD_RE.match(cj) and j + 1 < n and ESPN_SPREAD_RE.match(lines[j + 1]):
                    spread_pair = (cj, lines[j + 1])
                    j += 2
                    continue
                j += 1
                continue
            if name_pair is None:
                if not _espn_is_noise(cj) and j + 1 < n and not _espn_is_noise(lines[j + 1]):
                    name_pair = (cj, lines[j + 1])
                    j += 2
                    break
                j += 1
                continue
            break

        if spread_pair and name_pair:
            aw_s, hm_s = spread_pair
            aw = ESPN_RANK_PREFIX_RE.sub("", name_pair[0]).strip()
            hm = ESPN_RANK_PREFIX_RE.sub("", name_pair[1]).strip()
            games.append({
                "away": aw, "home": hm, "commence": cur,
                "line": _spread(hm_s),
                "awaySpread": _spread(aw_s), "homeSpread": _spread(hm_s),
            })

        i = j if j > i + 1 else i + 1  # always make forward progress

    seen, uniq = set(), []
    for g in games:
        k = (g["away"].lower(), g["home"].lower(), g["commence"])
        if k in seen:
            continue
        seen.add(k); uniq.append(g)
    return {"source": "espn", "pickLimit": pick_limit, "count": len(uniq), "games": uniq}


def _spread(raw):
    if raw is None:
        return None
    raw = raw.strip()
    if raw.upper() in ("TBD",):
        return None
    if raw.lower() == "pk":
        return 0.0
    try:
        return float(raw)
    except ValueError:
        return None


def _commence(mon_abbr, day, hour, minute, ampm, year):
    m = MONTHS.get(mon_abbr)
    if not m:
        return None
    h = int(hour) % 12
    if ampm.upper() == "PM":
        h += 12
    return f"{year:04d}-{m:02d}-{int(day):02d}T{h:02d}:{int(minute):02d}:00"


def parse_splash(lines, year):
    games = []
    cur = None            # current kickoff ISO
    pending = []          # [(name, spread_raw)] collected under current header
    pick_limit = None

    def flush():
        if len(pending) >= 2:
            (aw, aw_s), (hm, hm_s) = pending[0], pending[1]
            home_line = _spread(hm_s)  # home-perspective slot (sign confirmed post-lock)
            games.append({
                "away": aw, "home": hm, "commence": cur,
                "line": home_line,
                "awaySpread": _spread(aw_s), "homeSpread": _spread(hm_s),
            })

    for ln in lines:
        pm = PICKS_RE.search(ln) or PICKS_RE_ALT.search(ln)
        if pm:
            pick_limit = int(pm.group(2))
            continue
        h = HDR_RE.match(ln)
        if h:
            flush()
            pending = []
            cur = _commence(h.group(1), h.group(2), h.group(3), h.group(4), h.group(5), year)
            continue
        if RECORD_RE.match(ln):
            continue
        t = TEAM_RE.match(ln)
        if t:
            name = t.group(1).strip()
            if name and "picks made" not in name.lower():
                pending.append((name, t.group(2)))
    flush()

    # de-dupe (a repeated block shouldn't double a game)
    seen, uniq = set(), []
    for g in games:
        k = (g["away"].lower(), g["home"].lower(), g["commence"])
        if k in seen:
            continue
        seen.add(k); uniq.append(g)
    return {"source": "splash", "pickLimit": pick_limit, "count": len(uniq), "games": uniq}


def parse_espn_paste(lines, year):
    """Plain-text copy-paste from the live ESPN College Pick'em page (NOT
    the PDF export -- see parse_espn() above for why the PDF needs real
    coordinate handling). A browser copy-paste follows the page's own DOM
    order, which turned out to be a clean, strictly sequential block per
    team -- [name, spread, record, picked%] -- away then home, repeating,
    with no header/sidebar noise to fight at all. Confirmed against a real
    Week 1 2026 paste. Ranked teams still carry the same "#13" (no-space)
    prefix as the PDF export and are stripped the same way.

    Real trade-off, not a bug: this text carries NO kickoff date/time
    anywhere, unlike the PDF's "LOCKS @" header -- so every game's commence
    comes back None here. The app already handles a null commence
    gracefully elsewhere (e.g. a Powers-PDF-only board) by leaving the week
    label blank instead of guessing; same behavior applies here.
    """
    games = []
    pick_limit = None
    entries = []  # [(name, spread_raw), ...] in the order encountered
    i, n = 0, len(lines)
    while i < n:
        ln = lines[i]
        pm = PICKS_RE.search(ln) or PICKS_RE_ALT.search(ln)
        if pm:
            pick_limit = int(pm.group(2))
            i += 1
            continue
        if (ESPN_RECORD_RE.match(ln) or ESPN_PICKED_RE.match(ln) or ESPN_SPREAD_RE.match(ln)
                or ESPN_UI_CHROME_RE.match(ln) or ESPN_TIEBREAK_RE.match(ln) or ESPN_HDR_RE.match(ln)):
            i += 1
            continue
        # Candidate team name -- only real if the very next line is a spread.
        if i + 1 < n and ESPN_SPREAD_RE.match(lines[i + 1]):
            name = ESPN_RANK_PREFIX_RE.sub("", ln).strip()
            entries.append((name, lines[i + 1]))
            i += 2
            continue
        i += 1  # not a recognizable name/spread pair -- skip and move on

    for k in range(0, len(entries) - 1, 2):
        (aw, aw_s), (hm, hm_s) = entries[k], entries[k + 1]
        games.append({
            "away": aw, "home": hm, "commence": None,
            "line": _spread(hm_s),
            "awaySpread": _spread(aw_s), "homeSpread": _spread(hm_s),
        })

    seen, uniq = set(), []
    for g in games:
        k = (g["away"].lower(), g["home"].lower())
        if k in seen:
            continue
        seen.add(k); uniq.append(g)
    return {"source": "espn", "pickLimit": pick_limit, "count": len(uniq), "games": uniq}


def detect_source(lines):
    blob = "\n".join(lines).lower()
    # Check ESPN's markers FIRST -- an ESPN sheet's own footer ("0/10 Picks
    # Made") also contains the substring "picks made", which would otherwise
    # false-match Splash's check below.
    if "who will win this matchup against the spread" in blob or "make your picks against the spread" in blob:
        return "espn"
    if "picks made" in blob or "spread locks" in blob:
        return "splash"
    # OFP detection to be added with a real sample
    return "splash"  # default; only Splash and ESPN are implemented


def parse_pool_lines(lines, year, format_hint=None):
    """lines: list[str], already text-extracted client-side (see module docstring
    for why -- avoids the 4.5MB serverless body limit that a raw pick-sheet PDF,
    padded with jersey icons, routinely blows past).
    format_hint: optional explicit source from the client ("espn_paste" for
    a plain-text copy-paste from the live ESPN page, as opposed to lines
    extracted from its PDF export) -- bypasses detect_source()'s sniffing
    entirely when the client already knows exactly what it sent, since a
    paste has none of the PDF's own distinguishing markers ("LOCKS @",
    "who will win this matchup") to sniff for.
    """
    lines = [str(l).strip() for l in (lines or []) if str(l).strip()]
    if not lines:
        raise ValueError("No text lines received.")
    if format_hint == "espn_paste":
        res = parse_espn_paste(lines, year)
    else:
        src = detect_source(lines)
        if src == "splash":
            res = parse_splash(lines, year)
        elif src == "espn":
            res = parse_espn(lines, year)
        else:
            raise ValueError(f"Unsupported pool source: {src}")
    if not res["games"]:
        raise ValueError("Couldn't find any games — is this a pool pick sheet?")
    return res


# ---------------------------------------------------------------------------
# Access gate -- verified Clerk session token. This exact verify_user()
# function is duplicated in every api/*.py file (Vercel deploys each as an
# isolated function, no shared imports across files) -- api/state.py is the
# source-of-truth copy; keep this one in sync with it.
# ---------------------------------------------------------------------------
_CLERK_JWKS_URL = os.environ.get("CLERK_JWKS_URL")
_jwks_client = None


def _get_jwks_client():
    global _jwks_client
    if _jwks_client is None and _CLERK_JWKS_URL:
        _jwks_client = PyJWKClient(_CLERK_JWKS_URL)
    return _jwks_client


def verify_user(handler):
    auth = handler.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[7:]
    client = _get_jwks_client()
    if not client:
        return None
    try:
        signing_key = client.get_signing_key_from_jwt(token)
        payload = jwt.decode(token, signing_key.key, algorithms=["RS256"], options={"verify_aud": False})
        return payload.get("sub")
    except Exception:
        return None


# Rate-limit primitive duplicated from api/state.py -- see that file's
# comment on RATE_LIMIT_SCRIPT for the fixed-window design and why it
# fails open. No shared imports across Vercel functions (same reasoning
# as verify_user()'s own duplication above).
def _kv_creds():
    url = (
        os.environ.get("KV_REST_API_URL")
        or os.environ.get("UPSTASH_REDIS_REST_URL")
        or os.environ.get("STORAGE_KV_REST_API_URL")
    )
    token = (
        os.environ.get("KV_REST_API_TOKEN")
        or os.environ.get("UPSTASH_REDIS_REST_TOKEN")
        or os.environ.get("STORAGE_KV_REST_API_TOKEN")
    )
    return url, token


RATE_LIMIT_SCRIPT = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
if count > tonumber(ARGV[1]) then
  return 1
else
  return 0
end
"""


def _kv_eval(script, keys, args):
    base, token = _kv_creds()
    if not base or not token:
        return None
    body = json.dumps(["EVAL", script, len(keys), *keys, *args])
    req = urllib.request.Request(
        base,
        data=body.encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.loads(res.read().decode()).get("result")


def rate_limited(uid, bucket, limit, window_seconds):
    try:
        result = _kv_eval(RATE_LIMIT_SCRIPT, [f"ratelimit:{bucket}:{uid}"], [str(limit), str(window_seconds)])
        return result == 1
    except Exception:
        return False


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200); self._cors(); self.end_headers()

    def do_POST(self):
        uid = verify_user(self)
        if not uid:
            self._respond(401, {"error": "Unauthorized — please sign in again."})
            return
        if rate_limited(uid, "parse_pool", 10, 60):
            self._respond(429, {"error": "Too many requests — please wait a bit before trying again."})
            return
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length)
        try:
            body = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._respond(400, {"error": "Expected JSON body with a 'lines' array (text already extracted client-side)."})
            return
        lines = body.get("lines")
        format_hint = body.get("format")
        try:
            year = int(body.get("year"))
        except (TypeError, ValueError):
            from datetime import datetime, timezone
            year = datetime.now(timezone.utc).year
        try:
            self._respond(200, parse_pool_lines(lines, year, format_hint))
        except Exception as e:
            _log_server_error("parse_pool do_POST", e)
            self._respond(500, {"error": GENERIC_SERVER_ERROR})

    def _cors(self):
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def _respond(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status); self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers(); self.wfile.write(body)
