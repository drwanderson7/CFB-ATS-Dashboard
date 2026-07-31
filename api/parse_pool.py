"""
Vercel Python serverless function: POST /api/parse_pool

Parses a pool pick-sheet PDF exported from a hosted pool site and returns the
week's slate as JSON. Two sources are supported by design:

  - Splash Sports  (splashsports.com)  -- implemented, layout confirmed from a
    real Week-1 2026 export.
  - OfficeFootballPool (OFP)           -- stubbed; will be added once a real
    export is available. detect_source() routes to the right parser.

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

Response:
  {
    "source": "splash",
    "pickLimit": 7,                # from "0/7 picks made", or null
    "count": 43,
    "games": [
      {"away","home","commence","line","awaySpread","homeSpread"}, ...
    ]
  }
line is the home-perspective spread once locked (else null). awaySpread/homeSpread
keep the raw per-team values for when the sign convention is confirmed post-lock.
"""
from http.server import BaseHTTPRequestHandler
import json, re, io, os
import pdfplumber

MONTHS = {"Jan":1,"Feb":2,"Mar":3,"Apr":4,"May":5,"Jun":6,
          "Jul":7,"Aug":8,"Sep":9,"Oct":10,"Nov":11,"Dec":12}

# "Thu, Sep 3 • 5:00 PM" (the bullet may come through as • or similar)
HDR_RE = re.compile(r"^[A-Z][a-z]{2},\s+([A-Z][a-z]{2})\s+(\d{1,2})\s*[•·・]\s*(\d{1,2}):(\d{2})\s*([AP]M)")
# "Team Name(TBD)" or "Team Name(-3.5)" / "(+7)" ; excludes the "(0-0-0)" record line
TEAM_RE = re.compile(r"^(.*?)\((TBD|pk|PK|[-+]?\d+(?:\.\d+)?)\)\s*$")
RECORD_RE = re.compile(r"^\(\d+-\d+-\d+\)$")
PICKS_RE = re.compile(r"(\d+)\s*/\s*(\d+)\s+picks\s+made", re.I)


def _lines(pdf):
    out = []
    for pg in pdf.pages:
        t = pg.extract_text() or ""
        out += [l.strip() for l in t.split("\n") if l.strip()]
    return out


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
        pm = PICKS_RE.search(ln)
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


def detect_source(lines):
    blob = "\n".join(lines).lower()
    if "picks made" in blob or "spread locks" in blob:
        return "splash"
    # OFP detection to be added with a real sample
    return "splash"  # default; only Splash is implemented


def parse_pool_bytes(pdf_bytes, year):
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        lines = _lines(pdf)
    if not lines:
        raise ValueError("No readable text in this PDF.")
    src = detect_source(lines)
    if src == "splash":
        res = parse_splash(lines, year)
    else:
        raise ValueError(f"Unsupported pool source: {src}")
    if not res["games"]:
        raise ValueError("Couldn't find any games — is this a pool pick sheet?")
    return res


def parse_multipart(body, content_type):
    boundary = None
    for part in content_type.split(";"):
        part = part.strip()
        if part.startswith("boundary="):
            boundary = part[len("boundary="):].strip('"')
    if not boundary:
        return None, {}
    sep = ("--" + boundary).encode()
    fields = {}
    file_bytes = None
    for part in body.split(sep)[1:]:
        if b"\r\n\r\n" not in part:
            continue
        header_block, _, data = part.partition(b"\r\n\r\n")
        if data.endswith(b"\r\n"):
            data = data[:-2]
        hb = header_block.decode("utf-8", "ignore")
        if "filename" in hb:
            file_bytes = data
        else:
            nm = re.search(r'name="([^"]+)"', hb)
            if nm:
                fields[nm.group(1)] = data.decode("utf-8", "ignore").strip()
    return file_bytes, fields


def _authorized(handler):
    secret = os.environ.get("APP_SECRET")
    if not secret:
        return True
    if handler.headers.get("X-Edge-Key") == secret:
        return True
    cron = os.environ.get("CRON_SECRET")
    auth = handler.headers.get("Authorization") or ""
    if cron and auth == f"Bearer {cron}":
        return True
    return False


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200); self._cors(); self.end_headers()

    def do_POST(self):
        if not _authorized(self):
            self._respond(401, {"error": "Unauthorized — set the sync passphrase in Settings."})
            return
        ct = self.headers.get("Content-Type", "")
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        year = None
        if "multipart/form-data" in ct:
            pdf_bytes, fields = parse_multipart(body, ct)
            try:
                year = int(fields.get("year"))
            except (TypeError, ValueError):
                year = None
        else:
            pdf_bytes = body
        if not pdf_bytes:
            self._respond(400, {"error": "No PDF received"})
            return
        if not year:
            # default: current UTC year is fine for Aug-Dec CFB; caller should pass it
            from datetime import datetime, timezone
            year = datetime.now(timezone.utc).year
        try:
            self._respond(200, parse_pool_bytes(pdf_bytes, year))
        except Exception as e:
            self._respond(500, {"error": str(e)})

    def _cors(self):
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Edge-Key")

    def _respond(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status); self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers(); self.wfile.write(body)
