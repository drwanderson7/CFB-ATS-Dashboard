# PickGauge — ChatGPT Launch-Readiness Continuation, Aug 25 2026

**Read `CURRENT_STATE.md` first — it remains the single source of truth.**
This note covers only the changes made after Claude's `SESSION_SUMMARY_2026-08-25.md`.

## Work completed

### 1. HTML/attribute-injection P0 closed with permanent regression coverage

The prior audit concern centered on `board.js`'s unescaped
`data-pickteam="${g.key}"`. Re-checked against the actual current tree:

- `g.key` is created by `mkey()` -> `norm()`
- `norm()` strips everything except lowercase `[a-z0-9]`
- `mkey()` inserts only the literal `@`
- visible team names in the pick buttons are passed through `esc()`
- `tr.dataset.key` is assigned through the DOM dataset API, not HTML interpolation

Added `tests/test_html_injection_safety.mjs` with hostile payloads including
tag/attribute-breaking strings. It pins the escaping and safe-key invariants
and the relevant Board render paths.

**Result: 18/18 checks pass.** The old P0 is now closed as no-repro unless a
future concrete exploit bypasses these pinned invariants.

### 2. Sagarin #1/#2 backtest mapping resolved and applied

Independent source verification supports the mapping already proposed in
Claude's handoff:

- Sagarin's own documentation says PREDICTOR is also known as PURE_POINTS.
  Therefore the backtest's **#1 "Sagarin Points" -> `sagpred`**.
- The Prediction Tracker separately names "Sagarin Ratings" as distinct from
  Sagarin Predictor / Golden Mean / Recent.
  Therefore the backtest's **#2 "Sagarin Ratings" -> `sag`**.

Applied to `TOP_SYSTEM_RANKS`:

- `sagpred: {rank:1, composite:null}`
- `sag: {rank:2, composite:null}`

The original handoff did not retain the numeric composite values for #1/#2.
They remain `null` deliberately. `prediction-tracker.js` now has a null-safe
tooltip branch, so the UI shows the Top-10 badge/rank without inventing a
composite score or displaying "composite null".

Added `tests/test_sagarin_mapping_logic.mjs`.

**Result: 8/8 checks pass.**

### 3. Redis TTL/expiry audit completed

Added `tests/test_redis_ttl_integrity.py`.

Confirmed:

- private account state CAS writes use Redis `SET` with no TTL
- shared pools use the same non-expiring CAS primitive
- shared odds and shared predictions are non-expiring keys
- grader cache writes are non-expiring
- rate-limit buckets expire intentionally
- immutable weekly prediction snapshots intentionally expire after ~26 weeks

**Result: 8/8 checks pass.**

Conclusion: picks/pools/account state will not silently disappear mid-season
because of a Redis TTL in the current code.

### 4. Responsible Play content audited and updated

Updated `responsible-play.html` to:

- mirror Terms' legal-age/local-law framing
- clearly state PickGauge is not a sportsbook
- keep `1-800-MY-RESET` as the current National Problem Gambling Helpline
- retain `1-800-522-4700` as an active alternate
- link directly to `https://www.1800myreset.org` for online chat/help

Added `tests/test_responsible_play_content.py`.

**Result: 6/6 checks pass.**

No click-through age gate was added. Current launch decision: the explicit
legal-age/local-law language is appropriate for the current informational tool
that does not process wagers. Revisit a hard gate if regulated integrations are
added later.

### 5. Status-document drift fixed

`CURRENT_STATE.md` and `PICKGAUGE_LAUNCH_CHECKLIST.md` were reconciled.

Important stale items removed/closed:

- HSTS was already shipped in `vercel.json`; it is no longer listed as missing.
- Injection concern is closed with regression coverage.
- Sagarin mapping is now applied.
- Redis TTL audit is complete.
- Responsible Play content audit is complete.

The active priority list is now launch-readiness: production smoke/auth,
real locked pool-sheet acceptance, production JWT inspection, SPF/DKIM/DMARC,
live CAS, physical mobile signoff, and live 2026 CFBD/closing-line validation.

## Test status

Five permanent test files were added across this continuation, bringing the repo to **53 permanent test
files total**.

Current environment result:

- `scripts/test_all.sh --fast` -> **52/52 non-browser test files pass**
- `tests/test_e2e_ui_behaviors.py` cannot run in this sandbox because Chromium
  returns `ERR_BLOCKED_BY_ADMINISTRATOR` for both `localhost` and `127.0.0.1`.
  This is an environment policy block before any application assertion runs.
- Claude's pre-change Aug 25 handoff recorded the same browser suite at
  **71/71 passing** in an environment that allowed localhost.

**Before deploying this continuation, re-run the complete suite in CI/Claude
so the browser file executes against the latest changes.**

## Files changed

- `app/js/main.js`
- `app/js/prediction-tracker.js`
- `app/data/pred-systems.js` (comment/source-of-truth cleanup only)
- `responsible-play.html`
- `tests/test_html_injection_safety.mjs` (new)
- `tests/test_sagarin_mapping_logic.mjs` (new)
- `tests/test_redis_ttl_integrity.py` (new)
- `tests/test_responsible_play_content.py` (new)
- `CURRENT_STATE.md`
- `PICKGAUGE_LAUNCH_CHECKLIST.md`
- this file

## Still requires live/user access

1. Email/password or email-code production sign-in test
2. Full incognito production smoke test
3. Real locked Splash/ESPN/OFP pool-sheet acceptance test
4. Inspect one real production Clerk JWT and decide final `aud`/`azp` fail-closed rules
5. Apply SPF/DKIM/DMARC from `DNS_EMAIL_SETUP.md`
6. Run `_live_cas_concurrency_test.py` with a fresh real Clerk token
7. Physical iPhone + Android signoff
8. Live 2026 CFBD/closing-line validation when actual game conditions exist


## Follow-up: live all-API 401 auth regression

Drew then tested the live app and captured DevTools showing the same 401 on `/api/state?scope=shared`, `/api/state?scope=user`, `/api/fetch_cfbd`, `/api/fetch_teams`, and `/api/fetch_predictions`. Because every protected endpoint failed together, this is definitively an authentication-path failure before the prediction source is contacted — not a Prediction Tracker scrape failure.

Patch applied:

- all 8 `verify_user()` copies now accept both `https://pickgauge.com` and `https://www.pickgauge.com` as valid Clerk `azp` origins; optional intentional aliases can be supplied via `PICKGAUGE_ALLOWED_AZP`
- `apiFetch()` retries one auth-shaped 401 exactly once after forcing Clerk to mint a fresh token with `session.getToken({skipCache:true})`
- feature-key 401s (Odds/CFBD key problems) are not retried
- `tests/test_api_auth_retry_logic.mjs`: 6/6
- `tests/test_clerk_token_hardening.py`: 11/11
- `tests/test_auth_sync.py`: 24/24, confirming all 8 server auth copies remain in sync
- full non-browser suite: 52/52 files pass

This patch must be deployed and retested live before the auth item can be closed. If a persistent 401 remains after deploy, inspect one freshly minted production Clerk token's *claims only* (`iss`, `azp`, `aud`, `exp`; never paste the raw token) because the remaining likely failure point would be issuer/claim mismatch rather than prediction logic.


## Aug 25 earlier implementation — PickGauge Model # preset (superseded later the same day)

Drew first chose a branded **PickGauge Model #** preset inside the Prediction Systems dropdown. This implementation was later superseded by the standalone-mode correction documented below; premium membership/gating is deferred. The requested weights are exactly 100%: Sagarin Ratings 13%, Sagarin Predictor 13%, Dokter Entropy 22%, SP+ 20%, current/updated Vegas 22%, Big 200 10%. Implemented as one button (`#pickGaugeModelBtn`) that replaces the custom selection with exactly the five non-market systems and those six fixed weights.

Important pool behavior: the preset's Vegas ingredient uses the CURRENT live market (`g.liveVegas`) after a pool locks; Edge still compares the resulting model number against the locked pool spread. All six ingredients are required -- no silent re-normalization around missing sources. Pick snapshots store `modelPresetAtPick:"pickgauge"` and preserve the live Vegas model ingredient separately from the locked decision reference. The active button state is derived from exact live config, so any manual change deactivates the branded state automatically. This earlier draft briefly listed PickGauge Model # under Pro; that pricing line was removed in the later standalone-mode correction because membership functionality is being handled later.

The original regression file was `tests/test_pickgauge_premium_model_logic.mjs` (23/23 at that point); it was later renamed/reworked as `tests/test_pickgauge_model_logic.mjs` for standalone behavior. Full `scripts/test_all.sh --fast`: **53/53 files passing**.

Also: the live auth fix from the prior ChatGPT turn was deployed and Drew confirmed prediction loading is working again.


## PickGauge Model # proprietary-weight UI follow-up (superseded in part by standalone mode)
- Drew confirmed the PickGauge Model # calculation behavior, but requested that the exact weights not be exposed when the branded model is enabled.
- At this intermediate stage, Prediction Systems still showed the five model ingredients while hiding numeric weights. The later standalone-mode correction below supersedes that UI: the ingredients are no longer auto-enabled/shown just because PickGauge is active.
- Button tooltips, the in-app methodology note, and draft pricing copy no longer disclose the 13/13/22/20/22/10 recipe.
- If a user edits the ingredient list or clicks Clear all after applying the preset, the preset weights are scrubbed before custom numeric controls return, preventing an accidental UI reveal.
- Exact weights remain internal and regression-pinned. Long-term, true formula secrecy would require moving the calculation server-side; no membership/entitlement work is being added yet.

- Full fast regression suite after this follow-up: **53/53 files passing**. Dedicated PickGauge Model # suite: **30/30 checks passing**.


## Aug 25 continuation — standalone PickGauge Model # UX correction

Drew clarified the intended product behavior: **enabling PickGauge Model # should show PickGauge Model # itself on the board, not automatically expose all five component model columns.** Premium membership/gating is explicitly deferred; this change is only about the model experience.

Implementation was reworked from a preset-shaped configuration to a standalone mode:
- `state.pickGaugeModelEnabled` is now the source of truth for whether PickGauge Model # is active.
- Clicking the button turns standalone PickGauge mode on and clears the current visible/custom system selection, so the board starts with one aggregate **PickGauge Model #** column.
- The five internal prediction-model ingredients are no longer written into `state.enabledSystems`, so they do not appear as columns just because PickGauge is enabled.
- A user can manually enable any individual prediction system afterward; it appears as a separate comparison column but does **not** change the PickGauge calculation.
- Clicking PickGauge Model # again turns the standalone mode off while preserving any comparison systems the user manually enabled afterward.
- Board/row labels dynamically say **PickGauge Model #** while the mode is active; Snapshot's model detail shows the aggregate only and says the internal component lines remain behind the scenes.
- Weekly Setup treats active PickGauge Model # as requiring prediction data even when zero individual systems are enabled.
- Model Agreement still counts the five predictive-model ingredients behind PickGauge (Vegas excluded), so agreement does not disappear just because the components are hidden.
- A one-time `_pickGaugeStandaloneMigrated` normalization step converts the immediately-prior Aug 25 preset-shaped saved state into the new standalone flag, removing those auto-enabled component columns so existing users do not carry the old UX forward.
- Exact recipe remains unchanged internally: 13/13/22/20/22/10 and current-live-Vegas-in-locked-pool behavior are unchanged.
- Pick snapshots continue tagging `modelPresetAtPick:"pickgauge"`; the proprietary numeric weights are no longer copied into user-exportable snapshot state.
- The premature PickGauge Model # line added to draft `pricing.html` was removed because membership functionality is being handled later.

Regression coverage was renamed/reworked as `tests/test_pickgauge_model_logic.mjs`: **37/37 dedicated checks passing**. Final fast suite: **53/53 test files passing**.
