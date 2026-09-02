import fs from "node:fs";
import vm from "node:vm";

const main=fs.readFileSync(new URL("../app/js/main.js",import.meta.url),"utf8");
const board=fs.readFileSync(new URL("../app/js/board.js",import.meta.url),"utf8")
  // renderSnapshot() and everything Snapshot-specific moved to its own file
  // (Sept 1, 2026, TODO #24) -- concatenated here under the same `board`
  // variable so every check below keeps working unchanged regardless of
  // which of the two files a given function now actually lives in.
  +"\n"+fs.readFileSync(new URL("../app/js/snapshot-export.js",import.meta.url),"utf8");

const failures=[];
let total=0;
function check(name,cond){
  total++;
  console.log(`[${cond?"PASS":"FAIL"}] ${name}`);
  if(!cond) failures.push(name);
}

function extractFunction(name){
  const marker=`function ${name}(`;
  const start=main.indexOf(marker);
  if(start<0) throw new Error(`Could not find ${name}()`);
  const brace=main.indexOf("{",start);
  let depth=0;
  for(let i=brace;i<main.length;i++){
    if(main[i]==="{") depth++;
    else if(main[i]==="}"){
      depth--;
      if(depth===0) return main.slice(start,i+1);
    }
  }
  throw new Error(`Could not parse ${name}()`);
}

const ctx={};
vm.createContext(ctx);
vm.runInContext(`${extractFunction("esc")};${extractFunction("norm")};${extractFunction("mkey")};`,ctx);

const hostile=[
  `"><img src=x onerror=alert(1)>`,
  `'><svg/onload=alert(1)>`,
  `<script>alert("x")</script>`,
  `&quot; autofocus onfocus=alert(1) x="`,
  `O'Brien " onclick="alert(1)`,
];

for(const payload of hostile){
  const escaped=ctx.esc(payload);
  check(`esc() removes literal tag/attribute delimiters from hostile payload ${JSON.stringify(payload)}`,
    !/[<>"']/.test(escaped));
}

check("esc() encodes ampersand, angle brackets, double quote, and apostrophe with HTML entities",
  ctx.esc(`&<>"'`)==="&amp;&lt;&gt;&quot;&#39;");

for(const payload of hostile){
  const normalized=ctx.norm(payload);
  check(`norm() reduces hostile key material to lowercase alphanumerics only for ${JSON.stringify(payload)}`,
    /^[a-z0-9]*$/.test(normalized));
}

const hostileKey=ctx.mkey(`A"><img src=x onerror=1>`,`B' onmouseover='x`);
check("mkey() preserves the board invariant: exactly one @ separator with only lowercase alphanumerics on either side",
  /^[a-z0-9]*@[a-z0-9]*$/.test(hostileKey));

check("Board pick buttons escape away-team display text",
  board.includes('${awayLogoHTML}${esc(g.away)}<span class="tp-line">'));
check("Board pick buttons escape home-team display text",
  board.includes('${homeLogoHTML}${esc(g.home)}<span class="tp-line">'));

check("The previously-audited unescaped data-pickteam attribute still receives g.key, not raw team text",
  board.includes('data-pickteam="${g.key}"'));
check("Board row data-key assignment uses the DOM dataset API rather than HTML-string interpolation",
  board.includes("tr.dataset.key=g.key;"));

check("No raw g.away is interpolated into a data-* attribute in board.js",
  !/data-[a-z0-9_-]+\s*=\s*["'][^"']*\$\{g\.away\}/i.test(board));
check("No raw g.home is interpolated into a data-* attribute in board.js",
  !/data-[a-z0-9_-]+\s*=\s*["'][^"']*\$\{g\.home\}/i.test(board));

if(failures.length){
  console.log(`\n${failures.length} of ${total} FAILURE(S):`,failures);
  process.exit(1);
}
console.log(`\nAll ${total} checks passed.`);
