// Team-name matching. Two data sources name teams differently ("Wisconsin"
// from the Powers PDF vs "Wisconsin Badgers" from The Odds API), so matching
// works on TOKENS rather than a smashed string plus a hand-maintained mascot
// list (that list could never be complete -- "Kent State Golden Flashes"
// broke it). Rule: one name's tokens must prefix the other's, and whatever
// is left over must not contain a token that changes school identity.
//
// KEPT IN SYNC MANUALLY with api/grade_picks.py's own TEAM_ALIAS copy --
// Vercel's Python runtime can't share this JS file, so that copy is a real,
// separate dict. No automated drift check between them exists yet (only the
// verify_user()/JWKS-client duplication across api/*.py has one currently,
// see tests/test_auth_sync.py) -- if you add an alias here, add it there too.
//
// Split out of app/index.html (was previously a top-level const there) as
// part of the data-extraction pass -- pure static reference data, never
// touched by str_replace edits, so it doesn't need to live inline. Loaded
// via a plain <script> tag before the main inline script; still defines a
// normal global TEAM_ALIAS, nothing about how teamMatch()/teamMatchTrunc()
// read it changed.
const TEAM_ALIAS={
  'olemiss':'olemiss','mississippi':'olemiss',
  'miami':'miamiflorida','miamifl':'miamiflorida','miamiflorida':'miamiflorida',
  'miamioh':'miamiohio','miamiohio':'miamiohio',
  'southernmiss':'southernmississippi','southernmississippi':'southernmississippi',
  'ullafayette':'louisiana','louisianalafayette':'louisiana',
  'ulmonroe':'louisianamonroe','louisianamonroe':'louisianamonroe',
  'appstate':'appalachianstate','appalachianst':'appalachianstate',
  // added for the Prediction Tracker naming dialect
  'miamifla':'miamiflorida',
  'umass':'massachusetts','massachusetts':'massachusetts'
};
