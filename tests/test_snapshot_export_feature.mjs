import fs from 'node:fs';

const html = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const board = fs.readFileSync(new URL('../app/js/board.js', import.meta.url), 'utf8');

const failures = [];
let total = 0;
function check(name, cond) {
  total++;
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}`);
  if (!cond) failures.push(name);
}

check('Snapshot header includes an export button on the Snapshot page',
  /id="snapExportBtn"[^>]*>Export top 5 graphic</.test(html));

check('Board JS defines exportSnapshotTopEdgesGraphic()',
  /async function exportSnapshotTopEdgesGraphic\(\)/.test(board));

check('Export flow builds a canvas-based PNG download',
  /canvas\.toBlob\(resolve,'image\/png'\)/.test(board) && /a\.download=`pickgauge_top5_edges_\$\{weekSlug\}\.png`/.test(board));

check('renderSnapshot wires the export button click handler',
  /const exportBtn=document\.getElementById\("snapExportBtn"\);[\s\S]{0,800}await exportSnapshotTopEdgesGraphic\(\)/.test(board));

check('Export graphic is grounded on the real top 5 snapshot rows, not a static mock',
  /function snapshotExportRows\(limit\)/.test(board) && /const rows=snapshotExportRows\(5\);/.test(board));

check('Export ranking is always raw edge even when Snapshot UI is sorted by Cover %',
  /\.sort\(\(a,b\)=>b\.e\.pts-a\.e\.pts\)/.test(board));

check('Export fetches same-origin logo data for canonical team ids so canvas PNGs can contain real logos',
  /logoIds=\$\{encodeURIComponent\(ids\.join\(','\)\)\}/.test(board));

check('Edge panel has a dedicated reserved column instead of sharing the Lean column',
  /const edgeW=148, edgeX=cardX\+cardW-edgeW;/.test(board) && !/const c1=cardX\+520, c2=cardX\+665, c3=cardX\+810/.test(board));

check('Export uses a normalized model-gap gauge rather than the old -45 to +45 absolute-spread axis',
  /function snapshotDrawEdgeGauge\(/.test(board) && !/snapshotDrawAxis\(/.test(board));

check('Export waits for web fonts before measuring/drawing text to prevent spacing drift',
  /document\.fonts&&document\.fonts\.ready/.test(board));

check('Header lockup uses the larger 68px PickGauge stadium icon with explicit vertical centering',
  /const iconSize=68;[\s\S]{0,180}const brandCenterY=brandY\+iconSize\/2;/.test(board));

check('Top 5 title is intentionally smaller than the prior 86px version',
  /ctx\.font='800 76px Oswald, Inter, Arial Black, sans-serif';/.test(board) && !/ctx\.font='800 86px Oswald/.test(board));

check('Export canvas is cropped vertically to reduce the large empty area below the fifth card',
  /const W=1080, H=1250;/.test(board));

if (failures.length) {
  console.log(`\n${failures.length} of ${total} FAILURE(S):`, failures);
  process.exit(1);
}
console.log(`\nAll ${total} checks passed.`);
