import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Drew's real report: an untouched "Overall" context and an untouched
// "OFP" pool entry (zero picks in either) still showed up as full dead
// columns of dashes across every row in both the on-screen Compare Picks
// table and its image/PDF export. pgCompareColumns() is the single column
// list both renderCompareTable() and pgCompareBuildCardCanvas() now build
// from, so a fix here covers both surfaces at once rather than needing to
// be applied twice.

const source = fs.readFileSync(new URL('../app/js/picks.js', import.meta.url), 'utf8');
const context = vm.createContext({ console, Math, Date, Number, String, Array, Object, Set, Map, JSON, state: {} });
vm.runInContext(source, context, { filename: 'picks.js' });
const run = (expr) => vm.runInContext(expr, context);

// Overall (state.entries) has one untouched entry. Kelly CFB has two
// entries, only one of which has a real pick. OFP has one entry with zero
// picks. Only the one Kelly entry with a real pick should produce a column.
context.state = {
  entries: [{ id: 'ov1', name: 'Entry 1', picks: {} }],
  pools: [
    {
      id: 'kelly', name: 'Kelly CFB',
      entries: [
        { id: 'k1', name: 'Entry 1', picks: { 'Colorado @ Georgia Tech': { team: 'Colorado', line: 6.5, matchup: 'Colorado @ Georgia Tech' } } },
        { id: 'k2', name: 'Entry 2', picks: {} },
      ],
    },
    {
      id: 'ofp', name: 'OFP',
      entries: [{ id: 'o1', name: 'Entry 1', picks: {} }],
    },
  ],
};

const records = run('collectPickRecords()');
assert.equal(records.length, 1, 'only the one real Kelly CFB pick should produce a record');

const { cols, entriesPerContext } = run('pgCompareColumns(collectPickRecords())');
assert.equal(cols.length, 1, 'Overall (0 picks) and OFP (0 picks) should not appear as columns at all');
assert.equal(cols[0].contextId, 'kelly');
assert.equal(cols[0].entryId, 'k1');
assert.equal(entriesPerContext['kelly'], 1, 'after filtering, Kelly CFB has only 1 remaining column -- no more "Entry 1" subheader needed');
assert.equal(entriesPerContext['ofp'], undefined, 'a fully-empty pool should not appear in entriesPerContext at all');
assert.equal(entriesPerContext['overall'], undefined, 'a fully-empty Overall context should not appear in entriesPerContext at all');

// With only 1 qualifying column, the on-screen card and the exporter must
// both refuse (< 2 columns) exactly like the pre-existing "not enough
// entries yet" case -- not silently show/export a useless single column.
assert.match(source, /if\(cols\.length<2\)\{ card\.style\.display="none"; return; \}/);
assert.match(source, /if\(cols\.length<2\) throw new Error\("Add at least two entries first/);

// Now add a second real pick in a second Kelly entry -- both should
// reappear, and the entry-name subheader should come back since the pool
// again has 2 real columns.
context.state.pools[0].entries[1].picks['UCLA @ California'] = { team: 'UCLA', line: -1.5, matchup: 'UCLA @ California' };
const { cols: cols2, entriesPerContext: epc2 } = run('pgCompareColumns(collectPickRecords())');
assert.equal(cols2.length, 2, 'both Kelly entries now have real picks and should both appear');
assert.equal(epc2['kelly'], 2);

console.log('Compare Picks empty-column filtering tests passed');
