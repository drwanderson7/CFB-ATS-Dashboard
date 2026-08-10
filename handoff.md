# CFB ATS Edge Board — Project Handoff (v3)

**What it is:** A college-football against-the-spread pick tool. Reads Brad
Powers' newsletter PDF and Splash Sports/OFP pool sheets, pulls live Vegas
lines, computes a composite "Model #" per game, surfaces edges (with a
fitted-to-real-data probability model), tracks picks across pool entries,
and auto-grades results. Originally personal-use only; this session moved it
to real multi-user accounts.

**Stack (updated):** Static `index.html` (all UI + browser logic) + Python
serverless functions on Vercel + Upstash Redis. Auth is now **Clerk**
(email + password), replacing the old shared-passphrase system. GitHub repo
`drwanderson7/CFB-ATS-Dashboard` auto-deploys to Vercel on push to `main`.

**Read the prior handoff (v2) first if you haven't** — this document covers
what changed since, which is substantial: authentication was rebuilt from
scratch, and the UI went through a full visual pass. Everything in v2 not
mentioned here as changed is still accurate.

---

## 🔑 The big one: authentication was completely rebuilt this session

**Old system (v2, now fully removed):** one shared `APP_SECRET` passphrase
gated the whole API, and each person typed a self-chosen "handle" into
Settings to namespace their private Redis bucket. This was explicitly *not*
a real login — no verification a handle belonged to whoever typed it.

**What actually happened, concretely:** a handle typo during a routine
cache-clear silently pointed a real user at an empty bucket with zero
warning, which looked exactly like real data loss. That incident is what
triggered this rebuild — it wasn't a hypothetical concern, it was observed.

**New system: Clerk (email + password), invite mode currently set to
Public.** Every API request now requires a real, cryptographically-verified
JWT in an `Authorization: Bearer <token>` header. The private-tier Redis key
is derived from the **verified token's own subject claim**, never from a
client-supplied parameter — there is no longer any string a person can
mistype their way into someone else's (or an empty) bucket with.

### What you need to know to make sense of the code

- **`api/state.py` is the source-of-truth copy** of the JWT verification
  logic (`verify_user()`, using `PyJWT` + `PyJWKClient` against Clerk's
  public JWKS endpoint). This exact function is **duplicated in all 7
  `api/*.py` files** — Vercel deploys each as an isolated serverless
  function with no shared imports across files, so this duplication is
  deliberate, matching how `teamMatch()` is already kept in sync between
  `index.html` and `grade_picks.py`. If you ever change the verification
  logic, **you must update all 7 files identically** or they'll silently
  drift, exactly like the `teamMatch()` alias-table drift caught earlier
  this session (see "Key learnings" below).
- **`grade_picks.py` has dual auth**, not just JWT — it's hit two different
  ways: Vercel's own Cron scheduler (which sends a raw `CRON_SECRET` bearer
  token, Vercel's own convention, *not* a Clerk JWT) and manually from the
  app by a signed-in person clicking "Grade now." `_authorized()` in that
  file accepts either.
- **Env vars required now:** `CLERK_JWKS_URL` (format:
  `https://YOUR-DOMAIN.clerk.accounts.dev/.well-known/jwks.json`) must be
  set in Vercel. `CRON_SECRET` is still needed (Vercel Cron). `APP_SECRET`
  is no longer read anywhere — safe to remove, but harmless if left.
- **Real Clerk keys are already in `index.html`** (publishable key +
  domain `simple-monarch-32.clerk.accounts.dev`) — don't replace them with
  placeholders if regenerating this file; there was a real incident this
  session where a rebuilt file reverted to `pk_live_XXXX` placeholders
  because two working copies of the file drifted apart.
- **Legacy data migration:** `api/state.py` has a `claim_legacy` POST action
  (`?action=claim_legacy&legacy_id=<old handle>`) — reads the old
  `edge_board_user_{handle}` bucket and copies it into the new verified
  `edge_board_user_{clerk_id}` bucket. Refuses to overwrite if the new
  bucket already has real data, unless `force=1`. There's a UI for this in
  Settings → Account ("Used this app before real accounts existed?").
- **Sign-up mode:** currently **Public** (anyone with the link can create an
  account) — a deliberate choice made after weighing Restricted (invite-only)
  vs. Waitlist (request-and-approve, which Clerk supports natively) vs.
  Public. Easy to flip in Clerk's dashboard (Configure → Restrictions) if
  the link ever spreads further than intended.
- **Clerk is on the free/Development tier**, capped at 100 users. Moving to
  Production tier (needed past that cap) **requires a custom domain** —
  this was flagged but not acted on; domain purchase was explicitly
  deferred ("later").

---

## Other backend changes this session

- **Shared-tier writes now have a freshness guard** instead of being
  cron-exclusive. Before `refreshLines()`/`fetchPredictions()` hit a real
  external API, they pull the current shared state first; if it's under 30
  minutes old, they reuse it instead of spending an API call. (Cron-only
  writes were considered and rejected — Vercel's free tier caps cron at
  once/day, which would've meant stale lines for a whole day.)
- **`grade_picks.py`'s `kv_keys()` now uses Redis `SCAN`** instead of
  `KEYS` — non-blocking, cursor-based, doesn't lock the whole Redis
  instance while enumerating users. Tested against the real Upstash REST
  API format (path-segment commands, not query params — a wrong first
  attempt was caught before shipping).
- **Team-name matching hardened against real data, not assumptions.**
  Tested `teamMatch()` against the actual current 138-team FBS roster
  (pulled live from CFBD) instead of a hand-built list. Found and fixed 5
  real collisions (Texas vs. Texas-El Paso/Texas-San Antonio/Texas
  Christian, Nevada vs. Nevada-Las Vegas, Florida vs. Florida Intl) by
  adding missing entries to `SIGNIFICANT_TOKENS`. Also found and fixed
  real drift between the JS (`index.html`) and Python (`grade_picks.py`)
  copies of `TEAM_ALIAS` — two entries (`umass`, `miamifla`) existed in
  one but not the other.
- **Splash truncation matching fixed for cross-alias cases.** Splash
  truncates long team names (`"Eastern Michig…"`); the existing
  `teamMatchTrunc()` handled simple cases but failed when a truncated name
  needed to resolve through an alias to match a differently-spelled full
  name (e.g. Splash's `"Louisiana-Mon…"` vs. the board's own `"UL Monroe"`).
  Fixed with a bounded, alias-aware resolver — deliberately scoped to only
  the truncation path so it can't affect the main board-building/grading
  logic. Verified it doesn't introduce new collisions by stress-testing
  against the real roster at multiple truncation lengths.
- **BP and Comp are now toggleable**, not hardcoded-always-on. They're
  checkbox entries in the same Prediction Systems checklist as external
  systems, with a one-time migration so existing users' Model# numbers
  don't silently change when this shipped (both default to checked for
  anyone with pre-existing saved state). Real bug caught while building
  this: the toggle set is shared between BP/Comp and external
  predictiontracker systems, and `enabledSystemsOrdered()` didn't know to
  exclude the new "bp"/"comp" codes — this caused both a literal duplicate
  "Comp" column on screen and a live double-counting risk in the Model#
  composite. Fixed by filtering those codes out at the one function that
  feeds both the column rendering and the weighted average.
- **Shared test pools (new capability, not just a one-off):** any pool can
  now be published to the shared Redis tier via a "🔗 share for testing"
  button (visible when a pool is the active context). This pushes only the
  pool's *structure* — games, locked lines, name, pick limit — never
  entries or picks. Any signed-in user then sees it as a selectable context
  automatically, gets their own fresh empty entry, and their picks never
  sync back to the sharer or anyone else. A local pool with existing real
  picks is never overwritten by a later shared-pool pull, even if the
  shared version changes — verified with a mocked two-user round trip.

---

## UI: full visual pass this session

Multiple rounds, converging on:

- **Palette:** true black/green/white/grey (Tailwind-neutral grays, no
  blue/warm tint). Header and nav are near-black (`#171717`/`#0a0a0a`)
  instead of the old navy slate. Green (`#16A34A`) stays the only accent.
  Red/amber were deliberately **kept** for status colors (no-edge, CLV
  alignment flag) since those carry real meaning, not decoration.
- **Shape:** buttons, team-pick pills, cards, inputs, and badges are all
  more rounded/pill-shaped than before ("bubble" look), matching a
  reference Drew provided. Explicitly **did not** build the reference's
  permanent left sidebar or dark theme — judged too much mobile risk for
  the payoff, given this app is heavily mobile-optimized; Drew agreed.
- **Header/nav:** now spans full width edge-to-edge (an earlier "floating
  rounded card" treatment with side margins was tried and then reverted per
  explicit request). The small green accent tick before "EDGE BOARD" was
  removed entirely (flagged as reading like an AI-generated-design cliché).
- **Fonts:** the core board numbers (Vegas, Model#, CLV, every prediction-
  system column, the edge pill, team-button spread numbers) were moved from
  JetBrains Mono to Inter (matching the rest of the UI) and sized up
  noticeably (Model# 14→16px, Vegas 13→15px, prediction columns
  11.5→13.5px). `font-variant-numeric: tabular-nums` kept throughout so
  columns still align despite the font change.
- **Contrast fixed for real, not just eyeballed:** `--faint` (used broadly
  for secondary text — "live" labels, "vs breakeven" subtext, timestamps)
  was actually failing WCAG contrast outright (~2.5:1, computed, not
  estimated) against white. Now ~4.95:1. The team-button spread number and
  Vegas/Model#/prediction numbers were also darkened and bolded on top of
  that, since technically-passing contrast at a light font-weight still
  read as weak in practice.
- **Logos:** mobile shows large (56px) circular badges flanking each
  matchup card. Desktop went through two iterations — flanking columns
  first, then moved *inside* each team's own pick button (directly next to
  that team's name) after the flanking layout put the home-side logo in an
  ambiguous position between the game cell and the BP/Comp columns on a
  dense table.
- **Pick line (the actual recommendation on each card)** now gets a colored
  background tied to edge strength (green shades / red), reusing the exact
  same tokens as the strong/edge/no-edge legend — not a new color meaning.
  Bigger, bolder, centered text.
- **Key-number badge reworded** from `"major · 7,10"` to `"key #7,10 ·
  major"` — leads with what the numbers mean instead of an ambiguous word,
  since the explanatory tooltip never shows on mobile touch anyway.

### New UI features (beyond restyling)

- **Pick summary chip strip** at the top of the board (below Context/Picking
  For) — shows every current pick as a compact chip (`Team Line ×`).
  Clicking a chip scrolls to that game; clicking × removes the pick. Hidden
  when there are zero picks. Answers "what have I picked so far" without
  leaving the board.
- **"Compare picks" table fixed to actually show up.** This table already
  existed (entries as columns, games as rows, agreement highlighting) but
  required *every* entry to already have at least one pick before it would
  render at all — an entry with zero picks kept the whole table hidden.
  Now columns come from every entry directly; an empty entry just shows
  `—` in every row instead of hiding the comparison.
- **Onboarding copy improved.** The empty-state message and the "Import
  pool sheet" button tooltip now explicitly name Splash Sports and OFP as
  supported formats — previously the only guidance was about the Odds API
  key, with no mention of pool-sheet import at all, which is arguably the
  more important path for someone actually tracking a real pool.
- **Collapsible "How this works" panel** replacing an always-expanded
  block of reference text at the bottom of the board (same `<details>`
  pattern already used for Prediction Systems).
- **"Import Powers PDF" moved** from the main toolbar to sit directly next
  to the BP weight input in the Prediction Systems panel. **"Clear…"
  moved** from the main toolbar into Settings → Backup, next to "Reset all
  data" — both were judged as cluttering the primary board flow for
  infrequent actions.

---

## Real bugs found and fixed this session (worth knowing about)

- **Pool-view overflow pushing the home-team logo off-screen.** Root
  cause: two separate mobile CSS overrides (`td.edge`, `td.prob-cell`)
  changed their containers to wrapping flexboxes but never reset the
  `white-space: nowrap` inherited from their desktop rules. Harmless
  normally, but `prob-cell` specifically goes from spanning 2 columns
  (normal view) to 1 column in pool view (CLV takes a slot) — so the same
  latent bug only became width-binding there, which is why it took both
  "load a pool sheet" *and* a wide Cover% pill to trigger it.
- **A self-inflicted broken CSS comment.** An imprecise edit while adding
  desktop logos left an unclosed `/* ... ` comment that silently disabled
  ~55 unrelated lines of previously-working CSS (the Prediction Systems
  panel, week bar, CLV highlighting). Caught because the desktop logos
  weren't behaving as expected, traced to the actual cause via direct
  comment-balance checking rather than assumption, and fixed. **Lesson
  applied for the rest of the session:** every subsequent CSS edit was
  followed by a scripted `/* ` vs `*/` count check before moving on.
- **Vercel Hobby cron is capped at once/day** with imprecise timing —
  confirmed via search before designing the shared-tier freshness guard,
  which is why cron-exclusive shared writes were rejected in favor of the
  30-minute guard approach.

---

## Known open items (carried over + new)

1. **Custom domain** — not purchased. Needed to move Clerk off the
   Development tier's 100-user cap. Deferred, not forgotten.
2. **Probability Edge Phase 2** (calibrating the cover-margin model against
   "Model #"'s own historical accuracy, not just the market) — still
   deprioritized until a full season of graded picks exists.
3. **Splash locked-spread sign convention** — every Splash sample seen this
   session (including ones rebuilt for testing) has been **pre-lock** (all
   games show `TBD`). The actual post-lock number format/sign convention is
   still unconfirmed. Needs a real sample from after Wednesday 11am lock.
4. **A Chrome native credential popup was reported** on the live deployed
   site (small OS-style Basic Auth box, not a styled page — confirmed this
   rules out Vercel's own deployment protection, which uses a styled
   redirect, not raw HTTP Basic Auth). Diagnosis was left mid-stream:
   Drew was walked through checking DevTools → Network for the exact 401
   request and its `WWW-Authenticate` header, but hasn't reported back yet.
   **Needs following up** — nothing in the app code sets that header, so
   the actual source is still unidentified.
5. **Mid-session auth expiry isn't handled gracefully.** If a Clerk session
   expires while someone's actively using the app (not just at load), API
   calls start 401ing and the sync status says so, but nothing re-triggers
   the sign-in gate automatically — flagged in an audit, not yet fixed.
6. **Logo alt text is empty** (`alt=""`) — fine for decorative use, but
   these carry real meaning (which team), so a screen reader gets nothing.
7. **No visible failure state if the pdf.js CDN doesn't load** — PDF import
   would fail silently if cdnjs is blocked/down.
8. **`README.md`** still exists only locally, never pushed to GitHub — no
   functional impact, just documentation hygiene.

---

## Key learnings & principles (carried over from v2, still true, plus new ones)

- **Validate with real execution, not assumption or a syntax check.**
  Reinforced hard this session: the CSS comment bug, the Upstash SCAN
  path-vs-query-param mistake, the enabledSystemsOrdered() double-counting
  bug, and the "screenshot still shows old colors" investigation (which
  turned out to be a font-weight/size perception issue, confirmed by
  actually sampling pixel values rather than trusting a visual impression)
  were all things a plausible-looking implementation would have shipped
  wrong without checking against real rendered output or real data.
- **Don't fabricate — verify against the real thing.** The CFBD roster
  pull, the Upstash REST API format, the Vercel cron frequency limit, and
  the Clerk JWKS URL format were all confirmed via search or direct testing
  before being used, not assumed from general knowledge.
- **Duplicated code across Vercel's isolated functions is a known,
  accepted tradeoff** — not an oversight. `teamMatch()`/`TEAM_ALIAS` and
  now `verify_user()` are each duplicated across 7 files on purpose, with
  explicit comments pointing to the source-of-truth copy. This pattern
  will keep needing manual sync discipline; it already drifted once
  (caught) before this session even started.
- **Memory system holds the real Clerk keys** so future sessions don't
  regenerate the file with placeholders — this was a real, observed
  failure mode, not a hypothetical one.

---

## Files changed this session

```
index.html                  REPLACE — Clerk auth integration, full UI pass,
                             pick summary strip, compare-table fix, shared
                             pools, BP/Comp toggle, all bug fixes above
api/state.py                REPLACE — JWT verification (source-of-truth
                             copy), verified-identity key derivation,
                             claim_legacy migration endpoint
api/grade_picks.py          REPLACE — dual auth (JWT + cron secret), SCAN
                             instead of KEYS, TEAM_ALIAS/SIGNIFICANT_TOKENS
                             sync fixes
api/fetch_teams.py          REPLACE — JWT verification
api/fetch_odds.py           REPLACE — JWT verification
api/fetch_predictions.py    REPLACE — JWT verification
api/parse_pdf.py            REPLACE — JWT verification
api/parse_pool.py           REPLACE — JWT verification
requirements.txt            REPLACE — added PyJWT[crypto]==2.10.1
```
