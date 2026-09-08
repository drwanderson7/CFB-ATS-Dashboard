import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

// Drew's real report: "when a big 10 team plays out of conference on
// survivor such as purdue vs notre dame week 4 it wont let me select
// notre dame instead of purdue". Root cause: buildPickGaugeSurvivorData()
// already generates a full, pickable matchup for BOTH sides of every
// listed game with no conference filtering at all -- Notre Dame's
// matchup entry existed the whole time. pgSurvivorMemberTeams() (which
// decides which TEAM ROWS actually render on the Season Board) only ever
// returned the pool's static conference roster for bigten/sec, silently
// dropping any legitimate non-conference opponent's row -- directly
// contradicting the pool's own advertised rule ("Listed Big Ten games ·
// either team · straight up").

const src = fs.readFileSync(new URL("../app/js/survivor-integration.js", import.meta.url), "utf8");
const fnMatch = src.match(/function pgSurvivorMemberTeams\(\)\{[\s\S]*?\n\}/);
assert.ok(fnMatch, "pgSurvivorMemberTeams should be present");

const context = {
  window: {
    PickGaugeSurvivorCore: {
      pools: {
        POOL_DEFINITIONS: {
          bigten: { teams: ["Illinois", "Indiana", "Ohio State", "Purdue", "Rutgers"] },
        },
      },
    },
  },
};
vm.createContext(context);
vm.runInContext(fnMatch[0], context);

let currentPoolId = "bigten";
context.pgSurvivorPoolId = () => currentPoolId;

// Purdue @ Notre Dame, week 4 -- both sides already exist as real matchups
// (exactly what buildPickGaugeSurvivorData() actually produces; no
// conference filtering happens there).
context.pgSurvivorData = () => ({
  matchups: [
    { team: "Purdue", week: 4, opponent: "Notre Dame", isConferenceMember: true },
    { team: "Notre Dame", week: 4, opponent: "Purdue", isConferenceMember: false },
    { team: "Ohio State", week: 4, opponent: "Rutgers", isConferenceMember: true },
    { team: "Rutgers", week: 4, opponent: "Ohio State", isConferenceMember: true },
  ],
});

const teams = context.pgSurvivorMemberTeams();
assert.ok(teams.includes("Notre Dame"), "Notre Dame must get its own selectable row -- this was the actual bug");
assert.ok(teams.includes("Purdue"), "Purdue (the conference member) must still be included");
assert.ok(teams.includes("Illinois"), "a conference member with no game this week (e.g. on a bye) must still get a row");
assert.equal(new Set(teams).size, teams.length, "no duplicate rows");

// A normal in-conference-only week must be completely unaffected -- no
// extra/invented rows when every game is conference-vs-conference.
context.pgSurvivorData = () => ({
  matchups: [
    { team: "Ohio State", week: 5, opponent: "Rutgers", isConferenceMember: true },
    { team: "Rutgers", week: 5, opponent: "Ohio State", isConferenceMember: true },
  ],
});
const normalWeekTeams = context.pgSurvivorMemberTeams();
assert.deepEqual(
  normalWeekTeams,
  ["Illinois", "Indiana", "Ohio State", "Purdue", "Rutgers"],
  "an all-conference week must return exactly the static roster, unchanged -- no invented extras"
);

// SEC pool: same fix applies, not just bigten.
context.PickGaugeSurvivorCore = context.window.PickGaugeSurvivorCore;
context.window.PickGaugeSurvivorCore.pools.POOL_DEFINITIONS.sec = { teams: ["Alabama", "Georgia"] };
currentPoolId = "sec";
context.pgSurvivorData = () => ({
  matchups: [
    { team: "Alabama", week: 4, opponent: "Notre Dame", isConferenceMember: true },
    { team: "Notre Dame", week: 4, opponent: "Alabama", isConferenceMember: false },
  ],
});
const secTeams = context.pgSurvivorMemberTeams();
assert.ok(secTeams.includes("Notre Dame"), "the same fix must apply to the SEC pool, not just Big Ten");

console.log("Survivor member-teams cross-conference opponent tests passed");
