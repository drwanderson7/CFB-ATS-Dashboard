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
const PRED_SYSTEMS=[
  {code:"sag",      name:"Sagarin (Rating)"},
  {code:"sagpred",  name:"Sagarin Predictor"},
  {code:"saggm",    name:"Sagarin Golden Mean"},
  {code:"sagr",     name:"Sagarin Recent"},
  {code:"fpi",      name:"ESPN FPI"},
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
