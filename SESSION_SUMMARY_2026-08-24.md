# PickGauge — Session Summary, Aug 24 2026 (for ChatGPT handoff)

**Scope of this session: almost entirely infrastructure/deployment work
done directly in Vercel, Clerk, Google Cloud Console, and Google
Workspace dashboards — not code.** Only one file changed. This note
exists so a fresh ChatGPT session has context without re-deriving it
from the repo diff, since most of what changed isn't visible in the
codebase at all.

This is a plain dated session note, not a new versioned entry in
`handoff.md`'s established format — `handoff.md` is a precise,
code-focused changelog (currently v26) and nothing here rises to that
level of code change. If a formal `handoff.md` entry is wanted for this
session, ask Claude to add one explicitly.

---

## The one code change

**`app/index.html`** — Clerk production cutover. Both Clerk `<script>`
tags (`ui.browser.js`, `clerk.browser.js`) repointed from the dev
instance (`simple-monarch-32.clerk.accounts.dev`) to the new production
custom domain (`clerk.pickgauge.com`), and `data-clerk-publishable-key`
swapped from `pk_test_...` to the real `pk_live_...` key. Full test
suite (47/47 files) confirmed passing after the change. This was
delivered as a complete file and pasted into GitHub directly by Drew —
already live.

No other files changed this session.

---

## Infrastructure completed this session

- **Domain:** `pickgauge.com` purchased through Vercel, DNS
  auto-configured, `www`/apex redirect set, SSL confirmed live.
  `*.vercel.app` fallback URL intentionally left as-is (unlisted, low
  risk) — not redirected.
- **Clerk:** production instance created (cloned from dev), custom
  domain `clerk.pickgauge.com` connected via CNAME
  (`frontend-api.clerk.services`), `CLERK_JWKS_URL` updated in Vercel
  to match. Google OAuth SSO connection fully configured end-to-end
  (Google Cloud OAuth consent screen published, client ID/secret
  correctly set in Clerk after an initial secret-mismatch bug was
  fixed) and confirmed working. Email/password sign-in has **not** yet
  been separately tested on production — only Google OAuth was
  verified live.
- **Vercel env vars (Production):** `CRON_SECRET` and
  `PICKGAUGE_ADMIN_UIDS` (real production Clerk UID) added.
  `CLERK_JWKS_URL` updated. Confirmed already-correct:
  `CFBD_API_KEY`, `ODDS_API_KEY`, `STORAGE_KV_REST_API_URL`/`TOKEN`.
  Four vars confirmed unused in code and flagged for optional cleanup
  (not yet deleted): `STORAGE_KV_REST_API_READ_ONLY_TOKEN`,
  `STORAGE_KV_URL`, `STORAGE_REDIS_URL`, `APP_SECRET`.
- **Redis:** confirmed the production database is Vercel's own
  Upstash-backed Storage integration (`upstash-kv-byzantium-flame`,
  region `iad1`, **Free tier — 1 database limit, 500k monthly
  commands**). Preview/dev isolation resolved by setting that
  database's "Allowed Environments" to Production-only (not by
  provisioning a second database — free tier doesn't allow one).
  Vercel Function Region confirmed matching (`iad1`).
- **Email:** `support@pickgauge.com` live via Google Workspace. Domain
  verification (TXT) and mail routing (MX) done. **SPF and DKIM records
  were NOT set up** — still open, matters for outbound deliverability.
- **Legal:** `terms.html` audited against the informational-only /
  no-wagering-facilitation / user-jurisdiction-responsibility
  requirements — passes as-is, no changes made. `responsible-play.html`
  exists but has **not** been audited yet.

## Still open (see `PICKGAUGE_LAUNCH_CHECKLIST.md` for full detail)

- Email/password sign-in test on production
- SPF/DKIM records
- `responsible-play.html` content audit
- Cron job live-fire verification (needs an actual game day)
- Full manual smoke test on production
- Redis backup/export plan, key TTL review
- Marketing/go-live section — untouched

## New feature discussed, not yet built

Drew raised a real product gap: no way for a user to bring their own
model numbers into Model # today (the only per-user input is the
Brad Powers PDF-derived BP/Comp pair — someone else's model, just
imported per-user). Discussed as a natural extension of the existing
`weightedModel()` input pattern (same shape as BP/Comp: per-game
number, weight, enable toggle), not an architecture change.

Scoped direction agreed in conversation (not yet built): **single
"My Numbers" slot, CSV import as primary path** (manual entry as
fallback), reusing the existing fuzzy team-matching infrastructure
(`teamMatch()`/`teamTokens()`/`aliasOf()` in `app/js/pdf-import.js`)
so users don't need exact team-name strings, and the same
unmatched-game count/console-log UX already used for BP PDF import.
Proposed CSV format:

```
Away Team, Home Team, Line
Ohio State, Michigan, -3.5
```

Line in home-team perspective (negative = home favored), matching the
sign convention already used everywhere else (Vegas, BP, Comp).

**Open question left unresolved:** whether CSV column headers need to
match exactly, or should use flexible header-content detection (like
the PDF importer already does) rather than fixed indices. No code
written yet — this is scoping only, needs explicit go-ahead before
implementation.
