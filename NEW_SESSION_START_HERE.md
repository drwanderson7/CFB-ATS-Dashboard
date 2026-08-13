# Start here — CFB ATS Edge Board

This is a fast-onboarding doc for a new chat session. `handoff.md` has
the full version-by-version history (v4 through v15 as of this writing)
if you need the detailed "why" behind something — read this first, then
grep `handoff.md` for specifics as needed rather than reading it front
to back.

## What this project is

A college-football against-the-spread pick tool for Drew's weekly
pick'em pools. Single-file frontend (`app/index.html`) + Python
serverless functions on Vercel + Upstash Redis + Clerk auth, deployed
from GitHub (`drwanderson7/CFB-ATS-Dashboard`), auto-deploy on push to
main. Landing page at repo root (`index.html`), the actual app lives at
`app/index.html` served at `/app`.

## How Drew works

- Direct, all-caps for emphasis sometimes, pushes back on hedging. Keep
  answers concrete.
- GitHub web editor + Vercel auto-deploy — no local CLI, no `git`
  commands. Always deliver complete, ready-to-paste files, never diffs
  or "run this command" instructions.
- Uses both Claude and ChatGPT across sessions. `chatgptnotes.md` in the
  repo is the cross-AI source of truth for conventions — don't duplicate
  it into a Claude-specific skill (this was explicitly discussed and
  rejected: a second copy of the same knowledge that only one AI can see
  risks silently drifting from the real one).
- **Only updates `handoff.md` when asked.** Don't auto-update it after
  every change — he said so explicitly. This doc (`NEW_SESSION_START_HERE.md`)
  is the exception — always safe to keep current, it's not the detailed
  version log.
- Attach files individually in responses, not zipped, unless he
  specifically asks for a zip. When attaching `app/index.html`, call it
  out by name explicitly — the attachment UI can flatten the path and
  it's been confused with the root `index.html` (the landing page)
  before.

## Non-negotiable habits established this project (violating these has caused real bugs)

1. **Verify against the real file, not memory.** Multiple rounds where
   trusting an earlier assumption (about CSS scope, about a field
   surviving an archive function, about what a mock's parameters
   evaluate to) turned out wrong. Grep the actual current file before
   claiming something is or isn't already handled.
2. **Test with real execution, not just reasoning.** Playwright
   screenshots for anything visual; Node `vm`-extraction tests (see
   `tests/*.mjs`) that pull the ACTUAL function source out of
   `app/index.html` and run it, not a hand-copied reimplementation that
   could drift. Same pattern for Python (`tests/test_*.py` monkeypatch
   `kv_get`/`kv_set`/`kv_eval` and run the real handler code).
3. **Run the full test suite after every change, before delivering.**
   Currently 150 checks across 7 files. See "Test suite" below.
4. **Full syntax check on `app/index.html`'s inline `<script>` before
   claiming anything works** — extract it and run `node --check` on it.
   This has caught real syntax errors before screenshots would have.
5. **When inserting a new section into `handoff.md`, use the Python
   script-replace method shown below, not `str_replace`.** `str_replace`
   has twice consumed an adjacent markdown heading by accident when
   inserting a large block, silently corrupting the document structure.
   Always verify afterward with `grep -n "^## " handoff.md` and check for
   `\n\n\n\n` artifacts.
6. **Don't claim something is fixed on the live site.** This sandbox has
   no access to the real Vercel deployment, real Upstash Redis, real
   Clerk auth, or a real Chrome browser profile. Every fix in this
   project is "logic verified, live unverified" until Drew confirms it
   on the real deployment himself. Say so plainly rather than implying
   otherwise.

## handoff.md section-insertion pattern (copy this)

```python
python3 -c "
with open('handoff.md') as f:
    content = f.read()
with open('/tmp/new_section.md') as f:
    section = f.read()
anchor = '## Known open items (...)'  # exact current heading text
assert content.count(anchor) == 1, 'anchor not unique!'
content = content.replace(anchor, section + anchor)
with open('handoff.md', 'w') as f:
    f.write(content)
"
```
Then verify: `grep -n "^## " handoff.md` (check heading count/order) and
confirm no `\n\n\n\n` artifact.

## Test suite (150 checks as of v15)

```
python3 tests/test_state.py           # 28 — auth, atomic CAS, ownership
python3 tests/test_grading.py         # 24 — grading, provider game IDs
python3 tests/test_auth_sync.py       # 20 — cross-file drift detection
node tests/test_client_logic.mjs      # 15 — sportsbook resolution, EV
node tests/test_snapshot_logic.mjs    # 47 — Snapshot tab logic
node tests/test_mypicks_logic.mjs     # 12 — My Picks entry-review logic
node tests/test_pdf_error_handling.mjs # 4 — pdf.js failure messaging
```
Run all of these, every time, before delivering anything. No CI exists
yet (`npm test` / GitHub Actions is still an open item) — this is
manual, on purpose, until that's built.

## Current architecture, briefly

- **Private vs shared Redis tiers**: private (picks, entries, pools,
  BP/Comp inputs) is per-user via Clerk JWT-derived keys; shared (odds,
  predictions, published pools) is one bucket everyone reads. Private
  writes are now genuinely atomic (Lua/EVAL compare-and-set via Upstash's
  REST API, see `cas_write()` in `api/state.py` and `api/grade_picks.py`
  — duplicated across both files since Vercel functions can't share
  imports; a drift-check test in `test_auth_sync.py` keeps them in sync).
  **Shared-tier writes are still NOT atomic** (`fetch_odds.py`/
  `fetch_predictions.py`/pool publishing do read-modify-write on one JSON
  blob) — known open item, not yet fixed.
- **Grading** matches picks to final scores by The Odds API's own stable
  event ID first (`providerGameId`, added in v13), falling back to
  team-name matching for older picks or unmatched games.
- **Two tabs, shared computation**: Snapshot (quick-scan default view)
  and Edge Board (the original dense table) both call the same
  `edgeOf()`/`myNumber()`/`clvOf()`/`probabilityCoverForGame()` — never
  fork Snapshot-specific versions of these. Snapshot has its own
  dedicated mobile CSS scoped to `#tab-snapshot` — the full board's
  mobile CSS is scoped to `.board` — these were unscoped and colliding
  until v12, don't reintroduce that.
- **UI passes**: v8 (palette/hierarchy/buttons/badges), v9 (Snapshot
  layout restructure), v10 ("de-AI" — corner radii, de-badging, less
  uppercase), v11 (My Picks entry-review workspace), v12 (mobile CSS bug
  fix). Pass 3/4 items still open: model-agreement indicator,
  data-completeness indicators, pool-vs-market callout, entry review
  warnings, Results/learning dashboard.

## Known open items worth knowing immediately

Full list is in `handoff.md`'s "Known open items" section, but the two
biggest:
1. **Atomic CAS logic is proven correct against a mock, not against real
   Upstash.** No live credentials available in this environment to test
   against the real database.
2. **Shared-tier writes (odds/predictions/pool publishing) can still race
   each other** — recommended fix is moving off one JSON blob to a Redis
   hash. Not started.

Also: Drew mentioned a GitHub Actions check showing a red X next to
"Test snapshot" — this was reported but not yet investigated (no CI
exists in this repo yet, so it's unclear what check that actually is;
may be a Vercel deployment check surfaced in GitHub's UI, not a repo
test). Ask for a screenshot or more detail before assuming what it is.
