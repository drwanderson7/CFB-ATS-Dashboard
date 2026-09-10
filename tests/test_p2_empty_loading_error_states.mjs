import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../app/index.html',import.meta.url),'utf8');
const states=fs.readFileSync(new URL('../app/js/states.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../app/css/app.css',import.meta.url),'utf8');
const snapshot=fs.readFileSync(new URL('../app/js/snapshot-export.js',import.meta.url),'utf8');
const board=fs.readFileSync(new URL('../app/js/board.js',import.meta.url),'utf8');
const pools=fs.readFileSync(new URL('../app/js/pool-contexts.js',import.meta.url),'utf8');
const confidence=fs.readFileSync(new URL('../app/js/confidence-integration.js',import.meta.url),'utf8');
const survivor=fs.readFileSync(new URL('../app/js/survivor-integration.js',import.meta.url),'utf8');
const record=fs.readFileSync(new URL('../app/js/record.js',import.meta.url),'utf8');
const guest=fs.readFileSync(new URL('../app/js/guest-snapshot.js',import.meta.url),'utf8');

let failures=0;
function check(name,cond){console.log(`[${cond?'PASS':'FAIL'}] ${name}`);if(!cond)failures++;}

check('shared state renderer is loaded after icons',html.includes('<script src="/app/js/icons.js"></script>\n<script src="/app/js/states.js"></script>'));
check('shared state CSS covers empty loading error info and mobile actions',css.includes('.pg-state{')&&css.includes('.pg-state-loading .pg-state-icon .pg-icon')&&css.includes('.pg-state-error{')&&css.includes('.pg-state-info{')&&css.includes('@media(max-width:700px)'));

const sandbox={pgIcon:(name)=>`<i>${name}</i>`};
vm.createContext(sandbox);vm.runInContext(states,sandbox);
const escaped=sandbox.pgStateHTML({kind:'error',title:'Bad <script>',message:'Try & retry',actions:[{data:{action:'retry'},label:'Retry'}]});
check('state renderer escapes user-facing text',escaped.includes('Bad &lt;script&gt;')&&escaped.includes('Try &amp; retry')&&!escaped.includes('Bad <script>'));
check('error state is an alert',escaped.includes('role="alert"'));
const loading=sandbox.pgStateHTML({kind:'loading',title:'Loading'});
check('loading state exposes aria busy semantics',loading.includes('aria-live="polite"')&&loading.includes('aria-busy="true"'));

check('This Week distinguishes no games no models and filtered empties',snapshot.includes('No games loaded yet')&&snapshot.includes('Market lines are ready')&&snapshot.includes('clear-filter')&&snapshot.includes('Refresh lines'));
check('All Games explains filters pool slate and market loading separately',board.includes('No games match both filters')&&board.includes('This pool has no weekly slate yet')&&board.includes('No games loaded yet')&&board.includes('board-empty-action'));
check('ATS Pools has actionable empty and manual-market states',pools.includes('No ATS pools yet')&&pools.includes('poolsEmptyCreateBtn')&&pools.includes('manual-refresh-market'));
check('Confidence import uses loading error and success states',confidence.includes('Reading pool sheet')&&confidence.includes('Pool sheet could not be imported')&&confidence.includes('games imported'));
check('Confidence no-pool/results empties are actionable',confidence.includes('No confidence pools yet')&&confidence.includes('No submitted cards yet')&&confidence.includes('Back to This Week'));
check('Survivor propagates data errors instead of leaving child views loading forever',survivor.includes('pgSurvivorDataPlaceholder')&&survivor.includes('Survivor data could not load')&&survivor.includes('data-survivor-retry'));
check('Survivor handles empty rankings plan and history',survivor.includes('No unused teams available for Week')&&survivor.includes('No complete season path yet')&&survivor.includes('No Survivor history yet'));
check('Results has actionable first-use and filtered-empty states',record.includes('Nothing to grade yet')&&record.includes('Open My Picks')&&record.includes('No picks match these filters')&&record.includes('clear-filters'));
check('public preview distinguishes warming-up from hard failure',guest.includes('_guestShowNotReady(mode="loading")')&&guest.includes('Public preview could not load')&&guest.includes('hardFailure'));

if(failures)process.exit(1);
console.log('P2 empty/loading/error state contract passed.');
