# Notes for whoever (ChatGPT or otherwise) inspects this tool next

Read `handoff.md` (currently v4) first — that's the actual project state.
This file is just practical advice for working with this specific codebase
effectively.

## Getting the code into the conversation

This isn't a public repo you can just browse — you'll need Drew to paste in
`index.html` and the `api/*.py` files directly, or their contents. There's
no build step; `index.html` is one large file with inline `<style>` and
`<script>` — don't assume a framework or bundler is involved.

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

## What's actually open right now (see HANDOFF_v3.md for full detail)

The most concrete thing worth picking up: a live-site bug report (a native
browser credential popup, not from Vercel's own protection) was left
mid-diagnosis — Drew was asked to check DevTools Network tab for the
specific 401 response and its `WWW-Authenticate` header, but that hasn't
come back yet. If you get that information, it should point straight at
the cause.
