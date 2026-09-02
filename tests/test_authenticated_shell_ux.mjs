import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const html=fs.readFileSync(path.join(ROOT,'app/index.html'),'utf8');
const css=fs.readFileSync(path.join(ROOT,'app/css/app.css'),'utf8');
const odds=fs.readFileSync(path.join(ROOT,'app/js/odds.js'),'utf8');
const tabs=fs.readFileSync(path.join(ROOT,'app/js/tabs.js'),'utf8');

const header=html.slice(html.indexOf('<header class="app">'),html.indexOf('</header>')+9);
const settings=html.slice(html.indexOf('id="tab-settings"'),html.indexOf('<!-- HELP -->'));
const account=html.slice(html.indexOf('id="tab-account"'),html.indexOf('id="tab-settings"'));

assert.doesNotMatch(header,/calls left|id="reqLeft"|id="reqLeftRow"/i,'provider quota must not be in main header');
assert.match(settings,/Advanced: provider diagnostics/,'provider quota should live in collapsed advanced diagnostics');
assert.match(settings,/id="reqLeftRow"[\s\S]*id="reqLeft"/,'advanced diagnostics must expose remaining requests');
assert.match(settings,/id="providerLastRefresh"/,'advanced diagnostics should show last odds refresh');
assert.match(odds,/const reqLeft=document\.getElementById\("reqLeft"\)/,'refreshMeta must still update advanced quota value');
assert.match(odds,/providerLastRefresh/,'refreshMeta must update advanced refresh timestamp');

for(const label of ['Feedback','Account','Settings','Help']){
  assert.match(header,new RegExp(`<span class="icon-nav-label">${label}<\\/span>`),`desktop header needs ${label} text label`);
}
assert.match(css,/\.icon-nav-label\{[^}]*font-family:Inter/,'desktop labels need explicit readable styling');
assert.match(css,/@media\(max-width:720px\)\{[\s\S]*\.icon-nav-label\{display:none;/,'mobile must hide header text labels');
assert.match(css,/@media\(max-width:720px\)\{[\s\S]*\.icon-nav-btn\{width:44px;min-width:44px;height:44px;/,'mobile header controls stay icon-sized touch targets');
assert.match(tabs,/querySelector\("\.icon-nav-label"\)/,'mobile hamburger label should read the header control label from DOM');

assert.match(account,/Your PickGauge data syncs automatically/,'Account should lead with automatic-sync reassurance');
assert.match(account,/<details class="pred-panel sync-troubleshooting">/,'manual sync controls must be collapsed under Sync troubleshooting');
const detailsStart=account.indexOf('<details class="pred-panel sync-troubleshooting">');
const pullIdx=account.indexOf('id="pullNowBtn"');
const pushIdx=account.indexOf('id="pushNowBtn"');
const detailsEnd=account.indexOf('</details>',detailsStart);
assert.ok(detailsStart>=0 && pullIdx>detailsStart && pushIdx>detailsStart && pullIdx<detailsEnd && pushIdx<detailsEnd,'Pull/Push buttons must live inside collapsed troubleshooting details');

console.log('Authenticated shell UX contract tests passed');
