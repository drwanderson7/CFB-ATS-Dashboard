# PickGauge — Pre-Launch Checklist
*Updated Aug 24, 2026*

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
  - **Optional follow-up:** check The Odds API's own dashboard to confirm your plan's total monthly quota and that 50 is a sane cutoff relative to your plan size (fine if it's a mid/large plan; possibly too conservative or too loose if you're on a very small plan).
- [x] Error/log monitoring reviewed
  - Decision: Vercel's built-in Logs tab (Project → Logs, filtered to Production) is sufficient at current scale. No third-party tool (Sentry, etc.) needed pre-launch.
- [x] Custom 404/error pages don't leak stack traces or internals
  - Confirmed via code: exceptions are deliberately never serialized into API responses (real error text goes to stderr only, per explicit comments in `state.py`). `404.html` is clean, on-brand, and `noindex`'d.

---

## Clerk (Production)

- [x] Switched from `pk_test_...` to production Clerk instance/keys
  - `app/index.html` updated: both script tags now point at `clerk.pickgauge.com`, `data-clerk-publishable-key` set to the `pk_live_...` value. Deployed and confirmed live.
- [x] Production Clerk domain configured, JWKS URL updated to match
  - Custom domain `clerk.pickgauge.com` set up via CNAME (`frontend-api.clerk.services`), verified and propagated. `CLERK_JWKS_URL` updated in Vercel to match.
- [x] Allowed redirect/callback URLs updated to production domain
  - Confirmed working via successful sign-in on `pickgauge.com`.
- [x] Google OAuth (SSO connection) fully configured
  - Google Cloud Console OAuth consent screen set up (External audience, `support@pickgauge.com` as support/developer contact, `pickgauge.com` as authorized domain, privacy policy link added), OAuth client created with correct redirect URI, app published to production status, Client ID + Client Secret entered correctly in Clerk. Confirmed working end-to-end.
- [ ] Sign-up/sign-in flows tested end-to-end on production URL — **partially done**
  - Google OAuth: ✅ confirmed working
  - Email/password (or email code) sign-in: **not yet tested**
  - **Next step:** go to `pickgauge.com/app`, use the email address field (not Google) to sign up or sign in, confirm it completes without errors and that authenticated content (Edge Board data) loads correctly afterward.
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
- [ ] Key TTLs/expiry reviewed so nothing silently evaporates mid-season
  - **Next step:** not yet audited. Worth a pass through your Redis-writing code to confirm no unintended TTLs are set on season-critical keys (picks, pool state).
- [x] Confirm BP/Comp per-user data still excluded from shared tier (licensing)
  - Already confirmed: `api/state.py` explicitly keeps PDF-derived BP/Comp data out of the shared Redis tier, per its own header comment.
- [ ] **New item:** monitor Free tier command usage as real traffic ramps up
  - **Next step:** Vercel → Storage → your database → Usage tab. Check periodically post-launch, especially in the first week — 500,000 monthly commands could get consumed faster than expected once real users are hitting the Edge Board regularly. Upgrade path exists if needed.

---

## Email

- [x] Support/contact email set up — `support@pickgauge.com` via Google Workspace
- [x] MX record configured and verified (mail routing to Google)
- [ ] SPF and DKIM records
  - **Status:** the domain-ownership TXT record and MX record were completed, but SPF and DKIM (separate DNS records Google Workspace provides specifically for deliverability — keeping your outgoing mail out of spam folders) were **not explicitly set up** in this session.
  - **Next step:** go to Google Workspace Admin console → Apps → Google Workspace → Gmail → Authenticate email, and follow the SPF/DKIM setup flow there. It'll give you a TXT record (SPF) and another TXT/CNAME record (DKIM) to add via the same Vercel DNS Records page used for the earlier records. This matters if you plan to send any real email (welcome emails, replies from support@) — without it, outgoing mail is more likely to land in spam.
- [ ] Transactional email (if any — password reset, welcome, weekly recap)
  - **Next step:** decide whether Clerk handles this natively (it does for auth-related emails like verification/password reset) or whether you need a separate service for product emails like weekly recaps. Not decided yet.
- [ ] Simple email capture for early users/waitlist if not launching paywall immediately
  - **Next step:** not yet built. Low priority unless you want to start collecting interested users before full launch.

---

## Legal

- [x] Privacy Policy drafted and live
  - `privacy.html` exists, is substantive (covers Clerk account data, per-user vs. shared storage, Odds API key handling), linked in the app footer, and live at `https://pickgauge.com/privacy.html`. Already used successfully as the required link for Google's OAuth consent screen.
- [x] Terms of Service drafted
  - Audited `terms.html` directly against the required criteria: informational/entertainment-only framing (explicit, repeated), no wagering facilitation (explicit), user responsibility for local law/age compliance (explicit). All covered well. Also includes acceptable use, no warranty, and limitation of liability sections. Passes as-is — no changes needed. Optional future addition: a governing-law/jurisdiction clause once a formal business entity exists.
- [ ] Age-gate / disclaimer if touching sports betting content in any state-sensitive way
  - **Status:** `responsible-play.html` exists and is linked in the footer — content not yet audited.
  - **Next step:** confirm it adequately addresses this, or decide if a more explicit age-gate (e.g., a click-through confirmation) is needed.
- [x] Brad Powers content: per-user upload model confirmed
  - Already implemented and verified against the live repo — no shared/redistributed BP content, licensing risk substantially mitigated.
- [ ] Cookie/analytics disclosure if using any tracking
  - **Next step:** not yet addressed — depends on whether/what analytics tool you end up using (see Marketing section below).

---

## Payments (if paywall at launch)

- [ ] Not addressed this session — per code comments in `pricing.html`, Stripe integration is explicitly a **later roadmap item**, not part of initial launch. No payment processor work needed yet.

---

## Product/QA

- [x] Full test suite green on latest commit (47/47 files passing, confirmed after the Clerk production key swap)
- [ ] Manual smoke test on production URL: sign up → view Edge Board → make picks → upload BP PDF → view Model #
  - **Next step:** run through this full flow once email/password sign-in is tested (see Clerk section above).
- [ ] Mobile layout checked on production
- [ ] Empty-state messaging verified for preseason/no-data scenarios
- [ ] `CURRENT_STATE.md` reflects actual shipped state
  - **Next step:** update this doc to reflect the Clerk production cutover, custom domain, and email setup completed this session.

---

## Marketing / Go-Live

- [ ] Not addressed this session — all items from the original checklist remain open (landing page copy, launch posts, analytics, feedback channel).

---

## Post-Launch (Week 1)

- [ ] Not applicable yet — pre-launch.

---

## Summary of what's genuinely still blocking launch

1. **Email/password sign-in test** — quick, do this next.
2. **SPF/DKIM for email deliverability** — matters if you're sending any real email.
3. **Responsible Play content audit** — confirm the existing page actually says what it needs to say (Terms of Service already audited and passes).
4. **Full manual smoke test** on the live production URL.
5. **Marketing prep** — landing copy, launch posts — whenever you're ready to actually go live.

*(Preview/production Redis isolation and function region resolved — no longer on this list.)*

Everything else (domain, Vercel infra, Clerk production, Google OAuth, Privacy Policy, BP architecture) is done or in good shape with only minor/optional follow-ups remaining.
