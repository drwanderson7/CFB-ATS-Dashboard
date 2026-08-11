# CFB ATS Edge Board — What's Left To Do

A plain tracker, separate from the detailed `handoff.md` (which is meant
for handing context to another AI session, not for tracking progress at a
glance). Check things off as you confirm them. Last updated: this session.

---

## 🚨 Do this first — not a code fix, it's on you

- [ ] **Rotate your credentials.** A Word doc you shared for review had
  real secrets pasted in plaintext — `CLERK_SECRET_KEY`, `ODDS_API_KEY`,
  `CFBD_API_KEY`, and an app secret (`APP_Secret = edge`). That doc has
  now been uploaded to both ChatGPT and Claude. Rotate all four:
  - `CLERK_SECRET_KEY` — **most urgent**, full backend access to your
    entire user base. Rotate in the Clerk dashboard, update in Vercel.
  - `ODDS_API_KEY` — rotate at the-odds-api.com.
  - `CFBD_API_KEY` — rotate at collegefootballdata.com.
  - App secret — replace `edge` with something actually random, wherever
    it's used.

---

## 🔴 Biggest remaining code problem: writes aren't truly atomic

Everything below is one underlying issue: your sync system checks "did
anything change?" and then writes, but those are two separate steps, not
one — so two things happening at nearly the same moment can both pass the
check and one silently overwrites the other. This is bigger than the
earlier fixes and hasn't been started.

- [ ] **Private-state saves (picks/entries) can still silently lose data
  under real concurrency.** The revision-check system built earlier
  catches a stale device writing *after* a newer write already landed —
  but not two devices writing at *the same moment*. Needs an actual
  atomic compare-and-set on Upstash (a Lua/EVAL script), not a
  read-then-check-then-write across separate HTTP calls.
- [ ] **Skipping the revision number on a write still bypasses the check
  entirely**, even for an existing account — it should be required on
  every private write, not just treated as "must be a new user."
- [ ] **The nightly/manual grader has the identical race** — it can
  silently overwrite a pick you added while grading was running.
- [ ] **Shared data (odds/predictions/pools) can race itself** across
  different endpoints — likely needs restructuring from "one big JSON
  blob" to per-field storage so independent writers can't stomp each
  other.

---

## 🟡 Smaller, not urgent

- [ ] **Pin the Clerk JS version.** Still on `@clerk/clerk-js@latest`,
  meaning production behavior can change without you deploying anything.
- [ ] **Test the actual live Vercel deployment.** Everything fixed so far
  has been verified with mocked Clerk/Redis in a sandbox — not against
  your real deployment, real database, or real logins. This matters more
  than it sounds like.
- [ ] **A few fixes don't have automated tests yet**: the API-key-header
  change, and the manual-grading authorization split. Both were
  code-reviewed, not test-proven like everything else.
- [ ] **Confirm the Splash pool locked-line sign convention** with a real
  sample from after a Wednesday lock — still unconfirmed.
- [ ] **Chrome credential popup issue** from a while back — left
  mid-diagnosis, unclear if it's still happening.
- [ ] `README.md` still hasn't been pushed to the repo.
- [ ] Snapshot tab's mobile table isn't pixel-matched to the main board's
  mobile layout (it works, just not as polished).
- [ ] One easy win: add a single `npm test` (or similar) command that
  runs all 5 test files at once, ideally via GitHub Actions on every
  push — right now you have to know to run 5 separate commands.

---

## 🔵 Bigger, not urgent (future feature work, not bug fixes)

- [ ] **Raw Model # vs. Market-Adjusted Model #.** Investigated and found
  the underlying mechanism (adjustable Vegas weight) already does what
  you wanted here — closed as-is, but a UI tooltip explaining the
  tradeoff more clearly is a nice-to-have.
- [ ] **Store a real game ID with each pick** (instead of matching by team
  name) for more reliable grading long-term.
- [ ] First real-season live test — the single highest-value thing to
  actually do once you're comfortable with where things stand.

---

## ✅ Already fixed and tested (77 automated checks passing)

- Legacy account migration could expose another user's private data
- Any signed-in user could overwrite shared data for everyone
- Pool picks weren't being auto-graded (the most damaging bug — most real
  picks are pool picks)
- Sportsbook selection was getting baked into shared data for everyone
- EV math was counting pushes as losses
- Manual grading was grading every user, not just whoever clicked it
- Odds/CFBD API keys moved off URLs onto headers
- Auto-grade lookback widened from 3 to 7 days
- Auth-code duplication across 7 files now has an automated drift check
- New "Snapshot" tab — quick-scan weekly summary, separate from the full
  board
- Landing page + app split into `/` and `/app`
- `_publish_pool` now enforces ownership (you can't overwrite someone
  else's published pool)
- Global "clear predictions" removed (it let anyone wipe shared data for
  everyone) — now local-only
- Dead legacy-claim button removed from Settings (was calling an endpoint
  that would always fail)
- Snapshot's "Full Slate" table was showing every game (34, in a real
  pool) instead of a quick scan — now capped at 8, with a "See full
  slate →" link to the real board when there's more

---

**If you only do three things next:** rotate the credentials, then pick
someone to actually test the app live on Vercel with a real account, then
come back to the atomic-writes problem before leaning on this for a real
pool with real money on the line.
