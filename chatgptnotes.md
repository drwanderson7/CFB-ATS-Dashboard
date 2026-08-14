# Notes for whoever (ChatGPT or otherwise) inspects this tool next

Read `handoff.md` (currently v18) first — that's the actual project state.
This file is just practical advice for working with this specific codebase
effectively. Also read `NEW_SESSION_START_HERE.md` in the repo root for
fast onboarding (habits, test-suite commands, current architecture) before
diving into `handoff.md`'s full version-by-version history.

**Renamed to PickGauge as of v18** (was "Edge Board"). If you're reading
an older audit/note that says "Edge Board," that's the project's former
name, not a different project. Two things NOT renamed, deliberately: the
Redis key names (`edge_board_shared_*`) and the localStorage key
(`cfb_edge_state_v1`) — renaming those would orphan every existing user's
data under the old key name, so they're staying as-is unless/until a real
migration gets built. Also: "Edge Board" is separately the name of one
specific TAB (as distinct from Snapshot/My Picks/Results) — that usage
predates and is unrelated to the old brand name, and correctly still says
"Edge Board" throughout the UI even after the rebrand.

## Getting the code into the conversation

This isn't a public repo you can just browse — you'll need Drew to paste in
files directly, or their contents. There's no build step, no bundler,
still — but as of v17, `app/index.html`'s frontend code is NOT one large
file anymore. It's `app/index.html` (markup + CSS + a small inline-script
preamble) plus 15 plain `<script src="...">` files it loads: 3 under
`app/data/` (static reference tables) and 12 under `app/js/` (the actual
logic — model.js, board.js, picks.js, odds.js, settings.js, record.js,
tabs.js, sync.js, pdf-import.js, pool-contexts.js, prediction-tracker.js,
init.js). If Drew pastes only `app/index.html`, you will NOT see most of
the app's actual logic — ask for the specific `app/js/*.js` file(s)
relevant to whatever you're working on, or all of them if you need the
full picture. Each file has its own header comment naming exactly what it
contains and what it depends on; `app/index.html` itself has a one-line
pointer comment at every spot code used to live, saying where it moved.
`api/*.py` files are unaffected by this — still separate files, same as
always.

## The one pattern that will look like a bug but isn't

Several pieces of logic are **deliberately duplicated** across files:

- `verify_user()` (JWT auth) exists identically in all 7 `api/*.py` files.
- `teamMatch()` / `TEAM_ALIAS` exists in both `index.html` (JS) and
  `api/grade_picks.py` (Python).

This is not an oversight — Vercel deploys each `api/*.py` file as an
isolated serverless function with no shared imports between them, so a
"shared utils module" isn't straightforwardly available the way it would be
in a normal app. If you spot the duplication and suggest consolidating it,
that's a reasonable instinct, but verify Vercel's actual constraints first
rather than "fixing" it into a shared import that might not deploy — this
exact drift already happened once this session (`TEAM_ALIAS` had two extra
entries in the JS copy that never made it to the Python copy) and was
caught by testing, not by code review. A v4-session pass considered
centralizing `verify_user()` into `api/_auth.py` and deliberately declined
(same reasoning — no way to verify a real Vercel deploy from a sandboxed
dev environment) in favor of `tests/test_auth_sync.py`, which AST-diffs
`verify_user()`/`_get_jwks_client()` across all 7 files and fails loudly on
real drift. Run it (`python3 tests/test_auth_sync.py`) after touching auth
code in any single file instead of eyeballing the other six.

## Don't trust a visual impression — measure it

Multiple things this session turned out different from how they looked at
first glance:

- A "color contrast" complaint was actually the color rendering exactly as
  intended (confirmed by sampling real pixel values from a screenshot) —
  the real issue was font-weight and size, not hue.
- A reported "logo positioning bug" was actually pixel-perfect (confirmed
  via `getBoundingClientRect()` in a real browser) — the illusion came from
  different logos having different internal proportions inside the same
  box.
- A genuine WCAG contrast failure (2.5:1 against a 4.5:1 requirement) was
  hiding in a color that "looked fine" until it was actually computed.

If you're asked to evaluate or fix anything visual, prefer actually
rendering it (a headless browser, or asking for a fresh screenshot after a
change) and/or computing real numbers over reasoning from the code or a
description alone.

## Testing methodology that worked well here

- **Playwright with a mocked Clerk session** is the way to exercise the app
  without real auth. Minimal mock:
  ```js
  window.Clerk = {
    user: { id: 'u', primaryEmailAddress: { emailAddress: 'test@example.com' } },
    session: { getToken: async () => 'fake.jwt' },
    load: async () => {}, mountSignIn: () => {},
    addListener: () => {}, signOut: async () => {},
  };
  ```
  Inject via `page.add_init_script()` *before* `page.goto()`, or the app's
  own sign-in gate (`#appRoot` stays `display:none` until Clerk resolves)
  will block everything.
- **Testing the Python endpoints without a real server or Vercel deploy**
  (added v4 session, see `tests/test_state.py`/`tests/test_grading.py`):
  instantiate the handler class directly via a thin subclass that
  overrides `__init__`/`send_response`/`send_header`/`end_headers` to skip
  `BaseHTTPRequestHandler`'s real socket machinery, set `self.path`/
  `self.headers`/`self.rfile`/`self.wfile` by hand, then call the real
  `do_GET`/`do_POST` and read the captured status/body. Monkeypatch
  `kv_get`/`kv_set` to an in-memory dict instead of hitting real Upstash,
  and monkeypatch `verify_user` to return fixed fake user IDs instead of
  validating real JWTs. This exercises the ACTUAL production code path,
  not a reimplementation of it.
- **Testing pure logic functions in index.html without a browser** (added
  v4 session, see `tests/test_client_logic.mjs`): don't hand-copy a
  function's logic into a test file — it can silently drift from the real
  file. Instead, parse `index.html`'s text to find `function name(` and
  walk forward counting brace depth to find the real matching close, slice
  that out, and `vm.runInContext()` it in Node with a minimal mocked
  `state` object. Same idea for `const NAME=...;` data tables — find the
  first real `;` after the value (careful: a trailing `// comment` before
  the newline can make a naive `;\n` search overshoot into the next
  statement — this exact bug happened and was caught by running the
  extracted code, not by reading the extraction logic).
- **After any CSS edit, check comment balance before moving on**:
  `style_block.count('/*') == style_block.count('*/')`. An unclosed
  comment silently disables everything after it with no error — this
  actually happened this session and quietly broke ~55 lines before being
  caught.
- **After any JS edit**, extract the largest `<script>` block and run
  `node --check` on it before claiming it works.
- **After any `str_replace`-style edit, re-read the surrounding lines
  immediately** rather than assuming the edit did only what was intended —
  an overly broad match in the v4 session silently deleted two working
  lines it shouldn't have; caught only because the diff was checked right
  after, not because the tool warned about it.
- For anything involving real-world data (team names, CFBD rosters, Odds
  API formats), prefer pulling the real current data over reasoning from
  training knowledge — team rosters, conference membership, and API
  formats all drift over time in ways a language model's training data
  won't reflect.

## Sensitive values

Clerk's **publishable key** is meant to be public/client-visible — safe to
leave in `index.html` as-is, don't treat it as a secret. Clerk's **secret
key** (if you ever see one) is not the same thing and should never end up
client-side. `CLERK_JWKS_URL`, `CRON_SECRET`, and the Upstash Redis
credentials are Vercel environment variables, not in the code at all.

## A sign-convention pattern worth knowing before you touch anything
   involving Model # or Vegas next to each other (found + fixed v15)

`myNumber()`/`weightedModel()` always return the model number in
home-team-spread convention — documented, deliberate, doesn't change
based on which side anyone picked. `edgeOf()`'s `e.line`, by contrast, IS
flipped to whichever side the model actually picked (`line=-V` for an away
pick). Any UI that puts a raw `myNumber()`/`myn` value directly next to
`e.line` with no adjustment will silently mix two different sign
conventions for every AWAY pick — it looks like a huge disagreement
between model and market when the real edge is small. This exact bug
existed in two places in the Snapshot tab (the condensed row's "Market →
Model" cell, and the expanded detail panel's "Market" column) and was
found by checking real screenshot numbers by hand before touching code,
not by reading the formula. If you're asked to add or debug anything that
displays Model # and a market line together, check which convention each
side is actually in before assuming they're comparable.

## `<details>` elements that get rebuilt on every render need special
   handling or they'll silently fight the user (found v15)

The "Weekly Setup" checklist card re-renders on nearly every state change
(any pick, checkbox, or refresh calls `renderBoard()`/`renderSnapshot()`,
both of which call `renderSetupStatus()`). A naive `el.innerHTML =
freshHTML` every time would recreate the `<details>` element from scratch
on every call, which means it'd always default back to collapsed —
silently closing a card the user had just manually expanded, the instant
they touched anything else on the page. Fix: check whether a `<details>`
node from the PREVIOUS render already exists as a child and reuse it in
place (only replace the `<summary>`/body innerHTML, never touch `.open`);
only build a fresh node (which defaults closed) the first time the card
enters that display mode. Verified this actually holds via
`element.open` checks in a real Playwright session in both directions, not
just asserted from reading the code. This pattern will come up again for
any other collapsible UI that's driven by frequently-recomputed state
rather than a one-time render.

## What's actually open right now (see handoff.md's "Known open items"
   section, v17, for the full numbered list)

Most concrete unresolved things as of v17: (1) which two of this app's
four Sagarin codes correspond to the 2-year backtest's #1/#2 systems
("Sagarin Points"/"Sagarin Ratings") — needed before those can get a
"★ Top 10" badge; (2) a real Upstash concurrent-write test for the v16
shared-key split and pool-publishing CAS — proven against a mocked
backend, not yet against production; (3) the Contact page's email is
still a literal placeholder (`contact@REPLACE-ME.example`); (4) test
coverage didn't grow with feature count in v16 — the Context Bar, error
boundary, and Weekly Setup's context-aware logic all have zero automated
tests, verified only via Playwright renders during the session that built
them; (5) a double-`+`-sign display bug in CLV numbers (v17) is fixed on
Snapshot but still present on the full Board tab and My Picks — same
one-line fix, just not yet applied there; (6) the v17 JS-splitting pass
(see below) is verified against a local server mimicking production's
exact URL shape, never against actual live Vercel static-file serving.
None of these are code-blocking on someone else's decision except
(1) and (3); the rest are just "still needs doing."

## app/index.html was split into 15 files (v17) — read this before
   assuming where any function lives

The single biggest structural change in this project's history. Was one
4,815-line file (markup + CSS + one inline `<script>` containing every
function); is now `app/index.html` (1,837 lines — markup, CSS, a small
shared preamble, and two order-critical invocation lines) plus 15 plain
`<script src="...">` files (3 static-data files under `app/data/`, 12
logic files under `app/js/`). No build step or bundler was introduced —
every file is still an ordinary global-scope script, loaded via absolute
paths (`/app/js/whatever.js`, not relative — the app is served at the
exact path `/app` with no trailing slash, and a relative path resolves
wrong there) in a fixed order before the main inline script runs. If
you're looking for a specific function and it's not in `app/index.html`,
check the one-line pointer comment left at its old location — it names
the exact file. One file (`app/js/init.js`) is a deliberate exception to
"moved 100% of its code": `initErrorBoundary()` and `bootstrap()` are
called immediately at the very start and very end of the app respectively
(not lazily, unlike everything else), so only their function DEFINITIONS
moved — the two invocations stay in `app/index.html` itself so error-
boundary registration still happens before anything else can throw. Full
details, including exactly what's in each file, are in
`NEW_SESSION_START_HERE.md`'s "JS-splitting pass" section and each split
file's own header comment.

## A click-outside-to-close listener can be defeated by the very click
   it's supposed to ignore, if that click's own handler mutates the DOM
   (found v16, Context Bar)

Standard pattern: `document.addEventListener("click", e => { if
(!container.contains(e.target)) close(); })`. This breaks if the thing
inside `container` that got clicked has an onclick handler that
re-renders (replaces via `innerHTML`) the DOM subtree it's sitting in —
which is common for anything showing live state (a counter, a label that
updates after the click). Sequence: click fires -> the element's own
onclick handler runs synchronously -> that handler re-renders and
DETACHES the original (currently-being-clicked) element from the
document -> event continues bubbling toward `document` -> the
document-level listener calls `container.contains(e.target)`, a LIVE
tree check -> the original element is no longer attached to ANYTHING, so
this reads as "outside," and the panel closes on its own click. Symptom
looks exactly like "my re-render logic has a bug" (which is where the
first debugging pass on this went) but the actual render logic was
correct the whole time — the bug was in the close-detection, not the
open state. Fix: use `event.composedPath()` instead of `.contains()`.
`composedPath()` captures the dispatch path at the START of the event,
before any handler has a chance to mutate the DOM, so a since-detached
node still correctly appears in it. Any future dropdown/popover/switcher
in this app that shows live-updating content inside itself should use
this pattern from the start, not discover it the hard way.

## Shared Redis state: one key per domain, not one combined blob (v16)

`fetch_odds.py`, `fetch_predictions.py`, and pool publishing used to all
read-modify-write the SAME key (`edge_board_shared`). Two endpoints
refreshing close together could silently overwrite each other's write —
real, not theoretical, and it had been sitting as an open item for
multiple sessions before actually getting fixed. The fix wasn't atomic
CAS on the shared blob (the obvious-seeming answer) — it was recognizing
that odds and predictions don't actually need to coordinate with each
other AT ALL, because they own completely disjoint fields. Splitting them
onto separate keys (`edge_board_shared_odds` / `_predictions`) makes the
cross-domain race structurally impossible, not just less likely, with a
plain `SET` for each (no CAS needed — see the v16 handoff section for why
that's safe for these two specifically). Pool publishing is different: it
IS a genuine multi-writer merge against a shared list, so that ONE got
real atomic CAS with retry. Lesson: before reaching for a bigger
concurrency primitive, check whether the writers actually need to see
each other's data at all — if not, separating the data removes the race
entirely instead of just handling it better.
