// Prediction Tracker systems (thepredictiontracker.com CSV). Key = the CSV
// column name with "line" stripped; value = display name. Toggling any of
// these on in the Prediction Systems panel (Edge Board tab) folds that
// system's number into Model # for every game it covers. Codes not listed
// here still work if the CSV has them -- they just show by their raw code
// until named. Market lines and site aggregates are intentionally excluded
// server-side (see api/fetch_predictions.py META_COLUMNS).
//
// Split out of app/index.html (was previously a top-level const there) as
// part of the data-extraction pass -- pure static reference data, never
// touched by str_replace edits, so it doesn't need to live inline. Loaded
// via a plain <script> tag before the main inline script; still defines a
// normal global PRED_SYSTEMS, nothing about how the rest of the app reads
// it changed.
// PickGauge Model # internal recipe. These are percentage weights, not
// arbitrary relative units: they intentionally sum to exactly 100 so the
// branded PickGauge Model # has one stable, auditable recipe. Vegas is not a
// Prediction Tracker system (it is the current market line), so it lives in
// `weights` but not `systems`. In a locked pool, the model uses the CURRENT
// live Vegas line while Edge continues to compare the resulting model number
// against the pool's locked line -- see pickGaugeModelMarketLine() in
// app/js/model.js. Vegas remains mandatory. PickGauge may calculate with any
// 3, 4, or all 5 predictive-model feeds. Missing model weight is redistributed
// proportionally across the available predictive models only; fewer than 3/5
// model feeds make the number unavailable.
//
// Recipe replaced Sept 1, 2026 per Drew's explicit backtest-driven table
// (dokter/big200/sag/sagpred's OLD 13/13/22/20/10 weights retired entirely --
// dokter and big200 are no longer part of the internal recipe at all, though
// both remain available as ordinary DIY Model # inputs, see FEATURED_SYSTEM_
// CODES below). Sagarin code mapping resolved Aug 25 and reconfirmed here:
// `sagpred` (Sagarin Predictor/Pure Points) is the backtest's "Sagarin
// Points"; `sag` (overall Sagarin Rating) is the backtest's "Sagarin
// Ratings" -- do not swap these, the two are a real 6pt-apart weight
// difference (18% vs 12%), not interchangeable.
//   TeamRankings.com (teamrank)  20%  -- strongest across MAE/bias/ATS
//   Vegas Live #      (vegas)    19%  -- market anchor
//   Sagarin Points    (sagpred)  18%  -- best proven composite of the six
//   SP+               (cfbdsp)   16%  -- reduced; good pedigree, still
//                                        unvalidated in this pipeline
//   Waywardtrends     (wayward)  15%  -- best raw bias magnitude, smaller
//                                        sample (4 seasons)
//   Sagarin Ratings   (sag)      12%  -- combined with Points = 30% for
//                                        the Sagarin family
const PICKGAUGE_MODEL_PRESET=Object.freeze({
  id:"pickgauge",
  label:"PickGauge Model #",
  systems:Object.freeze(["teamrank","sagpred","cfbdsp","wayward","sag"]),
  weights:Object.freeze({
    teamrank:20,
    vegas:19,
    sagpred:18,
    cfbdsp:16,
    wayward:15,
    sag:12,
  }),
});

const PRED_SYSTEMS=[
  {code:"sag",      name:"Sagarin (Rating)"},
  {code:"sagpred",  name:"Sagarin Predictor"},
  {code:"saggm",    name:"Sagarin Golden Mean"},
  {code:"sagr",     name:"Sagarin Recent"},
  {code:"fpi",      name:"ESPN FPI"},
  // cfbdsp/cfbdcore are NOT thepredictiontracker.com CSV columns like every
  // other entry in this list -- there's no CSV row for either. They're
  // derived server-side... no, CLIENT-side (app/js/cfbd-insights.js's
  // applyCfbdDerivedPredictions()) from CFBD's own SP+ and CORE power
  // RATINGS (already fetched for the ratings context panel,
  // /api/fetch_cfbd?view=ratings): (away rating - home rating - a fixed
  // 2.6pt home-field-advantage constant), home-team-spread convention,
  // same as every other system here. That 2.6pt HFA is applied ONLY to
  // true home games -- a real bug (unconditional 2.6 on every game,
  // including neutral-site) was found and fixed; a game's frozen
  // cfbdNeutralSite flag (api/fetch_teams.py trim_games() -> pdf-import.js
  // applyCfbdIdentityToGame()/cfbdPickIdentity()) now zeroes it out for
  // neutral sites. See cfbdDerivedSpread() in cfbd-insights.js. The 2.6
  // figure itself is real, sourced
  // research (a multi-season empirical HFA study), not invented -- and
  // Drew explicitly confirmed it over the oddsmaker-convention alternative
  // (~3.0) before this was built. Real, documented simplification worth
  // knowing: HFA genuinely varies by team (roughly 0.2-5.7 points across
  // real programs in a 2025 dataset) -- a flat constant will run a bit
  // generous for weak home fields and a bit stingy for elite ones. Same
  // category of simplification every other fixed-methodology system here
  // already represents, not a new kind of imprecision. NOTE (Sept 2,
  // 2026): `cfbdsp` was never actually run through the real 2-year
  // ATS/MAE/Bias backtest that produces every other TOP_SYSTEM_RANKS
  // (app/js/main.js) composite score -- it isn't a thepredictiontracker.com
  // column, so it was never in that sheet. Drew explicitly asked for it to
  // carry the "★ Top 7" badge anyway (Sept 2), so it's included there with
  // composite:null rather than a backtest-derived number. This is a
  // deliberate exception, not an oversight -- flagging here so a future
  // session doesn't "fix" it by removing cfbdsp from TOP_SYSTEM_RANKS.
  {code:"cfbdsp",   name:"SP+ (CFBD, derived)"},
  {code:"cfbdcore", name:"CORE (CFBD, derived)"},
  {code:"donchess", name:"Donchess"},
  {code:"dokter",   name:"Dokter Entropy"},
  {code:"big200",   name:"Big 200"},
  {code:"massey",   name:"Massey Ratings"},
  {code:"cons",     name:"Massey Consensus"},
  {code:"fei",      name:"FEI Projections"},
  {code:"teamrank", name:"Team Rankings"},
  {code:"piratings",name:"Pi-Ratings"},
  {code:"pimean",   name:"Pi-Ratings Mean"},
  {code:"pibias",   name:"Pi-Ratings Bias"},
  {code:"talis",    name:"Talisman Red"},
  {code:"moore",    name:"Sonny Moore"},
  {code:"dunk",     name:"Dunkel Index"},
  {code:"laz",      name:"Laz Index"},
  {code:"rwp",      name:"Laffaye RWP"},
  {code:"elo",      name:"Beck Elo"},
  {code:"kam",      name:"Edward Kambour"},
  {code:"harville", name:"David Harville"},
  {code:"curry",    name:"Daniel Curry Index"},
  {code:"congrove", name:"Congrove"},
  {code:"cong",     name:"Congrove Computer"},
  {code:"billings", name:"Billingsley"},
  {code:"how",      name:"Howell"},
  {code:"keep",     name:"Keeper"},
  {code:"pig",      name:"Pigskin Index"},
  {code:"fluker",   name:"Slate Fluker"},
  {code:"kerns",    name:"Stephen Kerns"},
  {code:"versus",   name:"Versus Sports Sim"},
  {code:"dwig",     name:"DP Dwiggins"},
  {code:"bihl",     name:"Bihl System"},
  {code:"loud",     name:"Loudsound"},
  {code:"doi",      name:"Director of Info"},
  {code:"wayward",  name:"Waywardtrends"},
  {code:"pfz",      name:"PerformanZ"},
  {code:"clean",    name:"Cleanup Hitter"},
  {code:"craig",    name:"Brent Craig"},
  {code:"fidler",   name:"Linefidler"},
  {code:"cfp",      name:"College Football Poll"},
  {code:"l2",       name:"Linear Regression"},
  {code:"log",      name:"Logistic Regression"},
  {code:"l2hf",     name:"LR w/ HFA"},
];
// Drew's own curated "these are the ones I actually want to see" list
// (rebuilt Sept 2, 2026, replacing the Aug 20 version below) -- everything
// in PRED_SYSTEMS above still gets INGESTED from a real sheet regardless
// (48 systems worth), but the Prediction Systems checklist only ever shows
// THIS subset; the rest are still functional (a system enabled from before
// this list existed, or the CSV/PDF itself, still works and still counts
// toward Model #), there is just no UI path to newly browse or enable
// anything outside this curated set (see renderSystemsSettings(),
// app/js/prediction-tracker.js -- the "Show all N available systems"
// toggle that used to exist here was removed entirely Aug 26, per Drew's
// explicit request).
//
// Confirmed against Drew's explicit Sept 2, 2026 list (BP/Comp are core
// items rendered separately, always shown, not part of this Set -- see
// `core` in renderSystemsSettings()): Sagarin Rating, Sagarin
// Predictor/Points, Sagarin Golden Mean, Sagarin Recent, ESPN FPI, SP+,
// CORE, Dokter Entropy, Massey Ratings, Team Rankings, Congrove Computer
// Rankings, Waywardtrends, Talisman Red, Laz Index, Versus Sports
// Simulator, David Harville, Beck Elo.
//
// Two items from Drew's Aug 20 list were dropped here at his explicit
// Sept 2 request: Big 200, Keeper, Pigskin Index, Pi-Ratings Mean. The
// Congrove ambiguity from Aug 20 (both `congrove`/"Congrove" and
// `cong`/"Congrove Computer" were included since it wasn't clear which
// was meant) is now resolved -- Drew's Sept 2 list says "Congrove computer
// rankings" specifically, so only `cong` stays; plain `congrove` is
// dropped.
//
// "System Median" was also named in Drew's Sept 2 list but is NOT a real
// PRED_SYSTEMS entry -- see the TOP_SYSTEM_RANKS comment in app/js/main.js:
// it's thepredictiontracker.com's own cross-system aggregate row (like
// "System Average"/"Line (updated)"), not a togglable individual system,
// so there's no code for it to map onto here. Flagged rather than guessed.
const FEATURED_SYSTEM_CODES=new Set([
  "sag","sagpred","saggm","sagr",
  "fpi","cfbdsp","cfbdcore",
  "dokter","massey","teamrank","cong","wayward",
  "talis","laz","versus","harville","elo",
]);
