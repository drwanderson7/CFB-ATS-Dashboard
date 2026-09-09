import fs from 'node:fs';

const html=fs.readFileSync(new URL('../app/index.html',import.meta.url),'utf8');
const tabs=fs.readFileSync(new URL('../app/js/tabs.js',import.meta.url),'utf8');
const ctx=fs.readFileSync(new URL('../app/js/pool-contexts.js',import.meta.url),'utf8');
const board=fs.readFileSync(new URL('../app/js/board.js',import.meta.url),'utf8');
const guest=fs.readFileSync(new URL('../app/js/guest-snapshot.js',import.meta.url),'utf8');
const picks=fs.readFileSync(new URL('../app/js/picks.js',import.meta.url),'utf8');

let fail=0;
const check=(name,cond)=>{console.log(cond?'PASS':'FAIL',name); if(!cond) fail++;};

const nav=html.match(/<nav class="tabs" id="navTabs">([\s\S]*?)<\/nav>/)?.[1]||'';
check('simple home is named This Week in top nav',/data-tab="snapshot" class="active">This Week<\/button>/.test(nav));
check('advanced workspace is named All Games in top nav',/data-tab="pickboard">All Games<\/button>/.test(nav));
check('This Week remains first in the ATS product navigation',nav.indexOf('data-tab="snapshot"') < nav.indexOf('data-tab="pickboard"'));
check('mobile hamburger defaults to This Week',html.includes('id="navHamburgerLabel">This Week</span>'));
check('This Week hero immediately names best ATS opportunities',/<div class="eyebrow">This Week<\/div>\s*<h2 class="panel-title" id="snapOppTitle">Best ATS opportunities<\/h2>/.test(html));
check('secondary quick-look copy stays focused on games rather than setup',html.includes('<div class="eyebrow">More from this week</div>')&&html.includes('<h2 class="panel-title small">Games to watch</h2>'));
check('full-board CTA is now framed as optional All Games depth',html.includes('Need the full slate?')&&html.includes('id="snapFullBoardBtn">Open All Games →</button>'));
check('Pick Board internal board subview is user-facing All Games',/data-pickboard-view="board" class="active">All Games<\/button>/.test(html));
check('All Games shell metadata uses the new advanced-workspace language',/return \{title:"All Games",sub:"Explore every matchup, model input, and advanced ATS control\."\};/.test(tabs));
check('default Overall context can suppress synthetic Entry 1 noise',ctx.includes('const showOverallEntry=!pool && !!ent')&&ctx.includes('(ent.name&&ent.name!=="Entry 1")'));
check('default Overall summary is reduced to Overall + week',ctx.includes(': `${poolLabel}${showOverallEntry?` · ${entryLabel}`:""} · ${weekLbl}`'));
check('zero-pick default does not force a 0/7 picks status',ctx.includes('if(pool || showOverallEntry || pickedCount>0) parts.push(`${pickedCount}/${limit} picks selected`)'));
check('pool onboarding is hidden on This Week so picks lead the experience',board.includes('const onThisWeek=!!document.getElementById("tab-snapshot")?.classList.contains("active")')&&board.includes('sharedWidgetsHiddenOnCurrentTab() || onThisWeek || pool || everHadAPool'));
check('guest locked depth CTAs say All Games',guest.includes('fullBtn.textContent="All Games 🔒"')&&guest.includes('seeAll.textContent="All Games 🔒"'));
check('My Picks empty state points back to This Week or All Games',picks.includes('Select a team from This Week or All Games while this entry is active.'));
check('legacy public-facing Snapshot/Pick Board path copy is removed from app markup',!html.includes('Select a team from Snapshot or Pick Board → This Week'));

if(fail) process.exit(1);
console.log('This Week core-experience regression passed.');
