# PickGauge — Full ATS Model Data Package
For: ChatGPT analysis
Prepared: September 1, 2026 (Claude)

## What this is
Drew asked for "the full ATS model data" for ChatGPT to analyze — both the app's own stored backtest ranking data AND the newer weighted recipe from this session. This document contains **everything that actually exists in the codebase**, reproduced verbatim from source (not retyped from memory), plus an explicit gap analysis flagging what's requested but NOT present here.

**Read this first:** Drew asked specifically for "the full 2021-2025 data." That dataset is **NOT in this codebase**. What exists here is a smaller 2-year top-10 summary (below) that predates today's session, plus today's own 6-system recipe. The discrepancies between the two (detailed in the Gap Analysis section) strongly suggest the full 2021-2025 analysis is a superset or a newer vintage that only Drew has, outside this repo. If ChatGPT is meant to analyze the full multi-year data, **Drew needs to paste or attach it directly** — Claude has no access to it and has not fabricated any numbers to fill the gap.

---

## 1. Current PickGauge Model # recipe (as of this session, Sept 1 2026)

Source: `app/data/pred-systems.js`, `PICKGAUGE_MODEL_PRESET`

| System | Weight | Code | Note (Drew's own, verbatim) |
|---|---|---|---|
| TeamRankings.com | 20% | `teamrank` | Strong across MAE/bias/ATS — highest weight in the table |
| Vegas Live # | 19% | `vegas` | Market anchor |
| Sagarin Points | 18% | `sagpred` | Best proven composite of the six |
| SP+ | 16% | `cfbdsp` | Reduced — good pedigree, still unvalidated in this pipeline |
| Waywardtrends | 15% | `wayward` | Best raw bias magnitude, smaller sample (4 seasons) |
| Sagarin Ratings | 12% | `sag` | Combined with Points = 30% for the Sagarin family |

Sums to exactly 100%. Replaced an older recipe this same session: Sagarin Ratings 13% / Sagarin Predictor 13% / Dokter Entropy 22% / SP+ 20% / Vegas 22% / Big 200 10%.

**Sagarin code mapping** (resolved Aug 25, 2026, per the file's own comment history — not re-guessed): `sagpred` (Sagarin Predictor/Pure Points) = the backtest's "Sagarin Points"; `sag` (overall Sagarin Rating) = the backtest's "Sagarin Ratings." An 18% vs 12% difference — not interchangeable.

---

## 2. In-app backtest ranking table (the OLDER, smaller dataset)

Source: `app/js/main.js`, `TOP_SYSTEM_RANKS`

> Comment from the source file, verbatim: *"Top-10 ATS performers from Drew's own 2-year backtest (40% ATS% / 30% MAE / 30% |Bias|, rank-weighted average, lower composite = better). Keyed by this app's PRED_SYSTEMS code — only rows that map cleanly onto an actual system in this checklist."*

| Rank | System | Code | Composite | Note |
|---|---|---|---|---|
| 1 | Sagarin Points (Predictor/Pure Points) | `sagpred` | *(not retained)* | Composite score wasn't preserved in the original handoff to this codebase — intentionally left `null`, never fabricated |
| 2 | Sagarin Ratings | `sag` | *(not retained)* | Same as above |
| 3 | Dokter Entropy | `dokter` | 9.9 | |
| 4 | Big 200 | `big200` | 12.0 | |
| 5 | *(unmapped)* | — | — | Rank 5 exists in the original backtest but doesn't map to a system in this app's checklist — intentionally omitted, not an error |
| 6 | Congrove Computer | `cong` | 14.1 | |
| 7 | *(unmapped)* | — | — | Same as rank 5 |
| 8 | Team Rankings | `teamrank` | 15.0 | |
| 9 | *(unmapped)* | — | — | Same as rank 5 |
| 10 | ESPN FPI | `fpi` | 16.1 | |

**This table only covers 7 systems, ranks 1–10 with 3 gaps.** It is explicitly labeled a "2-year backtest," not 2021–2025 (a 4+ year range). It predates this session and was not updated when the recipe changed today.

---

## 3. Gap analysis — why the two datasets above don't line up

Checked directly against source, not assumed:

- **`wayward` (Waywardtrends) does not appear anywhere in `TOP_SYSTEM_RANKS`** — yet it's 15% of today's new recipe, with its own explicit note ("smaller sample, 4 seasons"). The 2-year backtest table has no row for it at all.
- **`cfbdsp` (SP+) does not appear in `TOP_SYSTEM_RANKS` either** — 16% of today's new recipe, but absent from the older ranking table.
- **`dokter` (Dokter Entropy) and `big200` (Big 200) rank #3 and #4 in the OLD backtest table** — both were in the *previous* PickGauge Model # recipe (22% and 10% respectively) and are now **removed entirely** from the new recipe.

Taken together: the new 6-system recipe weights systems the in-app backtest table doesn't even track (`wayward`, `cfbdsp`), while dropping two systems the in-app table ranks highly (`dokter` #3, `big200` #4). This is not a contradiction Claude can resolve — it strongly suggests today's weights came from a different, presumably fuller or more recent analysis than what's stored in `TOP_SYSTEM_RANKS`. **That analysis — the "full 2021-2025 data" — isn't in this repo.**

---

## 4. Full list of supported prediction systems (for reference)

Source: `app/data/pred-systems.js`, `PRED_SYSTEMS` (~40 systems total, all codes the app can ingest from thepredictiontracker.com CSVs). Reproduced here so ChatGPT has the complete code vocabulary when discussing any system by name:

`sag` Sagarin (Rating) · `sagpred` Sagarin Predictor · `saggm` Sagarin Golden Mean · `sagr` Sagarin Recent · `fpi` ESPN FPI · `cfbdsp` SP+ (CFBD, derived) · `cfbdcore` CORE (CFBD, derived) · `donchess` Donchess · `dokter` Dokter Entropy · `big200` Big 200 · `massey` Massey Ratings · `cons` Massey Consensus · `fei` FEI Projections · `teamrank` Team Rankings · `piratings` Pi-Ratings · `pimean` Pi-Ratings Mean · `pibias` Pi-Ratings Bias · `talis` Talisman Red · `moore` Sonny Moore · `dunk` Dunkel Index · `laz` Laz Index · `rwp` Laffaye RWP · `elo` Beck Elo · `kam` Edward Kambour · `harville` David Harville · `curry` Daniel Curry Index · `congrove` Congrove · `cong` Congrove Computer · `billings` Billingsley · `how` Howell · `keep` Keeper · `pig` Pigskin Index · `fluker` Slate Fluker · `kerns` Stephen Kerns · `versus` Versus Sports Sim · `dwig` DP Dwiggins · `bihl` Bihl System · `loud` Loudsound · `doi` Director of Info · `wayward` Waywardtrends · `pfz` PerformanZ · `clean` Cleanup Hitter · `craig` Brent Craig · `fidler` Linefidler · `cfp` College Football Poll · `l2` Linear Regression · `log` Logistic Regression · `l2hf` LR w/ HFA

**Featured subset** (`FEATURED_SYSTEM_CODES` — the curated list users can newly enable in the app's UI; ingestion supports the full list above regardless):
`dokter`, `big200`, `teamrank`, `fpi`, `versus`, `keep`, `saggm`, `pimean`, `laz`, `massey`, `wayward`, `elo`, `pig`, `congrove`, `cong`, `sag`, `sagpred`, `sagr`, `cfbdsp`, `cfbdcore`

---

## 5. What's explicitly NOT included (do not assume otherwise)

- **No real graded ATS pick history.** The 2026 season hasn't started/been played through this app yet — `CURRENT_STATE.md`'s own open items list "first real live-season validation" and "first real season of graded pick data" as still pending. There is no historical W/L/ATS% record from actual PickGauge users to hand over, because it doesn't exist yet.
- **No full 2021-2025 year-by-year backtest data.** Only the 2-year top-10 summary in Section 2 exists in this repo. If this is what ChatGPT needs to analyze, it must come from Drew directly.
- **No raw per-game prediction accuracy data** behind either backtest number — both `TOP_SYSTEM_RANKS`'s composites and today's new recipe's weights are summary outputs; the underlying game-by-game data that produced them isn't stored here.

---

*Package prepared by Claude, reproduced from source rather than reconstructed from memory. Every table above can be verified against `app/data/pred-systems.js` and `app/js/main.js` directly.*
