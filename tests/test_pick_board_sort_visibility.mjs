import fs from 'fs';

const html=fs.readFileSync(new URL('../app/index.html', import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../app/css/app.css', import.meta.url),'utf8');
let failures=0;
function check(name,cond){
  if(cond) console.log('PASS',name);
  else { console.error('FAIL',name); failures++; }
}
const sortStart=html.indexOf('<div class="board-sort-ctrl board-sort-primary"');
const detailsStart=html.indexOf('<details class="pred-panel board-sf-panel"');
check('primary sort control exists',sortStart>=0);
check('sort control is outside/before collapsible filters panel',sortStart>=0&&detailsStart>=0&&sortStart<detailsStart);
check('sort label is explicit',html.includes('<span class="field-lbl">Sort by</span>'));
for(const [value,label] of [
  ['edge','Edge'],['cover','Cover %'],['myn','Model #'],['usernum','My Numbers'],
  ['vegas','Vegas'],['clv','CLV'],['kickoff','Game time'],['rotation','Rotation #'],['game','Game (A–Z)']
]) check(`sort option ${label} remains available`,html.includes(`<option value="${value}">${label}</option>`));
check('filters panel is now labeled Filters & legend',html.includes('Filters &amp; legend'));
check('primary sort gets explicit layout styling',css.includes('.board-sort-primary{margin:0;align-self:center;}'));
check('mobile keeps sort row full width',/@media\(max-width:720px\)[\s\S]*?\.board-sort-ctrl\{display:flex;width:100%;\}/.test(css));
if(failures) process.exit(1);
console.log('Pick Board sort visibility regression passed.');
