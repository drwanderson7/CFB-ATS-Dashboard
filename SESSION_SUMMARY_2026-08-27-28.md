# PickGauge — Session Summary, Aug 27-28 2026 (for a fresh chat handoff)

**Read `CURRENT_STATE.md` first — single source of truth, kept current after
every change below as part of delivering it.** This is a narrative recap of
a long, eventful two days for a fresh session that wants context fast.

Full test suite: **66/66 files passing**, confirmed by direct execution
immediately before this handoff was written, not assumed safe.

---

## The headline story: pickgauge.com got blocked, then unblocked

Drew discovered his own work network was silently blocking `pickgauge.com`
(`ERR_CONNECTION_RESET`). A long, methodical investigation (documented in
full in `NETWORK_BLOCK_HANDOFF_2026-08-27.md` and
`DOMAIN_STRATEGY_HANDOFF_2026-08-27.md`, both still in this repo) found:

- **Root cause**: Cisco Talos, Palo Alto (PAN-DB), and Fortinet
  (FortiGuard) had all independently categorized `pickgauge.com`'s content
  as **Gambling** — genuinely defensible given the site's own vocabulary
  (spreads, picks, ATS edge), not a false-positive bug on their end.
- **Mechanism, confirmed via real `curl -Iv`/`nslookup`, not guessed**:
  SNI-based TLS filtering at a firewall/proxy — DNS resolved fine, the
  TLS handshake itself got reset. Ruled out DNS-layer mechanisms (Cisco
  Umbrella specifically checked and ruled out on Drew's own laptop).
- **Response, in order**: submitted recategorization requests to all
  three vendors; softened homepage copy ("Recommended Bet" → "Top Pool
  Pick," "sportsbook lines" → "market/reference spreads," added an
  explicit "we don't accept wagers" disclaimer); **and, as a parallel
  safety net, moved production auth off the `clerk.pickgauge.com` custom
  domain onto Clerk's own Development instance** (Aug 27) so the app
  would work from Drew's blocked network regardless of how the
  recategorization played out.
- **Palo Alto and Fortinet corrected first**; the block on Drew's network
  persisted even after both corrected — meaning his specific office
  device most likely reads from Talos specifically (never fully
  confirmed which vendor, but strongly implied).
- **Aug 28: Talos removed the Gambling category. Drew confirmed
  `pickgauge.com` is reachable again from the previously-blocked
  network.** The Aug 27 Clerk Development-instance move was explicitly
  a *temporary* bridge for as long as the block existed, not a permanent
  architecture choice — so it was **reverted the same day**, back to the
  real production Clerk instance.

**Net result as of this handoff**: `pickgauge.com` works again, everywhere,
including Drew's office. Production auth is back on `clerk.pickgauge.com`.
`cfb-ats-dashboard.vercel.app` was deliberately kept as a permanent
secondary entry point (`_ALLOWED_AZP` across all 9 backend files) — costs
nothing, and the whole two-day arc is now a documented, tested, repeatable
playbook if this ever happens again.

---

## What actually changed in the code, chronologically

### Aug 27: moved OFF clerk.pickgauge.com
- `app/index.html`: Clerk's two `<script>` tags pointed at Clerk's
  Development instance (`simple-monarch-32.clerk.accounts.dev`,
  publishable key confirmed by Drew directly against his live Clerk
  Dashboard, not guessed).
- `vercel.json`'s CSP header updated to match (`script-src`/`connect-src`)
  — flagged explicitly at the time as an easy-to-miss step that would've
  caused a silent, confusing failure (correct HTML, browser's own CSP
  blocking it anyway) if skipped.
- `_ALLOWED_AZP` across all 9 `api/*.py` files: added
  `https://cfb-ats-dashboard.vercel.app` as a first-class hardcoded
  origin (not left as an easy-to-forget env-var-only step), since Drew
  confirmed that's now a real, permanent entry point going forward.
  Propagated byte-identically via script. `api/beta.py` was found
  missing the full explanatory comment block the other 8 files have
  (functionally correct, confirmed by the drift test, just
  under-documented) — brought up to the same standard.
- Real, knowing tradeoff accepted at the time: Clerk's Development
  instances are capped at 100 users, "not for production" per Clerk's own
  guidance — reasonable given exactly one real user (Drew) existed.

### Aug 27: homepage copy softened (kept after the later revert)
- `index.html` (marketing page only): the three phrase changes plus the
  disclaimer, described above. No test coverage needed (pure copy, no
  logic) — verified in a real browser render instead.

### Aug 28: REVERTED back to clerk.pickgauge.com
- `app/index.html` and `vercel.json` moved back to the real production
  Clerk instance and CSP value — byte-identical to the pre-Aug-27 state,
  confirmed via a real browser render (correct script tags, zero JS
  errors).
- `_ALLOWED_AZP`'s `cfb-ats-dashboard.vercel.app` entry was **deliberately
  kept**, not reverted — free to leave, gives a fast tested path back if
  this regresses.
- Homepage copy softening was **deliberately kept**, not reverted — no
  reason to walk back accurate language regardless of what caused the
  original block.
- Test file `tests/test_clerk_dev_instance_permanent.mjs` (Aug 27) was
  renamed to `tests/test_clerk_production_domain_restored.mjs` and
  rewritten to check the reverted state with the same rigor (checks the
  intended values' presence AND the unintended values' absence, both
  directions, so a half-reverted state can't silently pass).
  `tests/test_vercel_headers.py`'s CSP assertion reverted to match.
- **One piece still needed live confirmation from Drew** (can't be
  verified from this repo): Vercel's Production `CLERK_JWKS_URL`
  environment variable reverted back to
  `https://clerk.pickgauge.com/.well-known/jwks.json`, and a fresh
  deploy triggered. **Confirm this actually happened before assuming
  live sign-in works** — env var changes don't apply retroactively to
  what's already deployed, and this is the one step genuinely outside
  what any AI session can verify directly.

### Aug 28: small cleanup pass (unrelated to the domain saga, done same day)
- **`pricing.html`**: removed the "No ads, ever, on any tier" card
  entirely (both the headline and the "Pro is the only monetization path
  being considered" body text) — Drew's call, since advertising/affiliate
  revenue have been explicitly discussed as real options before, and a
  permanent public promise ruling that out was premature. Fixed the
  `why-grid` CSS alongside this (`repeat(auto-fit,minmax(240px,1fr))`
  instead of a fixed 2-column layout) so the remaining 3 cards fill one
  row cleanly instead of leaving an orphaned trailing card.
- **5 static pages** (`methodology.html`, `privacy.html`, `terms.html`,
  `responsible-play.html`, `contact.html`): added `<link rel="canonical">`
  to each, matching `sitemap.xml`'s exact URL format — previously only
  the homepage had one, despite all these pages being reachable from both
  `pickgauge.com` and the Vercel hostname.
- `tests/test_sitemap_social_metadata.py` extended with a real check that
  all 6 sitemap URLs have a matching canonical tag on their actual page
  (21/21 checks, up from 15).

### Aug 28: DNS/email — DMARC completed, closing out the full SPF/DKIM/DMARC set
- `_dmarc` TXT record added (`v=DMARC1; p=none; rua=mailto:support@pickgauge.com`)
  after the 48h SPF/DKIM settle window. Confirmed via MXToolbox: record
  published, valid syntax, single record (no conflicting duplicate),
  external validation passed. The one red "DMARC Policy Not Enabled" flag
  MXToolbox shows is expected/correct — `p=none` (monitor-only) is the
  deliberate starting point, not a gap. **All three of SPF/DKIM/DMARC are
  now fully complete** — this was the last piece.

---

## A real, worth-knowing false alarm from this session

Drew reported PickGauge Model # "randomly" failing to compute for a Splash
test pool's Week 1 games, working fine elsewhere. Investigated at length —
**not a bug.** `api/fetch_predictions.py` scrapes thepredictiontracker.com's
*current* weekly CSV with no mechanism to request a different week; the
upstream source itself only publishes the real-world current week's lines.
Today's calendar date fell within Week 0's window, so Week 1 games
genuinely had no predictions data anywhere yet — not a matching bug, not a
pool-context-specific issue. Will resolve on its own as the season
progresses. **If a future session sees this same symptom reported again,
check the real-world date against the pool's week before assuming
regression.**

---

## Still open (see `CURRENT_STATE.md`'s "Highest-priority remaining work" for the definitive list)

1. **Confirm the Vercel `CLERK_JWKS_URL` revert actually happened** and a
   fresh deploy went out — see above, this is the one thing this session
   couldn't verify directly. If it hasn't happened, live sign-in is
   currently broken.
2. Full production smoke test + email/password sign-in (Google OAuth
   already confirmed).
3. Physical iPhone/Android signoff.
4. Live 2026 CFBD/closing-line validation once real games are played.

**Done, no longer open**: SPF + DKIM + DMARC (all three, confirmed), the
real Splash pool-sheet acceptance test, Clerk JWT `azp` hardening, live
Upstash CAS concurrency test, the dependency security upgrade, first-party
analytics + beta feedback, and now the full domain-block saga described
above.

## Explicitly closed off — do not re-suggest to Drew
Hotspot/tethering as a daily workaround (declined, repeatedly). Contacting
his own employer's IT department (declined, repeatedly — submitting
corrections directly to filtering vendors as the site owner is different
and is what actually happened). A Firebase migration (seriously scoped,
then abandoned once the Clerk Development-instance approach achieved the
same practical outcome with far less engineering risk — don't resurrect
unless the Clerk approach hits a real, new problem).
