// PickGauge UI icon helper — Sep 9, 2026.
// Icons are rendered from the inline SVG symbol sprite in app/index.html.
// Keeping the paths local avoids platform emoji differences (especially
// Safari/iOS) and gives the app one consistent line-icon vocabulary.
function pgIcon(name, className=""){
  const safe=String(name||"").replace(/[^a-z0-9-]/gi,"");
  const cls=String(className||"").replace(/[^a-z0-9 _-]/gi,"");
  return `<svg class="pg-icon${cls?` ${cls}`:""}" aria-hidden="true" focusable="false"><use href="#pg-icon-${safe}"></use></svg>`;
}
