# PickGauge session summary — 2026-09-09 — P1 terminology + P2 Help/Methodology

## Scope
This pass addresses the remaining UX cleanup from beta feedback: make user-facing terminology consistent and move explanation out of working screens into task-based Help and an accurate public Methodology page. No model formulas, odds logic, grading, pool scoring, Survivor rules, or persistence behavior changed.

## P1 terminology shipped
- `Snapshot` / `Pick Board` terminology from prior work remains `This Week` / `All Games`.
- `Pool Settings` is now user-facing `Pools`.
- No-pool context is `No Pool` or `Market view` instead of `Overall` where it describes the current board context.
- `Prediction systems` is now `Models & weights`.
- `My Blend` is now `Custom Blend`.
- User-facing `Vegas` is now `Market` / `Live Market`.
- `BP` and `Comp` are expanded to `Brad Powers` and `Computer Line` where users see them.
- Legacy `Edge Board` references were removed from user-facing navigation/help/export wording in favor of `All Games`.
- Core PickGauge terms intentionally retained: `PickGauge Model #`, `Edge`, `Cover %`, `My Numbers`, and `CLV`.
- Internal ids/keys such as `vegas`, `bp`, `comp`, `snapshot`, and `board` were deliberately preserved to avoid risky logic migrations.

## P2 Help shipped
The old long-form in-app Edge Board manual was replaced by a task-first Help center:
- “What are you trying to do?” routes directly to This Week, All Games, Pools, Confidence, Survivor, and Results.
- Expandable glossary for PickGauge Model #, Edge, Cover %, Strong/Good/Slim, Market vs locked pool line, CLV, My Numbers, Custom Blend, and Brad Powers / Computer Line.
- Expandable common tasks for refreshing lines, setting up ATS pools, model customization, My Numbers, mobile `Why [team]?`, and backup/restore.
- A compact Deep Dive card links directly to anchored Methodology sections.
- `initHelpNavigation()` reuses existing tab routing rather than introducing new navigation state.

## P2 Methodology shipped
The public Methodology page was rewritten and anchored by topic. Critically, it now matches the current model architecture:
- PickGauge Model # is a fixed proprietary branded blend of five selected prediction models plus a market component; exact weights remain undisclosed.
- It requires the market plus at least 3 of the 5 prediction-model inputs.
- Missing predictive-model weight is redistributed across available predictive models while the market share remains fixed.
- Fewer than three predictive model feeds leaves the branded number incomplete.
- Custom Blend is explicitly separate and user-controlled; when active it drives Edge/Cover %, while the standalone PickGauge Model # remains unchanged.
- Turning PickGauge Model # off allows a fully custom Model # from the enabled weighted inputs.
- Edge/Cover %, CLV, data sources, context-vs-input rules, prospective model-performance tracking, and Survivor calculations are documented in separate sections.
- No proprietary numeric recipe weights are exposed.

## Additional consistency cleanup
- Mobile All Games sort uses `Market` instead of `Vegas`.
- Offline All Games export uses `Live Market` instead of `Live Vegas`.
- Clear-data dialogs use Brad Powers / Computer Line instead of BP / Comp.
- Board tooltips use Market terminology.
- Public homepage curated-model count is aligned to the current 17-model UI wording.

## Verification
- 97/97 JavaScript `test_*.mjs` regression files passed.
- 37/37 non-browser Python `test_*.py` regression files passed.
- `node --check` passed for every JavaScript file touched in this pass.
- HTML parse/duplicate-ID check passed for `app/index.html`, `methodology.html`, `index.html`, and `pricing.html` with zero duplicate ids.
- New contract: `tests/test_p1_terminology_p2_help_methodology.mjs`.

## Main files changed
`app/index.html`, `app/css/app.css`, `app/js/tabs.js`, `app/js/init.js`, `app/js/pool-contexts.js`, `app/js/picks.js`, `app/js/beta.js`, `app/js/board.js`, `app/js/prediction-tracker.js`, `app/js/board-export.js`, `app/js/snapshot-export.js`, `app/js/guest-snapshot.js`, `app/js/confidence-integration.js`, `app/js/pdf-import.js`, `app/js/my-numbers.js`, `app/js/model.js`, public `index.html`, `pricing.html`, `methodology.html`, and terminology-contract tests.
