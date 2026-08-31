# PickGauge — Pre-Launch Checklist
*Updated Aug 26, 2026*

---

## Domain

- [x] Domain purchased (`pickgauge.com`, bought directly through Vercel)
- [x] DNS pointed to Vercel (auto-configured on purchase)
- [x] Domain added + verified in Vercel project settings
- [x] `www` → apex (or vice versa) redirect configured
- [x] SSL cert auto-provisioned and confirmed (loads clean over HTTPS)
- [ ] Old/dev URLs (`*.vercel.app`) either redirected or left as internal-only
  - **Next step:** decide whether to leave the `.vercel.app` URL as unlisted-but-reachable (fine for now, low risk) or add a redirect rule in `vercel.json` under a `redirects` block targeting that host. Not urgent — revisit after launch if it starts showing up in search or gets shared accidentally.

---

## Security (new section — Aug 25 pass)

- [x] Content-Security-Policy header shipped
  - `vercel.json` now sends a real CSP, built against Clerk's own documented requirements. Required externalizing the last inline `<script>` block in `app/index.html` first (now `app/js/main.js`) — an inline script with real content can't pass a real CSP without `'unsafe-inline'`, which defeats the point.
- [x] Strict-Transport-Security header shipped
  - `max-age=63072000; includeSubDomains`. Deliberately NOT submitted to the browser HSTS preload list yet — that's a much bigger, harder-to-undo commitment; worth doing only after this header's been live a while with zero problems.
- [x] PDF.js self-hosted, no more cdnjs dependency
  - Vendored the exact pinned version (3.11.174, pulled from the matching npm package — byte-identical to what cdnjs was serving) into `app/vendor/pdfjs/`. Removes the last third-party origin from the trust chain for a library that parses arbitrary uploaded PDFs.
- [x] Server-side Python PDF/JWT dependency pins upgraded before launch
  - `pdfplumber==0.11.10` and `PyJWT[crypto]==2.13.0` are pinned in `requirements.txt`. The current model-performance build has 67 non-browser regression files; its new model-history/grading/state tests pass, and the permanent non-browser suite remains green in segmented runs; this sandbox already had PyJWT 2.13.0 but could not install the newly pinned pdfplumber 0.11.10 because external package resolution is blocked here. Exact-pin verification therefore remains part of CI/Vercel deployment validation.
- [x] Powers PDF upload signature/resource hardening
  - `/api/parse_pdf` rejects uploads without a `%PDF-` signature in the first 1024 bytes before pdfplumber sees them, and the opened PDF object is guaranteed to close in a `finally` block even when parsing fails. `tests/test_pdf_upload_hardening.py`: **9/9 checks pass.**
- [x] Authenticated/API JSON responses explicitly opt out of caching
  - All nine authenticated `api/*.py` response helpers now send `Cache-Control: private, no-store, max-age=0`, including private state, uploads, grading, odds/predictions and CFBD proxy responses. `tests/test_api_no_store_headers.py`: **9/9 checks pass.**
- [x] `/api/fetch_cfbd`'s `force=1` (bypasses the shared cache, costs a real upstream CFBD call) gated to admins only
  - Non-admin's `force=1` is silently downgraded rather than rejected. Drift-tested against `api/state.py`'s existing `is_admin()` so the two copies can't diverge unnoticed.
- [x] `robots.txt` added — `noindex /app/` (the signed-in app itself, no value indexed) and `/api/`
- [x] JWT issuer pinning + `azp` (authorized-party) allowlist, across all 9 authenticated `api/*.py` files
  - A real production Clerk token was inspected Aug 26: `azp` is reliably present and `aud` is absent. `azp` now fails closed when missing; `verify_aud: False` is intentional and matches the real token shape. Cross-file drift tests cover all 9 copies.
- [x] Odds shared-cache isolation fixed (a signed-in user's own personal-key request could previously overwrite the *global* shared odds cache/quota — now gated)
- [x] Not-signed-in backup-restore hardened against a malformed import bricking the app (normalizes in memory before committing to `localStorage`)
- [x] HTML/attribute-injection P0 closed as **no-repro with permanent regression coverage**
  - `tests/test_html_injection_safety.mjs` now runs hostile strings through the real `esc()` and `norm()`/`mkey()` helpers, pins the safe `[a-z0-9]+@[a-z0-9]+` matchup-key invariant, verifies visible team names are escaped, and verifies the audited `data-pickteam="${g.key}"` path receives the normalized key rather than raw team text. **18/18 checks pass.**
- [ ] DMARC pending; SPF + DKIM are live and verified (see "Email" below)

---

## Vercel (Production)

- [x] Production environment variables set:
  - `CFBD_API_KEY`, `ODDS_API_KEY` — confirmed present
  - `CLERK_JWKS_URL` — updated to `https://clerk.pickgauge.com/.well-known/jwks.json`
  - `STORAGE_KV_REST_API_URL` / `STORAGE_KV_REST_API_TOKEN` — confirmed present (Vercel-managed Upstash Redis, region `iad1`)
  - `CRON_SECRET` — generated and set
  - `PICKGAUGE_ADMIN_UIDS` — set to production Clerk User ID
- [ ] Unused/leftover env vars cleaned up
  - **Next step:** in Vercel → Settings → Environment Variables, delete `STORAGE_KV_REST_API_READ_ONLY_TOKEN`, `STORAGE_KV_URL`, `STORAGE_REDIS_URL` (all confirmed unused in code). Double-check `APP_SECRET` isn't referenced anywhere in the live GitHub repo before deleting it too. Not urgent — pure hygiene, no functional impact either way.
- [ ] Decide on `MIGRATION_ADMIN_SECRET`
  - **Next step:** confirm whether the legacy migration endpoint in `state.py` is still needed. If not, leave this var unset intentionally (your code already disables that route when it's absent — the safer default).
- [x] Preview deployments confirmed NOT using production Redis/keys
  - Resolved via Vercel → Storage → database Settings → "Allowed Environments" set to **"Production environment only"**. Preview/dev deploys can no longer reach production Redis at all.
- [ ] Cron jobs confirmed running on production, correct timezone
  - **Status:** `grade_picks` is scheduled `0 14 * * *` (14:00 UTC = 9am CDT / 8am CST). Not yet verified as actually firing successfully.
  - **Next step:** after the next live game day, go to Vercel → Logs → filter to the `/api/grade_picks` function → confirm a `200` response appears around the scheduled time. If nothing shows up, check that `CRON_SECRET` is correctly set (a mismatch here would cause Vercel's own cron trigger to fail the auth check silently).
- [x] Function region set appropriately
  - Confirmed set to `iad1`, matching the Redis database's region.
- [x] Rate limit / quota floor for Odds API confirmed active
  - Confirmed in code: `SHARED_QUOTA_FLOOR = 50` in `api/fetch_odds.py`, hardcoded (not an env var) — the app automatically stops making shared-key requests once fewer than 50 calls remain in the billing period.
  - **Optional follow-up:** check The Odds API's own dashboard to confirm your plan's total monthly quota and that 50 is a sane cutoff relative to your plan size.
- [x] Error/log monitoring reviewed
  - Decision: Vercel's built-in Logs tab (Project → Logs, filtered to Production) is sufficient at current scale. No third-party tool (Sentry, etc.) needed pre-launch.
- [x] Custom 404/error pages don't leak stack traces or internals
  - Confirmed via code: exceptions are deliberately never serialized into API responses. `404.html` is clean, on-brand, and `noindex`'d.
- [x] Production placeholders cleaned up (`REPLACE-ME` contact/canonical/OG URLs → real `support@pickgauge.com` / `pickgauge.com` values)
- [x] Pricing page de-linked from public navigation, `noindex`'d as defense-in-depth (not deleted — still reachable by direct URL if you want to share it privately)
- [x] Homepage marketing copy corrected to match actual shipped features (removed an overclaiming "bring your own numbers" line describing a CSV import that doesn't exist yet — see "Feature ideas" in `CURRENT_STATE.md`)

---

## Clerk (Production)

- [x] Switched from `pk_test_...` to production Clerk instance/keys
  - `app/index.html` updated: both script tags now point at `clerk.pickgauge.com`, `data-clerk-publishable-key` set to the `pk_live_...` value. Deployed and confirmed live.
- [x] Production Clerk domain configured, JWKS URL updated to match
  - Custom domain `clerk.pickgauge.com` set up via CNAME (`frontend-api.clerk.services`), verified and propagated. `CLERK_JWKS_URL` updated in Vercel to match.
- [x] Allowed redirect/callback URLs updated to production domain
  - Confirmed working via successful sign-in on `pickgauge.com`.
- [x] Google OAuth (SSO connection) fully configured
  - Google Cloud Console OAuth consent screen set up, OAuth client created with correct redirect URI, app published to production status, Client ID + Client Secret entered correctly in Clerk. Confirmed working end-to-end.
- [ ] Email/password (or email-code) sign-in tested end-to-end on production URL
  - Google OAuth and protected API access were successfully re-tested after the Aug 25 auth patch. The remaining auth-flow gap is the email path itself.
  - **Next step:** test email sign-up/sign-in on `pickgauge.com/app`, then confirm `/api/state`, CFBD, teams, odds, and predictions return authenticated responses.
- [x] Real production JWT inspected; `azp`/`iss` hardening completed
  - Aug 26 production-token inspection confirmed `azp=https://www.pickgauge.com` and no `aud` claim. Missing `azp` now fails closed; issuer pinning remains enforced; `verify_aud: False` is intentionally retained.
- [ ] Session token expiry / security settings reviewed
  - **Next step:** Clerk dashboard (Production instance) → Sessions settings → review default session lifetime and inactivity timeout. No specific concern flagged yet — just hasn't been looked at.
- [x] Admin UID(s) re-confirmed against production Clerk user IDs
  - `PICKGAUGE_ADMIN_UIDS` set to your real production Clerk User ID.

---

## Redis (Upstash)

- [x] Production Redis instance confirmed
  - Found via Vercel → Storage: `upstash-kv-byzantium-flame`, region `iad1`, Free tier (1 database limit, 500,000 monthly commands).
- [ ] Backup/export plan for pick and pool data (even manual, periodic)
  - **Next step:** not yet addressed. At minimum, consider a periodic manual export of key pick/pool data via Upstash's REPL/CLI or a small script, especially before/after major schema changes.
- [x] Key TTLs/expiry reviewed so season-critical state does not silently evaporate mid-season
  - Private account state + shared pool CAS writes use plain Redis `SET` with no expiration. Shared odds/predictions and grader cache are also non-expiring. The only intentional TTLs are short-lived rate-limit buckets and immutable weekly prediction snapshots (~26 weeks). `tests/test_redis_ttl_integrity.py`: **8/8 checks pass.**
- [x] Confirm BP/Comp per-user data still excluded from shared tier (licensing)
  - Already confirmed: `api/state.py` explicitly keeps PDF-derived BP/Comp data out of the shared Redis tier.
- [x] Live CAS concurrency test
  - Run Aug 26 against the real production Upstash/Clerk stack: two simultaneous writes produced exactly one 200 and one 409 carrying the winner's new revision/data; cleanup succeeded.
- [ ] Monitor Free tier command usage as real traffic ramps up
  - **Next step:** Vercel → Storage → your database → Usage tab. Check periodically post-launch, especially in the first week — 500,000 monthly commands could get consumed faster than expected. Upgrade path exists if needed.

---

## Email

- [x] Support/contact email set up — `support@pickgauge.com` via Google Workspace
- [x] MX record configured and verified (mail routing to Google)
- [x] SPF record live and verified
  - Root TXT is `v=spf1 include:_spf.google.com ~all`; confirmed Aug 26.
- [x] DKIM live and verified
  - Google Workspace 2048-bit DKIM is configured and passing as of Aug 26.
- [ ] DMARC record
  - **Next step:** after the ~48h SPF/DKIM settle window, add the monitor-only `_dmarc` record documented in `DNS_EMAIL_SETUP.md` (target Aug 28).
- [ ] Transactional email (if any — password reset, welcome, weekly recap)
  - **Next step:** decide whether Clerk handles this natively (it does for auth-related emails) or whether you need a separate service for product emails like weekly recaps. Not decided yet.
- [ ] Simple email capture for early users/waitlist if not launching paywall immediately
  - **Next step:** not yet built. Low priority unless you want to start collecting interested users before full launch.

---

## Legal

- [x] Privacy Policy drafted and live
  - `privacy.html` exists, is substantive, linked in the app footer, live at `https://pickgauge.com/privacy.html`.
- [x] Terms of Service drafted and audited
  - Passes as-is — informational/entertainment-only framing, no wagering facilitation, user responsibility for local law/age compliance, all explicit. Optional future addition: a governing-law/jurisdiction clause once a formal business entity exists.
- [x] Responsible Play / legal-age disclaimer content audit completed
  - `responsible-play.html` now mirrors Terms' legal-age/local-law framing, clearly states PickGauge is not a sportsbook, uses the current National Problem Gambling Helpline (`1-800-MY-RESET`), retains the still-active `1-800-522-4700` alternate, and links directly to `1800myreset.org` for online help/chat.
  - Decision for launch: **no click-through age gate added**. The current informational tool does not process wagers; legal-age/local-law language is explicit. Revisit a hard age gate if PickGauge later adds sportsbook integrations or other regulated functionality.
- [x] Brad Powers content: per-user upload model confirmed, no shared/redistributed BP content
- [x] thepredictiontracker.com de-spotlighted in all public/in-app copy (Drew's explicit call — no formal agreement with the site's operator exists, so named/linked attribution was dropped from user-facing surfaces while keeping the underlying disclosure honest)
- [x] Product analytics + beta-feedback privacy disclosure shipped
  - `privacy.html` documents PickGauge's signed-in first-party aggregate analytics and explicit in-app feedback storage: no raw clickstream, no picks/model numbers/imported-file contents attached, one-way pseudonymous user token for unique counts/grouping, and ~400-day retention. It now also separately discloses Vercel Web Analytics for anonymous aggregate website traffic, including the no-analytics-cookie behavior and PickGauge's query/hash redaction guard.

---

## Payments (if paywall at launch)

- [ ] Not addressed — per code comments in `pricing.html`, Stripe integration is explicitly a **later roadmap item**, not part of initial launch.

---

## Product/QA

- [ ] Exact-pin post-dependency full test verification, including browser E2E
  - The repo contains **68 permanent test files**: 67 non-browser files plus `tests/test_e2e_ui_behaviors.py` (Playwright). The new model-performance test file plus all permanent non-browser regressions pass in segmented runs. PyJWT was already 2.13.0 in the sandbox; pdfplumber remained 0.11.9 because external package installation is blocked here. The Aug 26 Claude session had separately recorded the full 57/57 suite passing before the dependency-pin update. Close this item after CI/Vercel installs `pdfplumber==0.11.10` and `PyJWT[crypto]==2.13.0`, the 67 non-browser files pass there, and the browser file passes in an environment where Chromium can reach localhost.
- [ ] Manual smoke test on production URL: sign up → view Edge Board → make picks → upload BP PDF → view Model #
  - **Next step:** run through this full flow once email/password sign-in is tested (see Clerk section above). This is the one item every other still-open item is arguably blocking on.
- [x] Full-slate historical model-performance dashboard
  - Results now tracks PickGauge Model # and curated prediction systems across every game for which this account captured both a pre-kick market line and model projections, independent of the user's own selected picks. The same nightly/manual grader fills hypothetical ATS W-L-P from canonical finals. PickGauge-specific edge-size, favorite/dog, and home/away splits are included. This starts prospectively after deployment; no hindsight backfill is attempted.
  - **Live validation after deploy:** before kickoff, load lines + predictions and confirm a week's `modelPerformanceHistory` grows; after finals/cron, confirm the Results leaderboard grades automatically. The benchmark is the account's last observed pre-kick market/book snapshot, not a guaranteed official closing line.
- [x] Real locked Splash pool-sheet acceptance test
  - Completed Aug 26 with Drew's real Week-1 Splash PDF. It exposed a genuine parser bug, the parser was fixed, and the exact real pdf.js text output is now embedded as regression coverage in `tests/test_pool_parsing.py`.
- [ ] Physical iPhone/Android mobile signoff
  - Browser-level mobile/touch emulation is thoroughly done (360/390/412px, dialogs, pool flows, Results filters, live scoring). Still need one real Safari-on-iPhone + Chrome-on-Android pass — don't relabel emulation as physical-device testing.
- [ ] Live 2026 CFBD/closing-line validation
  - Actual games are now available. **Matchup Intelligence populated-field validation is complete and v2 fixes are shipped.** Keep this item open for the remaining operational checks: canonical schedule joins, live scoreboard, automatic grading, retained pre-kick lines through kickoff/reschedules/postponements/neutral-site/FBS-vs-FCS games.
- [x] Sagarin code mapping confirmed and applied to the historical Top-10 badges
  - `sagpred` = Sagarin Predictor / Pure Points → backtest rank **#1 "Sagarin Points"**.
  - `sag` = overall Sagarin Rating → backtest rank **#2 "Sagarin Ratings"**.
  - The original handoff did not retain the two composite-score values, so code stores them as `null` and the UI omits the number instead of guessing. `tests/test_sagarin_mapping_logic.mjs`: **8/8 checks pass.**
- [x] Site logo/favicon fixed — header/favicon assets use the current stadium mark. A separate dedicated share card now handles social previews instead of reusing the square icon.
- [x] Public sitemap + social-share metadata shipped
  - `sitemap.xml` includes only the public/indexable pages; `robots.txt` advertises it. Homepage Open Graph/Twitter metadata now points to a dedicated **1200×630 `social-share.png`** and uses `summary_large_image`. `tests/test_sitemap_social_metadata.py`: **15/15 checks pass.**
- [x] Status docs reconciled against the Aug 26 handoff (`CURRENT_STATE.md`, launch checklist, README, new-session guide)

---

## Marketing / Go-Live

- [x] First-party product analytics + in-app beta feedback channel shipped and beta-reviewed
  - Account → Beta admin uses per-event HyperLogLog uniques for a true **signed-in activation funnel** (active → pool ready → predictions ready → pick ready → Snapshot viewed → entry submitted), plus feature counts, device mix, and recent daily activity.
  - Persistent 💬 + Help CTAs collect Bug / Confusing / Feature request / Other feedback and automatically attach only coarse diagnostics (tab, Overall/pool, device, season/week, entry surface, recent product action); no screenshots, picks, model numbers, pool names, emails, or imported-file contents.
- [ ] **Enable Vercel Web Analytics in production + redeploy**
  - Code integration is complete on every public/app HTML page and `vercel-analytics.js` strips query strings/fragments before transmission. The live `cfb-ats-dashboard` project's `/_vercel/insights/script.js` currently returns 404, so Vercel Web Analytics is not enabled yet. In Vercel: project → Analytics → Enable, then redeploy/promote production. After the first visits, confirm `/`, `/app/`, referrers, devices and hostnames populate.
- [ ] Landing-page launch copy / launch posts / outreach plan
  - Signed-in analytics/feedback are complete; anonymous traffic analytics only needs the Vercel enable/redeploy step above. Remaining work is launch messaging and distribution.

---

## Post-Launch (Week 1)

- [ ] Not applicable yet — pre-launch.

---

## Summary of what's genuinely still blocking launch

1. **Email/password (or email-code) sign-in test** — Google OAuth is confirmed; this is the remaining auth-flow gap.
2. **Full manual smoke test** on the live production URL — sign in → import/load real data → pick → Snapshot/My Picks/Results → sign out/in → confirm persistence.
3. **DMARC** — SPF and DKIM are already live; add the monitor-only DMARC record after the settle window (target Aug 28).
4. **Post-dependency test verification** — run all 67 non-browser files on the new exact Python pins and the 71-check browser file in CI/an environment that permits localhost.
5. **Physical iPhone/Android signoff** — emulator coverage is strong; real-device keyboard/tap behavior still needs a pass.
6. **Live 2026 CFBD/closing-line validation** — validate joins, statuses, grading, retained closes, reschedules and populated advanced-team fields once real 2026 games exist.

*(CSP, HSTS, PDF.js self-hosting, Python dependency upgrades, `force=1` admin gate, `robots.txt` + sitemap/social-share metadata, PDF upload signature/close hardening, explicit API no-store headers, first-party product analytics + beta feedback, injection regression coverage, Sagarin mapping, Redis TTL audit, Responsible Play content, production JWT inspection/`azp` hardening, live CAS concurrency validation, real locked Splash acceptance, SPF/DKIM, odds shared-cache isolation, backup-restore hardening, placeholder cleanup, pricing de-linking, homepage copy, and the logo fix are all now done — no longer on this list.)*

Everything else (domain, Vercel infra, Clerk production, Google OAuth, Privacy Policy, BP architecture, security headers) is done or in good shape with only minor/optional follow-ups remaining.
