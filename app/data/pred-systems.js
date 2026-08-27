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
const PICKGAUGE_MODEL_PRESET=Object.freeze({
  id:"pickgauge",
  label:"PickGauge Model #",
  systems:Object.freeze(["sag","sagpred","dokter","cfbdsp","big200"]),
  weights:Object.freeze({
    sag:13,
    sagpred:13,
    dokter:22,
    cfbdsp:20,
    vegas:22,
    big200:10,
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
  // already represents, not a new kind of imprecision. Deliberately
  // EXCLUDED from TOP_SYSTEM_RANKS below (the real 2-year ATS/MAE/Bias
  // backtest) -- these were never run through that backtest, so they
  // never get a "★ TOP 10" star; showing one would misrepresent an
  // evaluation that was never actually performed for these two.
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
// (Aug 20) -- everything in PRED_SYSTEMS above still gets INGESTED from a
// real sheet regardless (48 systems worth), but the Prediction Systems
// checklist only ever shows THIS subset (20); the rest are still
// functional (a system enabled from before the "Show all" toggle was
// removed, or the CSV/PDF itself, still works and still counts toward
// Model #), there is just no UI path to newly browse or enable anything
// outside this curated set (see renderSystemsSettings(),
// app/js/prediction-tracker.js -- the "Show all N available systems"
// toggle that used to exist here was removed entirely Aug 26, per Drew's
// explicit request).
//
// Confident 1:1 name matches against a real screenshot of what Drew
// actually wants: Dokter Entropy, Big 200, TeamRankings.com, ESPN FPI,
// Versus Sports Simulator, Keeper, Sagarin Golden Mean, Pi-Ratings Mean,
// Laz Index, Massey Ratings, Waywardtrends, Beck Elo, Pigskin Index.
//
// One deliberately-inclusive judgment call remains:
//   - "Congrove Computer Rankings" could be either `congrove` or `cong`
//     in this file (both exist, and it's not obvious which is the real
//     match) -- both included rather than guessing and possibly hiding
//     the one Drew actually needs.
//
// Sagarin mapping itself is now resolved (Aug 25): `sagpred` is Sagarin
// Predictor / Pure Points (the backtest's "Sagarin Points") and `sag` is
// the overall Sagarin Rating (the backtest's "Sagarin Ratings"). All four
// Sagarin variants remain featured because Drew explicitly asked to keep
// the other Sagarin models available too, not because their identities
// are still ambiguous.
//
// cfbdsp/cfbdcore are always included -- they aren't from
// thepredictiontracker.com at all, so they were never something to
// narrow down in the first place.
const FEATURED_SYSTEM_CODES=new Set([
  "dokter","big200","teamrank","fpi","versus","keep",
  "saggm","pimean","laz","massey","wayward","elo","pig",
  "congrove","cong",
  "sag","sagpred","sagr", // saggm already listed above
  "cfbdsp","cfbdcore",
]);
