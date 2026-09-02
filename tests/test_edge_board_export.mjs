// Regression for Edge Board Weekly Board PDF + CSV export (Sep 2, 2026).
import fs from 'node:fs';
import vm from 'node:vm';

let pass=0, fail=0;
function check(name, cond){
  if(cond){ console.log('PASS', name); pass++; }
  else { console.error('FAIL', name); fail++; }
}
const src=fs.readFileSync(new URL('../app/js/board-export.js', import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../app/index.html', import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../app/css/app.css', import.meta.url),'utf8');
const init=fs.readFileSync(new URL('../app/js/init.js', import.meta.url),'utf8');

const gameA={key:'a',away:'Alpha',home:'Beta',awayRotation:159,homeRotation:160,commence:'2026-09-05T16:00:00Z',vegas:-7,liveVegas:-7.5,lockedLine:-6.5};
const gameB={key:'b',away:'Gamma',home:'Delta',awayRotation:161,homeRotation:162,commence:'2026-09-05T19:30:00Z',vegas:-3,liveVegas:-3,lockedLine:-2.5};
const context={
  console, Date, Number, Math, String, Blob:function(){}, URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}},
  state:{enabledSystems:['bp','comp','teamrank'],boardFilter:'all',boardShortlistOnly:false,sortKey:'rotation',sortDir:'asc',weekAnchor:1},
  games:[gameA,gameB],
  SORT_LABELS:{rotation:'Rotation #'},
  currentPool:()=>({name:'Office Pool',weekLabel:'Week 1',pickLimit:7}),
  activeEntry:()=>({name:'Entry 2',picks:{a:{team:'Alpha',line:6.5}}}),
  pickLimit:()=>7,
  currentWeekIndex:()=>1,
  weekLabel:i=>`Week ${i}`,
  boardVisibleGames:gs=>gs.filter(g=>g.key==='a'),
  currentShortlist:()=>['b'],
  isShortlisted:key=>key==='b',
  inputsFor:key=>key==='a'?[-8,-7.5]:[-4,null],
  predsFor:key=>key==='a'?{teamrank:-7.2}:{teamrank:-2.5},
  enabledSystemsOrdered:()=>['teamrank'],
  predShort:()=> 'TRNK', predName:()=> 'TeamRankings.com',
  userNumberFor:g=>g.key==='a'?-7.8:null,
  isPickGaugeModelActive:()=>true,
  myBlendActive:()=>false,
  modelColumnDisplayNumber:g=>g.key==='a'?-7.6:-2.8,
  myNumber:g=>g.key==='a'?-7.6:-2.8,
  edgeOf:g=>g.key==='a'?{pts:1.1,team:'Alpha',line:6.5,prob:{side:'away',pCover:54.4}}:null,
  edgeTierLabel:()=> 'Good',
  fmt:n=>{ const x=Number(n); return `${x>0?'+':''}${x.toFixed(1)}`; },
  rotationStr:g=>`Rot ${g.awayRotation}–${g.homeRotation}`,
  kickStr:v=>v==='2026-09-05T16:00:00Z'?'Sat, 11:00 AM CDT':'Sat, 2:30 PM CDT',
  document:{getElementById:()=>null,createElement:()=>({}),body:{appendChild(){}}},
  window:{open:()=>null},
};
vm.createContext(context);
vm.runInContext(src,context,{filename:'board-export.js'});

check('Edge Board has Export board menu', html.includes('id="boardExportMenu"'));
check('Weekly Board PDF is primary export action', html.includes('id="exportWeeklyBoardPdf"'));
check('Current view PDF is available separately', html.includes('id="exportCurrentBoardPdf"'));
check('Board CSV is available', html.includes('id="exportWeeklyBoardCsv"'));
check('board-export.js loads after board.js', html.indexOf('/app/js/board-export.js')>html.indexOf('/app/js/board.js'));
check('init wires board export once', init.includes('if(typeof initBoardExport==="function") initBoardExport();'));
check('export menu has responsive styling', css.includes('.board-export-popover') && css.includes('.board-export-menu{width:100%}'));

const full=context.boardExportGames('full');
const current=context.boardExportGames('current');
check('full weekly export ignores filters', full.length===2);
check('current-view export honors active filters', current.length===1 && current[0].key==='a');

const report=context.boardExportBuildHtml('full');
check('report is landscape print layout', report.includes('@page{size:landscape'));
check('report identifies full board filters ignored', report.includes('Full weekly board · filters ignored'));
check('report includes pool/week/entry context', report.includes('Office Pool') && report.includes('Week 1') && report.includes('Entry 2'));
check('report includes rotation and kickoff', report.includes('class=\"rot\">159') && report.includes('11:00 AM CDT'));
check('report includes enabled BP/Comp/system inputs', report.includes('<b>BP</b> -8.0') && report.includes('<b>Comp</b> -7.5') && report.includes('<b>TRNK</b> -7.2'));
check('report includes My Numbers when present', report.includes('<b>MY</b> -7.8'));
check('report includes PickGauge final number without proprietary weights', report.includes('PickGauge Model #') && report.includes('proprietary weighting is intentionally not printed'));
check('report includes pick and shortlist status', report.includes('PICK · Alpha +6.5') && report.includes('SHORTLIST'));
check('report excludes Matchup Intelligence from compact print', report.includes('Matchup Intelligence is excluded'));

check('CSV exports one column per enabled input', src.includes('descriptors.forEach(d=>headers.push(d.fullLabel||d.label))'));
check('CSV full-board export does not use current filters', src.includes('const reportGames=boardExportGames("full")'));
check('PDF uses native print dialog instead of raster screenshot', src.includes('w.print()') && !src.includes('canvas.toDataURL'));

if(fail){
  console.error(`Edge Board export tests: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`Edge Board export tests passed (${pass}/${pass})`);
