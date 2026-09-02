// Regression for Edge Board Game time + Rotation # sorting (Sep 2, 2026).
import fs from 'node:fs';
import vm from 'node:vm';

let pass=0, fail=0;
function check(name, cond){
  if(cond){ console.log('PASS', name); pass++; }
  else { console.error('FAIL', name); fail++; }
}

const src=fs.readFileSync(new URL('../app/js/board.js', import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../app/index.html', import.meta.url),'utf8');
const pdf=fs.readFileSync(new URL('../app/js/pdf-import.js', import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../app/css/app.css', import.meta.url),'utf8');

const context={
  console,
  Date,
  Number,
  Math,
  String,
  state:{sortKey:'edge',sortDir:'desc',lastGames:[]},
  games:[],
};
vm.createContext(context);
vm.runInContext(src, context, {filename:'board.js'});

check('Sort menu exposes Game time', html.includes('<option value="kickoff">Game time</option>'));
check('Sort menu exposes Rotation #', html.includes('<option value="rotation">Rotation #</option>'));
check('desktop + mobile share the sort control', css.includes('.board-sort-ctrl{display:flex'));
check('Game time defaults ascending', vm.runInContext('SORT_DEFAULT_DIR.kickoff',context)==='asc');
check('Rotation # defaults ascending', vm.runInContext('SORT_DEFAULT_DIR.rotation',context)==='asc');

context.games=[
  {key:'late',home:'Zulu',commence:'2026-09-05T23:00:00Z',awayRotation:205,homeRotation:206},
  {key:'early-b',home:'Beta',commence:'2026-09-05T16:00:00Z',awayRotation:173,homeRotation:174},
  {key:'missing',home:'Missing',commence:null},
  {key:'early-a',home:'Alpha',commence:'2026-09-05T16:00:00Z',awayRotation:169,homeRotation:170},
];
vm.runInContext("sortGamesBy('kickoff','asc')",context);
check('Game time sort is chronological', context.games.map(g=>g.key).join(',')==='early-a,early-b,late,missing');
check('same kickoff time uses rotation as stable tie-breaker', context.games[0].key==='early-a' && context.games[1].key==='early-b');
check('missing kickoff sorts last', context.games.at(-1).key==='missing');

context.games=[
  {key:'r205',home:'C',awayRotation:205,homeRotation:206},
  {key:'norot',home:'D'},
  {key:'r159',home:'A',awayRotation:159,homeRotation:160},
  {key:'r173',home:'B',awayRotation:173,homeRotation:174},
];
vm.runInContext("sortGamesBy('rotation','asc')",context);
check('Rotation # sort uses ascending game rotation', context.games.map(g=>g.key).join(',')==='r159,r173,r205,norot');
check('missing rotation sorts last', context.games.at(-1).key==='norot');
check('rotation label displays both sides when available', vm.runInContext("rotationStr({awayRotation:159,homeRotation:160})",context)==='Rot 159–160');

check('pool runtime carries rotation from live odds or pool metadata', src.includes('const awayRotation=pg.awayRotation!=null?pg.awayRotation'));
check('Powers overlay fills missing runtime rotations', pdf.includes('if(bg.awayRotation==null&&g.awayRotation!=null) bg.awayRotation=g.awayRotation'));
check('Powers-only board build preserves rotations', pdf.includes('...(g.awayRotation!=null?{awayRotation:g.awayRotation}:{})'));
check('board row displays rotation alongside kickoff metadata', src.includes('${gameMetaStr(g)}'));

if(fail){
  console.error(`Edge Board time/rotation sort tests: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`Edge Board time/rotation sort tests passed (${pass}/${pass})`);
