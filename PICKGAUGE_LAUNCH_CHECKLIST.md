# PickGauge — Pre-Launch Checklist
*Updated Aug 25, 2026*

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
- [x] `/api/fetch_cfbd`'s `force=1` (bypasses the shared cache, costs a real upstream CFBD call) gated to admins only
  - Non-admin's `force=1` is silently downgraded rather than rejected. Drift-tested against `api/state.py`'s existing `is_admin()` so the two copies can't diverge unnoticed.
- [x] `robots.txt` added — `noindex /app/` (the signed-in app itself, no value indexed) and `/api/`
- [x] JWT issuer pinning + `azp` (authorized-party) allowlist, across all 8 `api/*.py` files (shipped in the prior session's ChatGPT-audit response, confirmed still in place)
  - **Still open:** `verify_aud` stays permissive, and `azp` is only enforced when present, not fail-closed on absence — both need one real production-issued Clerk token inspected (jwt.io or similar) to finish safely. See "Clerk (Production)" below.
- [x] Odds shared-cache isolation fixed (a signed-in user's own personal-key request could previously overwrite the *global* shared odds cache/quota — now gated)
- [x] Not-signed-in backup-restore hardened against a malformed import bricking the app (normalizes in memory before committing to `localStorage`)
- [x] HTML/attribute-injection P0 closed as **no-repro with permanent regression coverage**
  - `tests/test_html_injection_safety.mjs` now runs hostile strings through the real `esc()` and `norm()`/`mkey()` helpers, pins the safe `[a-z0-9]+@[a-z0-9]+` matchup-key invariant, verifies visible team names are escaped, and verifies the audited `data-pickteam="${g.key}"` path receives the normalized key rather than raw team text. **18/18 checks pass.**
- [ ] SPF/DKIM/DMARC — drafted, not applied (see "Email" below)

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
- [ ] Sign-up/sign-in flows tested end-to-end on production URL — **BLOCKED ON LIVE RETEST AFTER AUTH PATCH**
  - Google OAuth had previously been confirmed working, but an Aug 25 live DevTools capture showed every protected endpoint returning the same auth 401 simultaneously. This is now treated as an app-wide auth regression, not a Prediction Tracker failure.
  - Patch applied: accept both `https://pickgauge.com` + `https://www.pickgauge.com` Clerk `azp` origins and force-refresh/retry the short-lived Clerk token once on a true auth-shaped 401.
  - Email/password (or email code) sign-in: **still not tested** — same gap as last update, hasn't moved.
  - **Next step:** deploy the auth patch, then test BOTH Google and email/password on `pickgauge.com/app`; confirm `/api/state`, CFBD, teams, odds, and predictions return authenticated responses before moving on.
- [ ] Real production JWT inspected to finish `azp`/`iss` hardening — **now urgent because a live 401 regression was observed**
  - **Status:** issuer pinning is live; the `azp` allowlist now covers both apex + `www` production origins and permits explicit extra aliases via `PICKGAUGE_ALLOWED_AZP`. It still does not fail-closed on a *missing* `azp`, and `verify_aud` stays off until a real production token is inspected.
  - **Next step:** sign in for real on `pickgauge.com`, grab the token, check it on jwt.io. Does it have `azp`? What value? Is `aud` set to something stable? Tighten the 8 duplicated `verify_user()` copies accordingly (`tests/test_auth_sync.py` will catch any of the 8 drifting from `api/state.py`'s copy).
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
- [ ] Live CAS concurrency test
  - `tests/_live_cas_concurrency_test.py` exists but needs one real deployment run with a fresh Clerk token — deliberately excluded from automated CI since it hits a real production URL with real writes.
- [ ] Monitor Free tier command usage as real traffic ramps up
  - **Next step:** Vercel → Storage → your database → Usage tab. Check periodically post-launch, especially in the first week — 500,000 monthly commands could get consumed faster than expected. Upgrade path exists if needed.

---

## Email

- [x] Support/contact email set up — `support@pickgauge.com` via Google Workspace
- [x] MX record configured and verified (mail routing to Google)
- [ ] SPF, DKIM, DMARC records — **drafted this session, not yet applied**
  - **Status:** exact record values are written up in `DNS_EMAIL_SETUP.md` (new file), sourced from Google's current Workspace docs — SPF (a straightforward TXT value), DKIM (needs a key generated in Google Admin console, can't be pre-filled), and DMARC (start at `p=none` monitor-only, not straight to enforcement).
  - **Next step:** follow `DNS_EMAIL_SETUP.md` in order — SPF → DKIM → wait ~48h → DMARC. All three go through Vercel's DNS panel (same "Add DNS Record" path used for everything else; remember the Bluesky quick-setup dialog intercepts a plain TXT attempt, dismiss it and use the generic path).
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
- [ ] Cookie/analytics disclosure if using any tracking
  - **Next step:** not yet addressed — depends on whether/what analytics tool you end up using (see Marketing section below).

---

## Payments (if paywall at launch)

- [ ] Not addressed — per code comments in `pricing.html`, Stripe integration is explicitly a **later roadmap item**, not part of initial launch.

---

## Product/QA

- [ ] Full test suite green on the **latest ChatGPT continuation**
  - Current repo now has **53 permanent test files**. `scripts/test_all.sh --fast` passes **52/52 non-browser files** in this sandbox.
  - `tests/test_e2e_ui_behaviors.py` cannot run here because Chromium is policy-blocked from `localhost` (`ERR_BLOCKED_BY_ADMINISTRATOR`), not because an assertion failed. The pre-change Aug 25 handoff recorded that browser file at **71/71 passing**. **Re-run the full suite in CI/Claude before deploy.**
- [ ] Manual smoke test on production URL: sign up → view Edge Board → make picks → upload BP PDF → view Model #
  - **Next step:** run through this full flow once email/password sign-in is tested (see Clerk section above). This is the one item every other still-open item is arguably blocking on.
- [ ] Real locked pool-sheet acceptance test
  - Run a genuine locked Splash Sports / ESPN/OFP sheet through parser → home-perspective line → pick → archive → pre-kick close → CLV → grading. Synthetic fixtures aren't enough for the final real-world sign-convention check.
- [ ] Physical iPhone/Android mobile signoff
  - Browser-level mobile/touch emulation is thoroughly done (360/390/412px, dialogs, pool flows, Results filters, live scoring). Still need one real Safari-on-iPhone + Chrome-on-Android pass — don't relabel emulation as physical-device testing.
- [ ] Live 2026 CFBD/closing-line validation
  - Needs actual games played: canonical schedule joins, live scoreboard, automatic grading, retained pre-kick lines through kickoff/reschedules/postponements/neutral-site games. Also the trigger for confirming Matchup Intelligence's `/stats/season/advanced` field names against a populated (non-preseason-empty) response.
- [x] Sagarin code mapping confirmed and applied to the historical Top-10 badges
  - `sagpred` = Sagarin Predictor / Pure Points → backtest rank **#1 "Sagarin Points"**.
  - `sag` = overall Sagarin Rating → backtest rank **#2 "Sagarin Ratings"**.
  - The original handoff did not retain the two composite-score values, so code stores them as `null` and the UI omits the number instead of guessing. `tests/test_sagarin_mapping_logic.mjs`: **8/8 checks pass.**
- [x] Site logo/favicon fixed — the header brand mark + OG/share image (`icon-96.png`, `icon-512.png`) were still the old design after the new logo files were uploaded under different filenames; overwritten in place with the new design, no HTML changes needed.
- [x] `CURRENT_STATE.md` reflects actual shipped state (updated through Aug 25)

---

## Marketing / Go-Live

- [ ] Not addressed — all items from the original checklist remain open (landing page copy, launch posts, analytics, feedback channel).

---

## Post-Launch (Week 1)

- [ ] Not applicable yet — pre-launch.

---

## Summary of what's genuinely still blocking launch

1. **Email/password sign-in test** — quick, do this next. Unchanged since last update.
2. **Full manual smoke test** on the live production URL — the thing most other open items feed into.
3. **Real production JWT inspection** — needed to safely finish the `azp`/`aud` hardening, unblocked now that Clerk's on the production custom domain.
4. **SPF/DKIM/DMARC** — drafted with exact values in `DNS_EMAIL_SETUP.md`, just needs your hand on Vercel's DNS panel + Google Admin console.
5. **Complete test-suite rerun** in CI/Claude — 52/52 non-browser files pass here; the local Chromium policy blocks the one browser file.
6. **Real locked pool-sheet acceptance test** — still the most important real-data correctness check.
7. **Physical iPhone/Android signoff** — emulator coverage is strong; real-device keyboard/tap behavior still needs a pass.
8. **Marketing prep** — launch posts, analytics, feedback channel — whenever you're ready to actually go live.

*(CSP, HSTS, PDF.js self-hosting, `force=1` admin gate, `robots.txt`, injection regression coverage, Sagarin mapping, Redis TTL audit, Responsible Play content, JWT issuer/`azp` pinning, odds shared-cache isolation, backup-restore hardening, placeholder cleanup, pricing de-linking, homepage copy, and the logo fix are all now done — no longer on this list.)*

Everything else (domain, Vercel infra, Clerk production, Google OAuth, Privacy Policy, BP architecture, security headers) is done or in good shape with only minor/optional follow-ups remaining.
