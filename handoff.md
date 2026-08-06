# CFB ATS Edge Board — Project Handoff (v2)

**What it is:** A personal college-football against-the-spread pick tool. Reads
Brad Powers' newsletter PDF, pulls live Vegas lines, computes a composite
"My #" per game, surfaces edges (including a fitted-to-real-data probability
model, new this session), tracks picks across pool entries, and auto-grades
results.

**Stack:** Static `index.html` (all UI + browser logic) + Python serverless
functions on Vercel. GitHub repo `drwanderson7/CFB-ATS-Dashboard` auto-deploys
to Vercel on push to `main`. Live at `cfb-ats-dashboard.vercel.app`.

**Everything described in the PRIOR handoff (pools, Splash pick-sheet import,
CLV, the ⚡ CLV+My# alignment flag, cross-pool pick comparison, the key-number
significance tier) is still live and unchanged in its mechanics** — this
document covers what changed and was added in the session since, plus a
critical bug found and fixed during handoff review. Read the prior handoff
first if you haven't; this one assumes it.

---

## 🚨 Fixed this session: `api/parse_pdf.py` was corrupted on GitHub

Found during handoff review, unrelated to any of this session's feature work:
the file at `api/parse_pdf.py` on `main` contained `grade_picks.py`'s content
— word for word — instead of the actual PDF-parsing code. **This meant
"Import Powers PDF" was broken in production**, silently, for an unknown
period before this was caught (GitHub's commit API rate-limited before the
exact commit/date could be identified). Root cause unconfirmed — most likely
a copy/paste mistake during a manual GitHub edit at some point, not caused by
anything in this session or the prior one's actual work.

**Fix:** the correct `api/parse_pdf.py` is included in this handoff, restored
from a verified-good backup and validated as correct Python before delivery.
Deploy it and confirm "Import Powers PDF" works again as your first step.

---

## New this session

### 1. Probability Edge ("Cover %" column) — real, fitted data, Phase 1 only

Replaces the earlier illustrative approach with an actual empirical model:

- Pulled 8 seasons (2018–2025) of CFBD `/games` and `/lines` data — 5,705
  FBS-vs-FBS games with usable closing spreads — via the CFBD API (free tier,
  no CLI needed; done manually through Hoppscotch + file uploads this
  session, not automated).
- Built a **bucketed cover-margin table**: for each spread-size bucket
  (0–3, 3.5–7, 7.5–13.5, 14–20.5, 21–27.5, 28+), the real empirical
  distribution of `(actual_margin − book_margin)`. This is embedded directly
  in `index.html` as `BUCKETED_COVER_TABLE` — no separate file to deploy,
  no fetch call, it's just JS data in the page.
- `probabilityCoverForGame(M, V)` shifts the appropriate bucket's
  distribution by how much your model (`M`) disagrees with the book (`V`),
  sums probability mass on your side, and reports `P(cover)`, edge vs. the
  -110 breakeven (52.38%), and EV. Sanity-checked against hand-verified cases
  before shipping (documented in-conversation, not in a test file).
- **Real finding, worth remembering:** cover-margin standard deviation is
  flat (~15.3–15.7 pts) across ALL spread buckets — no meaningful
  heteroskedasticity by spread size in the real data. Don't reintroduce a
  spread-scaled-variance assumption without re-checking this.
- **What this is NOT yet:** validated against your own composite's actual
  accuracy. It's calibrated against the market's historical behavior, not
  "My #" specifically. That's Phase 2 — needs a season of graded picks,
  residual-bucketing by your own model's edge size, blended with this
  baseline via sample-size-weighted shrinkage. Not started.
- The 28+ point bucket (n=363) is thin — treat its output with more
  skepticism than the other five buckets.

### 2. Key-number weights: illustrative → fitted

`KEY_NUMBER_WEIGHTS` used to be `{3:9,7:7,10:4,14:4,6:3,4:3,17:2}` — explicitly
documented in the code as made-up ordinal weights, not fitted to data. Now
fitted from the same 5,705-game CFBD pull:
`{3:9,7:7.47,10:4.05,14:3.65,21:3.31,17:3.27,4:3.14}`. Notably, **21 replaced
6** — 21 is genuinely more common (3.79% of games) than 6 (3.19%) in the real
data; the old illustrative list had this backwards.

### 3. "Raw edge" feature removed entirely

Was a secondary edge calc excluding Vegas from the model average (to show an
"undiluted" signal). Removed at your request — Vegas is always a component of
My #, so this comparison no longer made sense to show. `rawEdgeOf()` and its
only helper (`absFmt()`) are gone from `index.html`; the `.raw-edge` CSS class
survived because it's *also* used by the Cover % cell's "vs breakeven"
subtext — different feature, same class name, left alone.

### 4. Sortable columns

Every board header (Game, BP, Comp, Vegas, My #, Cover %, CLV, Edge) is
clickable — click to sort, click again to flip direction. On mobile (where
`<thead>` is hidden by the card layout), a dropdown + direction-toggle button
in the toolbar drives the identical `setSort()`/state machinery. Sort choice
persists in `state.sortKey`/`state.sortDir` and syncs like everything else.
Missing values always sort last regardless of direction.

### 5. Mobile layout — several iterations, final state

Went through multiple rounds based on screenshots of the actual deployed
site. Final layout per game card:
- Small team logos (see #6) flank a center column: matchup buttons (stacked,
  away over home) with the Edge line directly below them.
- A stats row below spans the same width: Vegas / My # / Cover % (3 cols,
  non-pool) or Vegas / CLV / My # / Cover % (4 cols, pool view via a
  `.pool-row` class), using explicit CSS grid placement, not
  `grid-template-areas` (the column count differs by context, easier to
  reason about with direct `grid-column`/`grid-row` placement per cell).
- BP/Comp/prediction-system inputs are hidden on mobile entirely (`.hide`
  class) — desktop-only inputs now; the phone view only shows
  decision-relevant numbers.
- Found and fixed a real pre-existing CSS specificity bug while doing this:
  a `tbody td{border-bottom:...}` desktop rule was beating the mobile
  `td{border:none}` override, showing a stray line through every mobile
  cell (most visible cutting across the new logos).
- All of this is scoped to `@media(max-width:720px)` — desktop table is
  untouched, plus desktop got its own fix this session: `.board{overflow-x:
  auto}` with a sticky Game column, so a wide table (many toggled prediction
  systems) scrolls horizontally instead of silently clipping off-screen.

### 6. Team logos (new feature, new file, needs a new env var)

- `api/fetch_teams.py` (new file) — server-side proxy to CFBD's `/teams`
  endpoint (Bearer-token auth, so it can't be a direct browser call without
  exposing the key). Trims the response to just `{school, logo}` pairs.
- **Requires a `CFBD_API_KEY` environment variable in Vercel** — same
  free-tier key you've been using in Hoppscotch. Without it, logos just don't
  appear; nothing else breaks (fetch fails silently, console warning only).
- Client-side: fetched once, cached in **its own separate `localStorage`
  key** (`cfb_edge_logos_v1`) — deliberately kept OUT of the synced `state`
  blob, since logos are identical shared reference data, not personal state,
  and would otherwise bloat every sync push for no reason. Re-checked for
  freshness every ~60 days, not on every load.
- Team matching reuses the existing `teamMatch()` function (same rigor as
  BP/PDF/predictions matching) — a wrong logo would be worse than no logo, so
  this deliberately doesn't use a cruder matcher just because it's cosmetic.
- Hidden entirely on desktop (`display:none` outside the mobile media query)
  — desktop already shows full team names, a small logo there would be
  redundant clutter, not a helpful addition.

### 7. Redis storage split — shared vs. private (see setup section below, THIS IS NOT DEPLOYED YET)

Built in response to a real forward-looking question: "if 20 people use this,
what's the right architecture?" Decided against fully independent per-user
tools (option B outright) in favor of **shared raw data, private
inputs/picks**:

| Tier | Contains | Written by |
|---|---|---|
| Shared (`edge_board_shared`, one fixed key) | Vegas odds pull, predictiontracker.com rows, fetch metadata | Currently: whoever clicks Refresh/Load Predictions. Should eventually be: a scheduled cron job only (not built yet — see open items) |
| Private (`edge_board_user_{handle}`, one key per person) | Picks, entries, pools, PDF-derived BP/Comp inputs, enabled systems, weights, thresholds, sort preference | Each person's own device(s) |

**Why PDF-derived inputs are private, not shared:** redistributing one
person's paid Powers newsletter numbers to everyone else using the tool would
be the licensing exposure flagged in the original handoff's "unresolved
strategic question" — this isn't just a data-modeling choice, it's the fix
for that specific risk.

**Identity model:** NOT a real login. A self-chosen "handle" (entered once
per device in Settings, same UX pattern as the existing sync passphrase) just
namespaces which private bucket a device reads/writes. The shared
`APP_SECRET` passphrase is what actually keeps outsiders out — the handle by
itself is not a security boundary; anyone with the passphrase could still
type a different handle and read/write that bucket. Fine for "you + up to ~20
trusted pool participants who all got the same passphrase from you," not a
general multi-tenant auth system.

**What changed under the hood:**
- `state.updatedAt` (single timestamp) → split into `state.sharedUpdatedAt`
  and `state.privateUpdatedAt`, each tier syncing independently against its
  own remote timestamp.
- `save()` = private-tier push (the vast majority of call sites — picks,
  entries, pools, inputs, weights, thresholds, sort). New `saveShared()` =
  shared-tier push, used only where `refreshLines()`/`fetchPredictions()`/the
  "Clear predictions" action actually mutate shared fields.
- `api/state.py` rewritten to take `?scope=shared` or `?scope=user&id=X`.
- `api/grade_picks.py` rewritten too — **this was a real gap I caught and
  fixed before it could become a silent regression**: the grading cron was
  still reading/writing the single old key, which would have meant grading
  silently stopped affecting anything once the client-side split shipped.
  Now iterates every user's private key, grading each against ONE shared
  Odds API scores pull (20 users still costs 1 API call per grading run, not
  20).
- Tested: a standalone Node script simulating a full state object through
  the actual field-splitting logic, confirming zero overlap between the two
  payloads, zero leakage of secrets or licensing-sensitive data into the
  shared tier, and full field coverage (every field in `state` accounted for
  by exactly one tier). Also exercised the actual Settings UI (handle
  save/pull/push flow) in a real headless browser — no exceptions, correct
  request URLs constructed (`scope=shared`, `scope=user&id=...`).

---

## Redis / Upstash — fully set up and verified

**Done, this session, in order:** Upstash Redis database connected to the
project (Production + Preview, `STORAGE_` prefix — code already matches
this, see note below) → `APP_SECRET`, `ODDS_API_KEY`, and `CFBD_API_KEY` all
set as environment variables → redeployed → passphrase + a per-device handle
entered in Settings on both computer and phone → **round-trip sync confirmed
working** (a change on one device showed up on the other). This is no longer
an open item — sync can be trusted with real season data going forward.

**For reference, since it's still relevant if anything ever needs
debugging:** Vercel injected the Redis credentials with a custom prefix,
`STORAGE_` (`STORAGE_KV_REST_API_URL`, `STORAGE_KV_REST_API_TOKEN`, etc.)
rather than the plain `KV_REST_API_URL`/`UPSTASH_REDIS_REST_URL` names.
`api/state.py` and `api/grade_picks.py` both check for all three naming
conventions, so this isn't something to redo — just worth knowing if a
future Redis reconnect ever changes the prefix again, since the code would
need a matching update the same way it did this time.

**Development environment note:** the Storage-tab connection only covers
Production + Preview — Development wasn't toggleable through that modal.
Not an issue: this project has no local dev workflow (all edits go through
GitHub's web editor, deploying straight to Production), so Development scope
genuinely isn't needed.

**Day-to-day behavior, now live:** work on one device → auto-push ~1.5s
after you stop → open on another device with the same handle → pulls on
load automatically. No export/import step. Nightly grading (Vercel Cron,
`vercel.json`, unchanged) writes back to the correct private key per person.

**One behavior to know, not a bug:** last-write-wins by timestamp, not a
merge. Editing the same tier on two devices near-simultaneously without
letting sync catch up between means the older edit gets silently
overwritten. Not a practical concern for one person on their own two
devices in normal use.

---

## OPEN ITEMS — carried over + new

**Highest priority:**
1. **Shared-tier writes still aren't cron-only.** Right now, anyone with the
   passphrase who clicks "Refresh lines" or "Load predictions" overwrites the
   shared bucket for everyone. Fine at 1 user (current state); becomes a
   real race-condition/API-quota risk at 20. The fix (a Vercel Cron job
   that's the *sole* writer of the shared tier, with clients only ever
   reading it) was discussed but not built — worth doing before actually
   inviting other people in.
2. **Team logos need visual confirmation.** `CFBD_API_KEY` is now set, so
   they should be rendering — but `api/fetch_teams.py` and the logo-matching
   code have never run against a real CFBD response (only synthetic
   placeholder logos in a sandboxed headless browser, no real network
   access, during the session it was built). First real check: open the
   board on mobile and confirm actual team logos show up, not broken
   image icons.
3. **Probability Edge is Phase 1 only** (market-calibrated, not
   your-model-calibrated) — see feature #1 above for what Phase 2 needs.
4. `kv_keys()` in `grade_picks.py` uses Redis's `KEYS` command to enumerate
   all users — fine at dozens of users, would need a different approach
   (Redis `SCAN`, or a maintained index key) at real scale.

**Carried over, still open, unchanged:**
5. Never tested in a real browser against live services end-to-end for the
   full flow — sync itself is now verified (see above), but the full
   sequence hasn't been: PDF import (now fixed), refresh lines, load
   predictions, Probability Edge numbers look sane, pick on 2 devices,
   archive, cron grade, all in one real week.
6. `migrateGameKeys` — still only ~29 of 130+ FBS teams verified for
   collision risk.
7. Splash OFP parser stubbed, pending a real post-lock sample; locked-spread
   sign convention + pool-pick grading against it not yet built.
8. The Sides/Harvill/Sides (2022) weighted-normal probability research
   thread from the prior handoff is superseded in spirit by this session's
   Probability Edge work, but was never formally reconciled — the
   prior-session prototype used a different (older, thinner) margin dataset
   (23,768 games since 1980, capped at |margin|≤40) than this session's
   CFBD pull (5,705 games, 2018–2025, no such cap observed in practice).
   Worth a quick read of that old section if anyone picks the theoretical
   thread back up, so effort isn't duplicated.
9. `README.md` exists locally (in the handoff zip) but was never pushed to
   GitHub — documentation-only, zero functional impact, low priority.


## Known-by-design limits (updated)
Last-write-wins sync (now per-tier, same limitation, smaller blast radius);
no real login (by design, handle-based namespacing only); PDF column
positions still x-anchored; no committed test suite; shared-tier writes not
yet cron-exclusive (#1 above).

## Files changed or added this session
```
index.html                  REPLACE — all features above are embedded here
api/parse_pdf.py            REPLACE — fixes the corruption bug, restores real parsing
api/state.py                REPLACE — shared/private scope split
api/grade_picks.py          REPLACE — per-user grading, was broken by the split otherwise
api/fetch_teams.py          NEW     — CFBD team logos proxy
```
Untouched this session: `api/fetch_odds.py`, `api/fetch_predictions.py`,
`api/parse_pool.py`, `requirements.txt`, `vercel.json`.
