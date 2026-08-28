import assert from 'node:assert/strict';
import { withBrowserPage, assertNoErrors } from './browser-harness.js';

await withBrowserPage(async ({ page, errors }) => {
  await page.goto('/?demo=1');
  await page.waitForSelector('#dataHealthPanel .data-health-item strong');
  const text = await page.locator('#dataHealthPanel').innerText();
  assert.match(text, /Schedule/i);
  assert.match(text, /Probabilities/i);
  assert.match(text, /Results/i);
  assert.match(text, /Updated/i);
  const scheduleText = await page.locator('#dataHealthItems .data-health-item').nth(0).innerText();
  assert.match(scheduleText, /106\/106|122\/122/);
  await page.locator('#dataHealthPanel summary').click();
  await page.waitForSelector('#dataHealthDetails');
  const detail = await page.locator('#dataHealthDetails').innerText();
  assert.match(detail, /Probability coverage/i);
  assertNoErrors(errors);
}, { viewport: { width: 390, height: 844 } });

console.log('browser data health test passed');
