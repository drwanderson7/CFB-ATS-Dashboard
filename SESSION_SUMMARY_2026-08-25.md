# PickGauge — Session Summary, Aug 25 2026 (for ChatGPT handoff)

**Read `CURRENT_STATE.md` first — it's the single source of truth and has
been kept current through this session.** This note is a narrower,
narrative recap of just today's work, for a fresh ChatGPT session that
wants context without re-deriving it from a full repo diff.

Full test suite: **48/48 files passing, 1,551 checks** (confirmed by
direct execution, several times, after every change below — not assumed
safe from a mechanical-looking diff). Plus the separate 71-check
Playwright/Chromium browser suite (`tests/test_e2e_ui_behaviors.py`),
also re-run and passing after the script-loading changes specifically,
since that's exactly the kind of thing a real browser catches that a
Node-only test can't.

Three distinct pieces of work this session, in order:

---

## 1. Logo fix

The new logo files uploaded at the end of the prior session (Aug 24)
landed under new filenames (`android-chrome-*.png`, `favicon.ico`,
`favicon-32x32.png`, `favicon-16x16.png`, `apple-touch-icon.png`,
`mstile-150x150.png`) — those got wired up correctly for browser tabs and
`site.webmanifest`. But the actual **visible logo everywhere in the
app** — the header brand mark on all 9 top-level HTML pages plus
`app/index.html`, and the Open Graph/Twitter share image — is hardcoded
to `<img src="/icon-96.png">` and `og:image content=".../icon-512.png"`.
Those two specific files were still the OLD design and never got
touched.

**Fix:** overwrote `icon-96.png` and `icon-512.png` in place with
resized copies of the new design (sourced from `android-chrome-512x512.png`,
the only new upload matching the new design at high enough resolution to
downscale cleanly). Zero HTML changes needed anywhere, since every page
already pointed at those exact filenames — just the file contents
changed.

---

## 2. Security hardening pass

Four items requested explicitly, plus real breakage found and fixed
along the way:

- **CSP shipped.** Required externalizing the last inline `<script>`
  block in `app/index.html` first — moved ~500 lines to a new
  `app/js/main.js`, same position/load order (right after `init.js`,
  right before `</body>`). `vercel.json` now sends a real
  `Content-Security-Policy` header, built against Clerk's own
  documented CSP requirements (looked these up directly, not guessed).
- **HSTS shipped** too (`max-age=63072000; includeSubDomains`,
  deliberately not submitted to the browser preload list yet).
  `tests/test_vercel_headers.py` extended to pin both new headers
  alongside the original four.
- **PDF.js self-hosted.** Pulled the exact pinned version (3.11.174)
  from the matching `pdfjs-dist` npm package — byte-identical to what
  cdnjs was serving — into `app/vendor/pdfjs/`. Removes the last
  third-party script origin from the trust chain (this library parses
  arbitrary uploaded PDFs) and let the CSP's `script-src` stay narrow.
- **`/api/fetch_cfbd`'s `force=1` gated to admins only.** Added
  `is_admin(uid)` to `api/fetch_cfbd.py`, identical to `api/state.py`'s
  existing copy. A non-admin's `force=1` is silently downgraded to a
  normal cached request, not rejected — verified with a real functional
  test against `do_GET()`'s actual control flow, not just a source-text
  check. `tests/test_auth_sync.py` got a new drift check
  (`ADMIN_FUNCS`/`ADMIN_FILES`) so the two `is_admin()` copies can't
  silently diverge, same pattern as the file's existing `CAS_FUNCS`
  check.
- **`robots.txt` added** — `Disallow: /app/` (the P1 "noindex /app/"
  item), `/api/`, `/pricing.html` (defense-in-depth alongside its
  existing `noindex` meta tag).
- **SPF/DKIM/DMARC drafted, NOT applied** — new `DNS_EMAIL_SETUP.md` has
  exact record values sourced from Google's current Workspace docs, in
  the right order. This is DNS-only, no sandbox access to actually set
  it — needs Drew's hand on Vercel's DNS panel + Google Admin console.
- **The audited P0 HTML-injection claim in `board.js` — independently
  re-checked, still can't reproduce.** The one unescaped attribute
  (`data-pickteam="${g.key}"`) can only ever contain `[a-z0-9@]` by
  construction (`g.key` comes from `mkey()` → `norm()`, which strips
  everything else before the key exists). Matches the prior session's
  own "could not reproduce" finding. Recommend closing this as no-repro
  unless a concrete payload can actually be demonstrated against this
  specific attribute — if you (ChatGPT) originally flagged this and
  have a real payload, that's the thing to share, not the general
  concern.
- **Sagarin code mapping — a well-sourced proposed resolution, not
  applied to code.** Traced the backtest's unmapped #1 ("Sagarin
  Points") and #2 ("Sagarin Ratings") to real evidence: Sagarin's own
  site documents PREDICTOR "is also known as PURE_POINTS" (→ this app's
  `sagpred` code), and thepredictiontracker.com's own historical awards
  pages use "Sagarin Ratings" as a named winner distinct from
  Predictor/Golden Mean/Recent (→ this app's `sag` code, the overall
  combined rating). Not wired into `TOP_SYSTEM_RANKS` in `app/js/main.js`
  — the actual composite-score numbers for those two ranks aren't
  available in this session (only ranks 3/4/6/8/10 were ever provided),
  and a past session already flagged real caution about guessing wrong
  here. Full sourcing is in `CURRENT_STATE.md`'s priority item #5 —
  worth a look if you have a way to independently verify.

**Real test breakage found and fixed from the script extraction** (this
is the kind of thing worth double-checking if you pick up related work):
5 `.mjs` test files read `app/index.html`'s raw text and extract specific
functions out of it by name (`round1`, `PRED_SHORT`, etc.) — those
functions moved into `main.js` along with everything else in the old
inline block, so the extractors came up empty until fixed to also search
`main.js`'s content. `test_script_paths.mjs`'s hardcoded "3 external CDN
scripts" count also needed updating to 2 (pdf.js is no longer external).
All caught by actually running the suite, not assumed safe.

---

## 3. Homepage copy — three rounds of iteration with Drew

Three real corrections came out of this, worth reading in order if you
touch homepage copy again:

1. **First draft removed the Brad Powers mention** (per Drew's explicit
   instruction — matches the "de-spotlighted" treatment already applied
   everywhere else in the app after an earlier licensing-risk
   discussion) and reframed around "20 of the best prediction systems."
2. **Drew corrected the first draft**: it implied PickGauge automatically
   combines all 20 into one composite by default. It doesn't —
   `state.enabledSystems` defaults to an **empty array** (confirmed
   directly in code, `app/js/main.js`'s `normalizeState()`). Nothing is
   on until the user actively toggles it in the Prediction Systems
   panel. Revised copy to "you choose which ones to use, set your own
   weights" instead of implying an automatic blend.
3. **Drew asked for more emphasis on the pool-import use case** — PDF
   upload (Splash Sports/ESPN Pick'em), ESPN paste-text import, or
   manual game selection for any other pool were real, fully-built
   features but underrepresented on the homepage (mentioned once,
   generically, with no explanation of *how*). Rewrote "How it
   works" STEP_01 (was "Load the slate," generic) to "Import your pool"
   and capability card 03 (was "Pool-Specific Lines") to "Import Any
   Pool," both now explicitly naming the three import paths.

**Final homepage copy, for reference** (all in `index.html`, the
marketing page, not `app/index.html`):
- Hero headline: "Pick your models. Set your weights. Find your edge."
- Hero subhead: "PickGauge brings 20 of the best college football
  prediction systems into one dashboard. You decide which ones count and
  how much—then see exactly where your own composite disagrees with the
  market, for your office pool or your own bets."
- Meta description / og:description / twitter:description: all rewritten
  consistently, no more Brad Powers mention or "~40" (was inaccurate —
  20 is the actual curated default set, `FEATURED_SYSTEM_CODES`).
- STEP_01: "Import your pool" — PDF upload or manual selection.
- STEP_02: "Build your model" — no more Brad Powers mention, "choose
  from 20... set your own weights."
- Capability card 03: "Import Any Pool" — names all three import paths
  explicitly (Splash PDF, ESPN PDF, ESPN paste, manual for anything
  else).

No code/functional changes from this — homepage copy only, `index.html`.
`app/index.html` (the actual signed-in app) untouched by this round.

---

## Still open (see `PICKGAUGE_LAUNCH_CHECKLIST.md` for full, current detail)

Genuinely blocking launch, needs Drew directly:
1. Email/password sign-in test on production (only Google OAuth verified)
2. Full manual smoke test on the live production URL
3. Real production JWT inspection (to safely finish `azp`/`aud` hardening
   — currently permissive-when-absent by design, not a bug)
4. SPF/DKIM/DMARC (drafted in `DNS_EMAIL_SETUP.md`, not applied)
5. `responsible-play.html` content audit (Terms already audited, passes)
6. Marketing prep beyond the homepage copy above — launch posts,
   analytics, feedback channel, all untouched

Needs live conditions, can't be done from a sandbox:
- Live Upstash CAS concurrency test
- Real locked pool-sheet acceptance test (synthetic fixtures aren't
  enough for the final sign-convention check)
- Physical iPhone/Android pass (browser emulation is thoroughly done)
- Live 2026 CFBD/closing-line validation (needs actual games played —
  also the trigger for confirming Matchup Intelligence's
  `/stats/season/advanced` field names against a populated response)

Low-priority hygiene: unused Vercel env vars, `MIGRATION_ADMIN_SECRET`
decision, Redis backup/export plan, Redis key TTL audit, cron live-fire
confirmation, `.vercel.app` URL handling.

## New feature scoped, still not built

Unchanged from last session: single "My Numbers" CSV import slot
(bring-your-own-model-numbers), scoped direction agreed but not started.
See prior `SESSION_SUMMARY_2026-08-24.md` for the full scoping notes —
still accurate, nothing changed here this session.
