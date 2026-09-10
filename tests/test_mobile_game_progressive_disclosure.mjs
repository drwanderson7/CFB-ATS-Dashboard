import fs from 'node:fs';
const board=fs.readFileSync(new URL('../app/js/board.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../app/css/app.css',import.meta.url),'utf8');
let fail=0; const check=(n,c)=>{console.log(c?'PASS':'FAIL',n);if(!c)fail++;};

check('mobile decision summary helper exists',board.includes('function boardMobileDecisionHTML(g,e)'));
check('summary uses active model number that drives Edge',board.includes('const activeModel=myNumber(g);'));
check('away recommendations flip model into the away-side perspective',board.includes('e.side==="away"?-Number(activeModel):Number(activeModel)'));
check('summary labels the recommended side explicitly',board.includes('mobile-decision-kicker">Recommended side'));
check('summary exposes Market/Pool line, model, Edge and Cover',board.includes('<span>${refLabel}</span>')&&board.includes('<span>${esc(modelLabel)}</span>')&&board.includes('<span>Edge</span>')&&board.includes('<span>Cover</span>'));
check('phone disclosure action is Why team',board.includes("`Why ${esc(e.side===\"home\""));
check('desktop Matchup breakdown label remains intact',board.includes("const boardToggleLabel=boardExpanded?'▴ Hide matchup breakdown':'▾ Matchup breakdown';"));
check('expanded mobile evidence includes agreement and key numbers',board.includes('<span>Model agreement</span>')&&board.includes('<span>Key numbers</span>'));
check('mobile evidence includes My Number when present',board.includes('<span>My Number</span>'));
check('pool evidence can include CLV',board.includes('<span>CLV</span>'));
check('mobile decision cell is hidden by default for desktop',css.includes('.mobile-decision-cell,.board-mobile-why{display:none;}'));
check('mobile decision cell becomes visible only inside phone media query',css.includes('@media(max-width:720px)')&&css.includes('.board td.mobile-decision-cell{'));
check('legacy mobile stat cells are hidden in phone layout',css.includes('>td.veg-cell,')&&css.includes('>td.myn-cell,')&&css.includes('>td.prob-cell{display:none!important;}'));
check('desktop table DOM still renders original Vegas/Model/Cover/Edge cells',board.includes('class="veg-cell"')&&board.includes('class="myn-cell"')&&board.includes('class="prob-cell"')&&board.includes('class="edge"'));

if(fail) process.exit(1);
console.log('Mobile game progressive-disclosure regression passed.');
