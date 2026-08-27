# pickgauge.com Work-Network Block — Investigation Handoff (Aug 27, 2026)

**Read this before touching auth/domain architecture.** Drew cannot access
`pickgauge.com` — or anything requiring sign-in — from his work computer or
phone on his office network. This is now fully diagnosed. This doc exists so
a fresh session (Claude or ChatGPT) doesn't have to re-derive any of it, and
so nobody proposes an already-ruled-out "fix" that would actually make
things worse.

## The core, confirmed fact

**Cisco Talos Intelligence categorizes `pickgauge.com`'s content as
"Gambling."** Checked directly at Talos's own reputation lookup tool
(`talosintelligence.com/reputation_center`). Not on their malicious block
list — reputation shows "Neutral" — just tagged under that content category.
Many corporate web filters (regardless of vendor) block by category, and
Gambling is one of the most commonly blocked categories in default
corporate policy.

## Everything that was tested, in order, with real screenshots at each step

1. **Confirmed it's not a real outage** — works fine on cellular data (phone,
   wifi off).
2. **Confirmed it's not literally the word "pick"** — `nflpickwatch.com`
   (thematically almost identical: NFL picks-against-the-spread tracking)
   loads fine on the same blocked network.
3. **Confirmed it's not the SentinelOne agent on Drew's laptop** — opened
   the agent's own Agent Details panel: **Firewall Control is explicitly
   Off**. SentinelOne isn't doing any network/web blocking on this machine
   at all right now.
4. **Confirmed it's not Cisco Umbrella via Cisco Secure Client** — opened
   the Secure Client app's own "Installed Modules" list: only `AnyConnect
   VPN`, `Customer Experience Feedback`, and `Secure Client UI`. No Umbrella
   module installed at all.
5. **Confirmed it's not Windows Defender's Network Protection** — checked
   Windows Security → App & browser control → Reputation-based protection.
   No Network Protection toggle even shown on this build/policy.
6. **Confirmed it's not laptop-specific at all** — Drew's personal phone,
   with zero corporate software installed, also fails to load
   `pickgauge.com` on the same office wifi. This is a network-edge device
   (firewall/proxy), not anything installed on any one machine.
7. **Found the actual category tag** — Cisco Talos reputation lookup for
   `pickgauge.com`: Content Category = **Gambling**. Not on Talos's own
   block list (Neutral reputation) — just categorized that way.
8. **Tested whether category alone explains it** — `nflpickwatch.com` is
   ALSO categorized "Gambling" on Talos, and it still loads fine. So the
   category tag is a contributing factor, not the sole mechanism — most
   likely combined with domain age/reputation/traffic-history scoring
   that a young, low-traffic domain like `pickgauge.com` doesn't have yet.
   (`nflpickwatch.com` is a long-established site.)
9. **Isolated content vs. domain as the actual variable** — the exact same
   deployment, same HTML/content, is reachable at
   `cfb-ats-dashboard.vercel.app` (Vercel's own auto-assigned hostname for
   this same project) with ZERO issues on the same blocked network. Ran
   that same URL through the Talos lookup: Content Category = **"Computers
   and Internet"**, not Gambling — confirming Talos's categorization is
   genuinely per-domain (crawled/tagged independently), not purely
   content-fingerprint-based. This is about `pickgauge.com` specifically,
   not the app's content in the abstract.
10. **BUT the Vercel-domain workaround doesn't actually solve daily use** —
    Clerk (the auth provider) is served from `clerk.pickgauge.com`
    specifically. Sign-in fails identically even when the page itself
    loads from the Vercel domain, because the browser still has to reach
    `clerk.pickgauge.com` for the actual auth calls. Confirmed via
    console: `net::ERR_CONNECTION_RESET` on both `ui.browser.js` and
    `clerk.pickgauge.com/.../clerk.browser.js`. **There is currently no
    working path to sign in on this network at all**, regardless of which
    frontend domain is loaded.

## What this rules out as a "fix"

- **Removing the custom domain / Vercel-only setup** — doesn't work.
  Clerk's auth calls are pinned to `clerk.pickgauge.com` regardless of
  which frontend URL loads the page. Confirmed directly (see #10 above).
- **A client-side "fall back to Clerk's default domain" mechanism** —
  investigated and ruled out. Checked Drew's actual Clerk Dashboard →
  Domains → pickgauge.com → Configure: there is no parallel/secondary
  `.clerk.accounts.dev` domain sitting alongside the custom domain for
  this instance. The only domain-change action available is "Change
  domain," and Clerk's own UI explicitly warns **"Changing the domain
  will result in downtime"** — it's a one-way cutover, not something to
  run in parallel or fall back to automatically.
- **Switching auth providers to dodge the block** — doesn't address root
  cause. The block is on the `pickgauge.com` domain's reputation, not
  Clerk specifically. Any auth provider hosted on a `pickgauge.com`
  subdomain (`auth.pickgauge.com`, `login.pickgauge.com`, etc.) would
  inherit the identical block.
- **Contacting Drew's own employer's IT department** — explicitly,
  repeatedly declined by Drew. Do not suggest this again in a future
  session. Submitting a correction directly to Talos (or Google Safe
  Browsing / VirusTotal) as the SITE OWNER is different and IS in
  progress (see below) — that's not the same as asking his employer for
  anything.
- **A cellular hotspot / phone tethering as a daily workaround** —
  explicitly, repeatedly declined by Drew as not viable long-term. Do not
  re-suggest this.

## What IS in progress

- **Talos recategorization ticket submitted** (Drew, via the "Submit
  Content Categorization Ticket" button on the Talos reputation lookup
  page) — requesting a more accurate category (the site doesn't accept
  wagers or handle money; it's pick'em pool tracking/analytics).
  Propagation timeline unknown, could be days to weeks, not guaranteed.
- **Google Safe Browsing and VirusTotal corrections** — recommended,
  not yet confirmed submitted by Drew as of this handoff. Worth checking
  status in a future session since different downstream filters may
  source from different databases.
- Genuinely unknown whether Drew's actual office network filter is
  Cisco/Talos-based at all — the client-side agents that WERE ruled out
  (SentinelOne, Cisco Secure Client's Umbrella module) don't confirm which
  device IS doing the blocking, only which two aren't. **A Talos fix might
  not even touch the real mechanism.** This is a real, acknowledged gap.

## Where things stand now: pursuing a Firebase Auth migration

Given the reputation-fix path has real uncertainty (unknown timeline, and
we don't even know for certain the blocking device is Talos-sourced) and
every other workaround has been ruled out or declined, Drew has asked to
explore migrating off Clerk to **Firebase Authentication**, keeping Google
OAuth as a sign-in option. Key context for whoever picks this up:

- **Zero real users exist yet besides Drew himself** — this dramatically
  de-risks the migration. No user data migration problem, no password
  reset campaign, no downtime-sensitive cutover for real customers. This
  is the main reason the migration is being considered seriously at all
  despite the real engineering cost.
- **Why Firebase specifically over Supabase**: the project's backend state
  lives in Upstash Redis, not a SQL database, so Supabase's bundled
  Postgres isn't a natural fit unless used purely for its standalone auth
  service. Firebase Auth used standalone is the more surgical match for
  the current stack.
- **Firebase Auth's architecture avoids the specific problem that made a
  Clerk-side fix impossible**: Firebase issues a JWT the client stores
  itself (not a cookie set by a separate hosted domain), so it doesn't
  inherit Clerk's third-party-cookie/Safari problem the same way — this
  was a real, substantive correction made mid-conversation (Claude
  initially overstated the cookie issue as universal to all providers;
  it's actually specific to Clerk's own cookie-based session architecture,
  not something every third-party auth provider has).
- **Verified technical approach for backend token verification** (checked
  against Firebase's own docs, not assumed): Firebase ID tokens are
  RS256-signed JWTs, verifiable via a real JWKS-format endpoint —
  `https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`
  — issuer `https://securetoken.google.com/<PROJECT_ID>`, audience
  `<PROJECT_ID>`. This means the EXACT same `PyJWT` + `PyJWKClient` pattern
  already used for Clerk across all 9 duplicated `api/*.py` files can be
  reused with minimal structural change — just pointed at different real
  values, not a different verification architecture. This significantly
  lowers migration risk/complexity versus starting from scratch.
- **What's still needed before real code can be written**: Drew needs to
  create an actual Firebase project in the Firebase Console, enable the
  Google sign-in provider, and retrieve the real project's web SDK config
  (`apiKey`, `authDomain`, `projectId` at minimum) and its real project ID
  for the backend verification values above. None of these can be
  fabricated safely — same principle that already correctly blocked
  guessing a Clerk fallback domain earlier in this same investigation.
- **Real migration scope, once real config values exist**: rewrite
  frontend Clerk initialization/sign-in UI (`app/index.html`,
  `app/js/init.js`) for Firebase's Google sign-in flow; rewrite
  `verify_user()` identically across all 9 `api/*.py` files (no shared
  imports in this architecture, so this must stay hand-synced exactly
  like the Clerk version was, with `tests/test_auth_sync.py`'s drift
  check updated to match); update `is_admin()`'s UID format expectations
  (`PICKGAUGE_ADMIN_UIDS` currently expects Clerk's `user_xxxx` format,
  would need to expect Firebase UIDs instead); full test suite pass
  before considering this done, same standard as every other change in
  this project.
- **Not yet started**: this handoff exists at the "confirmed technical
  approach, waiting on Drew's real Firebase project config" stage. No
  code has been written yet.

## One thing worth deciding explicitly in a future session

Whether to keep `clerk.pickgauge.com`'s DNS records and Clerk instance
around post-migration (harmless if left in place, but worth a deliberate
decision rather than silent cruft) versus tearing them down once Firebase
is confirmed fully working.
