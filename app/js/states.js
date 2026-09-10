// PickGauge shared empty/loading/error-state renderer — Sep 10, 2026.
// Working screens should answer three things when content is missing:
//   1) what state are we in, 2) why, and 3) what can the user do next?
// This stays presentation-only; feature files own the click handlers.
function pgStateEsc(value){
  return String(value==null?"":value)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#39;");
}
function pgStateHTML(config={}){
  const allowed=new Set(["empty","loading","error","info","success"]);
  const kind=allowed.has(config.kind)?config.kind:"empty";
  const defaultIcons={empty:"target",loading:"refresh",error:"alert",info:"info",success:"check"};
  const icon=String(config.icon||defaultIcons[kind]).replace(/[^a-z0-9-]/gi,"")||defaultIcons[kind];
  const title=pgStateEsc(config.title||"");
  const eyebrow=config.eyebrow?`<div class="pg-state-eyebrow">${pgStateEsc(config.eyebrow)}</div>`:"";
  const message=config.messageHTML!=null?String(config.messageHTML):(config.message?pgStateEsc(config.message):"");
  const detail=config.detail?`<div class="pg-state-detail">${pgStateEsc(config.detail)}</div>`:"";
  const actions=(Array.isArray(config.actions)?config.actions:[]).map(action=>{
    if(!action||!action.label)return "";
    const attrs=[];
    if(action.id) attrs.push(`id="${pgStateEsc(action.id)}"`);
    Object.entries(action.data||{}).forEach(([key,val])=>{
      const safeKey=String(key).replace(/[^a-z0-9_-]/gi,"");
      if(safeKey) attrs.push(`data-${safeKey}="${pgStateEsc(val)}"`);
    });
    if(action.ariaLabel) attrs.push(`aria-label="${pgStateEsc(action.ariaLabel)}"`);
    const cls=action.primary===false?"btn btn-light":"btn btn-secondary";
    const actionIcon=action.icon&&typeof pgIcon==="function"?pgIcon(action.icon):"";
    return `<button type="button" class="${cls}" ${attrs.join(" ")}>${actionIcon}${pgStateEsc(action.label)}</button>`;
  }).join("");
  const role=kind==="error"?' role="alert"':kind==="loading"?' role="status" aria-live="polite" aria-busy="true"':'';
  return `<div class="pg-state pg-state-${kind}${config.compact?" pg-state-compact":""}"${role}>
    <div class="pg-state-icon">${typeof pgIcon==="function"?pgIcon(icon):""}</div>
    <div class="pg-state-copy">${eyebrow}<div class="pg-state-title">${title}</div>${message?`<div class="pg-state-message">${message}</div>`:""}${detail}</div>
    ${actions?`<div class="pg-state-actions">${actions}</div>`:""}
  </div>`;
}
