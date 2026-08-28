// Real browser interaction test for Season Board survivor-oriented week sort.
// v1.15.0 sorts each conference-team row by the BEST SELECTABLE SIDE in that
// game, so an 80% non-conference opponent must move the row near the top even
// when the conference member itself is only 20%.

import assert from 'node:assert/strict';
import { withBrowserPage, assertNoErrors } from './browser-harness.js';

async function readTeamOrder(page) {
  return page.$$eval('.season-grid tbody .grid-team-name', els => els.map(el => el.textContent.trim()));
}

async function readWeekBestProbabilities(page, weekIndex) {
  return page.$$eval('.season-grid tbody tr', (rows, idx) => rows.map(row => {
    const td = row.children[idx]; // children[0] is the sticky conference-team column
    const cell = td?.querySelector('[data-best-selectable-prob]');
    if (!cell) return null;
    const raw = cell.getAttribute('data-best-selectable-prob');
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }), weekIndex);
}

await withBrowserPage(async ({ page, baseURL, consoleErrors, pageErrors }) => {
  await page.goto(baseURL + '/?demo=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const canonicalOrder = await readTeamOrder(page);
  assert.ok(canonicalOrder.length > 5, 'expected multiple teams in the season board');

  // The new cell treatment must visibly expose both selectable sides, and the
  // demo data deliberately contains games where the opponent is the favorite.
  const cellShape = await page.$$eval('.dual-side-cell', cells => {
    const first = cells[0];
    const opponentBest = cells.some(cell => {
      const sides = [...cell.querySelectorAll('.cell-side')];
      return sides.length === 2 && sides[1].classList.contains('is-best');
    });
    return {
      firstSideCount: first?.querySelectorAll('.cell-side').length || 0,
      opponentBest,
      bestMarkers: [...document.querySelectorAll('.cell-side.is-best .cell-side-marker')].map(el => el.textContent.trim())
    };
  });
  assert.equal(cellShape.firstSideCount, 2, 'each populated Season Board cell should render both selectable teams');
  assert.equal(cellShape.opponentBest, true, 'at least one demo cell should visibly mark the opponent as the better selectable side');
  assert.ok(cellShape.bestMarkers.includes('★'), 'best selectable side should be marked with a star');

  // Click Week 1 because demo Week 1 has several non-conference favorites.
  await page.click('[data-grid-week="1"]');
  await page.waitForTimeout(300);

  const sortedOrder = await readTeamOrder(page);
  assert.notDeepEqual(sortedOrder, canonicalOrder, 'clicking a week header should change the row order');

  const week1Best = await readWeekBestProbabilities(page, 1);
  const modeled = week1Best.filter(p => p !== null);
  assert.deepEqual(modeled, [...modeled].sort((a, b) => b - a), 'rows should sort by best selectable side probability, highest to lowest');
  const firstNullIndex = week1Best.indexOf(null);
  if (firstNullIndex !== -1) {
    assert.equal(week1Best.slice(firstNullIndex).some(p => p !== null), false, 'games with no modeled selectable side should sort to the bottom');
  }

  const header = await page.getAttribute('[data-grid-week="1"]', 'class');
  assert.match(header, /is-sorted/, 'the sorted week header should get a visual is-sorted indicator');

  // Click the same header again to restore canonical conference-team order.
  await page.click('[data-grid-week="1"]');
  await page.waitForTimeout(300);
  assert.deepEqual(await readTeamOrder(page), canonicalOrder, 'clicking the same header again should restore canonical order');

  assertNoErrors(consoleErrors, pageErrors, 'two-sided grid + best-selectable week sort');
});
console.log('grid week-sort browser test passed');
