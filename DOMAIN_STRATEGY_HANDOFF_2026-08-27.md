# PickGauge — Domain Strategy Handoff for ChatGPT (Aug 27, 2026)

**The question Drew wants worked through rigorously**: given `pickgauge.com` is
categorized "Gambling" by multiple filtering vendors and blocked on at least
one real corporate network (his own), what should the actual long-term
domain/hosting strategy be? Launch fully on a Vercel-hosted identity with a
paywall there? Wait out the recategorization and keep `pickgauge.com` as the
real domain? Something else? This doc lays out exactly where things stand so
that question can be answered with full context, not re-litigated from
scratch.

**One thing to flag before anything else: don't waste time on Week 1
predictions "not loading."** Investigated at length this session and it's
NOT a bug — `api/fetch_predictions.py` scrapes thepredictiontracker.com's
*current* weekly CSV with no way to request a different week; the upstream
source itself only ever has the real-world current week's data. Week 1
games will get real predictions once Week 1 actually becomes the current
week upstream, days out from Week 1's own kickoffs. If a future session
reports this same symptom, check the date first before assuming regression.

---

## Where things actually stand right now

### The categorization findings (confirmed directly, not assumed)
- **Cisco Talos**: `pickgauge.com` categorized Gambling. A correction
  request was submitted; Talos's human reviewer added "Sports and
  Recreation" as an *additional* category but explicitly left Gambling in
  place too (Talos adds categories, doesn't replace them — both being
  present is still enough to keep category-based filters blocking it).
- **Palo Alto (PAN-DB)**: was Gambling + flagged `Newly-Registered-Domain`
  (Palo Alto's own docs say this specific tag is NOT disputable, ages out
  automatically ~32 days from registration). Category corrected to Sports
  after a submitted request.
- **Fortinet (FortiGuard)**: was Gambling + a "Newly Registered Domain" tag
  dated Aug 24 specifically (odd, since the domain is far older than
  Fortinet's ~10-day NRD threshold from that date — likely reflects when
  Fortinet's own crawler first indexed the domain, not true WHOIS
  registration date). Category corrected to Sports after a submitted
  request.
- **Even after Palo Alto and Fortinet both corrected to Sports, the block
  on Drew's own network persisted** — confirmed directly, not assumed
  (he re-tested). This could mean: (a) his office's actual firewall
  appliance hasn't pulled the updated category from the vendor's cloud
  database yet (propagation delay), (b) his office's device is Talos-
  sourced specifically (Talos still shows Gambling), or (c) some other
  vendor entirely that was never checked. **Genuinely still not confirmed
  which vendor/device is actually enforcing the block at his office** —
  this remains an open gap, not resolved by the two corrections.
- **Root mechanism, confirmed via a real `curl -Iv`/`nslookup` test**:
  DNS resolves `pickgauge.com` correctly (no DNS-layer tampering); the
  block happens during the TLS handshake itself (`Recv failure:
  Connection was reset`) — SNI-based filtering at a firewall/proxy,
  reading the plaintext hostname during the handshake and killing the
  connection. This rules out DNS-layer mechanisms (e.g. Cisco Umbrella,
  already independently ruled out earlier by checking Drew's own laptop
  for the Umbrella module — not installed).

### What's already been built/changed today, in response to this
1. **Production auth moved OFF `clerk.pickgauge.com` permanently.** Real
   production sign-in now runs on Clerk's own Development instance
   (`simple-monarch-32.clerk.accounts.dev`) — not a fallback, not
   conditional, the actual only auth path now, for everyone. This alone
   fixes the *auth* half of the problem: `cfb-ats-dashboard.vercel.app`
   now genuinely works end-to-end (sign-in included) on Drew's blocked
   network, confirmed. Real, accepted tradeoff: Clerk calls Development
   instances "not for production," caps at 100 users — a soft guideline,
   deliberately accepted given there's exactly one real user (Drew)
   right now. `clerk.pickgauge.com`'s DNS records were left in place
   (harmless, reversible).
2. **`_ALLOWED_AZP` across all 9 backend files now hardcodes
   `cfb-ats-dashboard.vercel.app`** as a first-class production origin,
   alongside `pickgauge.com`/`www.pickgauge.com` — per Drew's own
   framing, both are now real, permanent, equally-legitimate entry
   points, not "real domain + temporary testing fallback."
3. **Homepage copy softened** for a second Talos submission — "Recommended
   Bet" → "Top Pool Pick," "sportsbook lines" → "market/reference
   spreads," "calculated ATS edge" → "calculated model disagreement,"
   plus an explicit added disclaimer statement. Not yet resubmitted to
   Talos referencing the new content — that's a real next step once this
   deploys.

### What this means for the actual question being asked
**The functional/auth problem is already solved as of today** — the app
works fully, including sign-in, from `cfb-ats-dashboard.vercel.app`
regardless of `pickgauge.com`'s categorization status. What's NOT yet
decided is the **identity/branding/long-term question**: should
`pickgauge.com` remain the intended primary public domain (with
`cfb-ats-dashboard.vercel.app` as a permanent secondary/fallback), or
should the Vercel-hosted identity become the actual primary going
forward, with `pickgauge.com` either abandoned or kept dormant while it
ages?

---

## The three real options, as Drew framed them, with what's actually true about each now

### Option 1: "Launch on Vercel and paywall through Vercel"
Meaning: make the Vercel-hosted domain (possibly renamed — see below) the
real, primary, promoted product surface; `pickgauge.com` becomes secondary
or unused.

**What's already true, confirmed**: this is now **fully functional**, not
theoretical — auth, backend, everything already works there as of today's
changes. This is genuinely just a branding/promotion decision at this
point, not an engineering one.

**What's NOT yet done**: the actual Vercel project is still named
`cfb-ats-dashboard`, giving the ugly default hostname
`cfb-ats-dashboard.vercel.app`. Renaming the Vercel project (Project
Settings → General → Project Name) would give a much better hostname —
e.g. `pickgauge.vercel.app`, if available — genuinely simple, a few
minutes, no code changes needed. Worth doing regardless of which overall
strategy gets chosen, since it costs almost nothing.

**Real downside worth weighing**: `*.vercel.app` as a permanent public
identity is objectively weaker branding than an owned domain, and can
itself read as slightly less trustworthy to some users/security tools
(throwaway subdomains are a common phishing pattern, unrelated to this
app's own reputation). Also throws away the SPF/DKIM email
authentication work already done for `pickgauge.com` — email would need
its own separate consideration if going this route long-term (could keep
`support@pickgauge.com` for email while using the Vercel domain for the
web app itself, decoupling the two — worth exploring, not yet decided).

### Option 2: "Wait it out and hope category changes"
Meaning: keep `pickgauge.com` as the real, primary, promoted domain,
continue pursuing recategorization, accept that some filtered networks
will be blocked in the meantime.

**What's actually true**: this is no longer "hope" in the passive sense —
two of three checked vendors already corrected the category. What's
genuinely uncertain: (a) whether Drew's own specific office device
actually reads from one of the corrected vendors or from Talos (still
uncorrected) or a fourth vendor never checked, (b) how many *other*
potential users might be on similarly filtered networks — this has only
been confirmed as a problem for Drew's own one office network so far, not
established as a widespread issue. Given zero real users exist besides
Drew, there's no actual evidence yet this is costing the product real
users versus being a Drew-specific inconvenience.

**Reasonable middle version of this option, given what's already built**:
since Option 1's functionality already exists as a real fallback now
(not hypothetical), "wait it out" doesn't mean Drew is stuck — he already
has a working path at `cfb-ats-dashboard.vercel.app` today, regardless of
`pickgauge.com`'s status. So this isn't "wait and suffer," it's "keep
`pickgauge.com` as the intended long-term identity while a real fallback
already exists in parallel."

### Option 3 (not explicitly named by Drew, but real given today's changes): Dual/hybrid, indefinitely
Keep both `pickgauge.com` and a renamed Vercel domain as permanent,
equally-real entry points — not a temporary bridge, an ongoing dual
identity. This is closest to what's *already been built* today (both
origins hardcoded as first-class in the `azp` allowlist), just without
yet deciding which one gets the *primary* marketing/promotional push.

**Real cost of this option specifically**: mild ongoing confusion (two
URLs for the same product, which to share/promote/put on a business
card), and it doesn't resolve the underlying categorization problem, just
routes around it — anyone who lands on `pickgauge.com` directly (a search
result, a typed-in guess, a old shared link) on a filtered network still
hits the wall, unless they happen to know to try the Vercel URL instead.

---

## What ChatGPT should actually do with this

Recommend actually deciding between these three (or a variant), with the
real, current facts above as the basis — not re-investigating the
categorization mechanism from scratch, that part is done. Specific
sub-questions worth resolving explicitly rather than left implicit:

1. Should the Vercel project get renamed now (cheap, no-regret action
   regardless of which overall strategy is chosen)?
2. If Option 1 or 3: how should email (`support@pickgauge.com`, currently
   real SPF/DKIM/DMARC-configured) relate to the primary web identity if
   they diverge?
3. Is there real value in determining which specific vendor is blocking
   Drew's own office (the P1 fingerprinting task from the earlier
   ChatGPT plan — Broadcom/Zscaler still never checked) before deciding,
   or is that no longer decision-relevant now that a working fallback
   exists regardless of the outcome?
4. Given zero real users exist yet, is this worth resolving definitively
   before any real user acquisition begins, or reasonable to revisit once
   there's actual evidence of how many potential users are affected?

## Explicitly closed off — do not re-suggest
Firebase migration (evaluated, abandoned — the Clerk Dev-instance move
achieved the same practical outcome with much less engineering risk).
Hotspot/tethering as a daily solution (Drew explicitly, repeatedly
declined). Contacting Drew's own employer's IT department (explicitly,
repeatedly declined — submitting corrections directly to filtering
vendors as the site owner is different and already in progress, that's
fine to continue).
