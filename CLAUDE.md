# PickGauge — instructions for Claude Code

Read `CURRENT_STATE.md` first. It describes the app, the stack and the rules below in more detail.
The source code is the truth; when a note and the code disagree, trust the code.

## Owner and workflow
- One owner (Drew). He works in the browser only: no local terminal, no git CLI.
- Work on a branch and open a pull request. Never push to `main`.
- Vercel builds a preview for each branch, and merging the PR deploys to production.
- Keep each PR to one topic, so it is easy to review and safe to revert.
- PR description: plain language for a non-developer. What changed for the user, how it was verified, anything Drew must check by hand on the preview.

## Hard rules
1. **Edit sources, never `app/dist/` by hand.** After ANY change under `app/js`, `app/data`, `app/css` or `app/survivor-core`:
   - run `scripts/build.sh`;
   - commit the regenerated `app/dist/` in the same PR.

   `tests/test_bundle_in_sync.mjs` fails if you forget.
2. **Tests must pass.** Run `scripts/test_all.sh --fast` before every PR. It must pass with 0 failures.
   - Add or update tests for every behavior change.
   - Prefer tests that run the real extracted functions, not text matching.
   - Browser tests are `tests/test_e2e_*.py` (Playwright and Chromium, every `/api/*` call mocked). Run the ones related to your change if Chromium is available.
   - 4 known-stale browser tests fail on purpose: `test_e2e_mobile_ux.py`, `test_e2e_pools_hides_shared_widgets.py`, `test_e2e_weekly_setup.py` and `test_e2e_ui_behaviors.py`.
3. **UI changes:** check them at 390px and 360px phone widths plus desktop. Make sure there is no sideways page scroll and no overlaps.
4. **Never** commit secrets, `.env` files or API keys. **Never** replace the real Clerk publishable key or domain in `app/index.html` with placeholders.
5. **Don't** edit `vercel.json` cron or function settings unless the task says so. The site runs on the Vercel Hobby plan, so a cron can run at most once a day.
6. **Docs with every PR:**
   - add a dated entry at the top of `docs/CHANGELOG.md`;
   - update `CURRENT_STATE.md` (present tense) if behavior changed.

   Don't create to-do, session-summary or handoff files. Drew keeps his to-do list in chat.

## Conventions
- Vanilla JS, one shared global scope (not modules). Survivor's core under `app/survivor-core/` is ES modules.
- Spread convention: home-team perspective, negative means home favored (`g.vegas`, `myNumber()`).
- Survivor JS and CSS load lazily on the first Survivor tab open. Tests must open the tab before touching Survivor globals.
- Python API functions in `api/` don't share imports. Helpers are duplicated on purpose and drift-tested, so change both copies.
- Keep the existing visual style. Secondary buttons keep their visible outlines.
