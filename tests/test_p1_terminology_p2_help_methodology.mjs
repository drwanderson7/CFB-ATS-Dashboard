import fs from 'node:fs';

const html=fs.readFileSync(new URL('../app/index.html',import.meta.url),'utf8');
const tabs=fs.readFileSync(new URL('../app/js/tabs.js',import.meta.url),'utf8');
const init=fs.readFileSync(new URL('../app/js/init.js',import.meta.url),'utf8');
const ctx=fs.readFileSync(new URL('../app/js/pool-contexts.js',import.meta.url),'utf8');
const board=fs.readFileSync(new URL('../app/js/board.js',import.meta.url),'utf8');
const pred=fs.readFileSync(new URL('../app/js/prediction-tracker.js',import.meta.url),'utf8');
const method=fs.readFileSync(new URL('../methodology.html',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../app/css/app.css',import.meta.url),'utf8');

let failures=0;
function check(name,cond){ console.log(`[${cond?'PASS':'FAIL'}] ${name}`); if(!cond) failures++; }

check('All Games subnav calls pool destination Pools',html.includes('data-pickboard-view="pools">Pools</button>')&&!html.includes('data-pickboard-view="pools">Pool Settings</button>'));
check('default no-pool context is named No Pool',html.includes('id="ctxLine1">No Pool · Week 1</span>')&&ctx.includes('>No Pool</option>')&&ctx.includes('pool?pool.name:"No Pool"'));
check('advanced model controls are named Models & weights',html.includes('Models &amp; weights')&&pred.includes('open Models & weights to enable columns'));
check('user-controlled model mix is named Custom Blend',html.includes('Custom Blend')&&board.includes('myblend:"Custom Blend"')&&!html.includes('>My Blend<'));
check('legacy BP Comp and Vegas table labels are expanded',html.includes('>Brad Powers</th>')&&html.includes('>Computer Line</th>')&&html.includes('>Market</th>'));
check('dynamic board sort labels use readable names',board.includes('bp:"Brad Powers"')&&board.includes('comp:"Computer Line"')&&board.includes('vegas:"Market"'));
check('help is task-first rather than a legacy Edge Board manual',html.includes('What are you trying to do?')&&html.includes('class="help-task-grid"')&&!html.includes('<h2>How to use Edge board</h2>'));
check('help routes directly to product tasks',html.includes('data-help-destination="snapshot"')&&html.includes('data-help-destination="pools"')&&html.includes('data-help-destination="confidence"')&&html.includes('data-help-destination="survivor"'));
check('help navigation is wired once during init',tabs.includes('function initHelpNavigation()')&&init.includes('initHelpNavigation();'));
check('help glossary defines core terms progressively',html.includes('<summary>PickGauge Model #</summary>')&&html.includes('<summary>Edge</summary>')&&html.includes('<summary>CLV</summary>')&&html.includes('<summary>Custom Blend</summary>'));
check('help responsive styles exist',css.includes('.help-task-grid{')&&css.includes('.help-glossary details{'));
check('methodology has direct anchored deep dives',method.includes('id="pickgauge-model"')&&method.includes('id="custom-blend"')&&method.includes('id="edge-cover"')&&method.includes('id="clv"')&&method.includes('id="data-sources"'));
check('methodology distinguishes fixed PickGauge model from user custom blend',method.includes('fixed proprietary blend of five selected prediction models')&&method.includes('Custom Blend</b> is optional and user-controlled'));
check('methodology documents current 3-of-5 floor',method.includes('3 of its 5 prediction-model inputs'));
check('methodology no longer falsely says Model # is simply every enabled system averaged together',!method.includes('Every prediction system you enable in the Prediction Systems panel becomes'));
check('app quick reference is concise and points to help',html.includes('Quick reference')&&html.includes('Open Help &amp; glossary →'));

if(failures) process.exit(1);
console.log('P1 terminology + P2 Help/Methodology contract passed.');
