# PickGauge session summary — This Week core experience

Date: September 9, 2026

## Goal

Implement priority #2 from beta-user feedback: make the simple weekly recommendation view the obvious place to start, while retaining the existing full-power Pick Board as an advanced workspace.

## User-facing changes

- `Snapshot` → **This Week** in primary navigation and the mobile hamburger label.
- `Pick Board` → **All Games** in primary navigation.
- Pick Board's internal board subview → **All Games**; My Picks and Pool Settings remain unchanged.
- This Week first card now says **This Week / Best ATS opportunities**.
- Quick Look wording simplified to **More from this week / Games to watch**.
- The advanced CTA now says **Need the full slate? / Open All Games →**.
- Guest locked CTAs say **All Games 🔒**.
- My Picks empty-state guidance sends users to **This Week or All Games**.
- Pool onboarding banner is intentionally hidden on This Week so recommendations appear before setup/discovery prompts.
- Default Overall context is simplified from `Overall board · Entry 1 · Week N` to `Overall · Week N`; entry/pick detail reappears automatically when it becomes meaningful.

## Implementation notes

Internal ids and function names remain `snapshot`, `pickboard`, and `board`. Do not rename those solely for cosmetic consistency; they are intentionally decoupled from user-facing labels to avoid touching many mature call sites.

`renderPoolSetupCta()` now checks whether `#tab-snapshot` is active and hides the CTA there. It still appears in the deeper ATS workflow when appropriate.

`computeContextSummary()` uses `showOverallEntry` so a brand-new Overall state suppresses the synthetic default Entry 1 and 0/7 pick count. Multiple Overall entries, a renamed entry, or any picks cause that context to surface again.

## Tests

- New `tests/test_this_week_core_experience.mjs` protects the new IA and onboarding behavior.
- Updated navigation/context/pools structural tests for intended wording changes.
- 92/92 JavaScript regression files passed.
- 37/37 non-browser Python regression files passed.
- Browser E2E not run in this environment.
