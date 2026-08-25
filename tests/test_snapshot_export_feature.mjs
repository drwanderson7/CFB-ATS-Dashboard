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

if (failures.length) {
  console.log(`\n${failures.length} of ${total} FAILURE(S):`, failures);
  process.exit(1);
}
console.log(`\nAll ${total} checks passed.`);
