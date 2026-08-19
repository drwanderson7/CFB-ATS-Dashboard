// --- PickGauge modal dialogs --------------------------------------------
// Replaces browser-native alert()/confirm()/prompt() with one reusable,
// accessible in-app dialog layer. All helpers are Promise-based because a
// custom modal cannot synchronously block JavaScript the way native browser
// dialogs do.
//
// Public helpers:
//   pgAlert({title,message,confirmText}) -> Promise<void>
//   pgConfirm({title,message,confirmText,cancelText,danger}) -> Promise<boolean>
//   pgPrompt({title,message,label,value,...field options}) -> Promise<string|null>
//   pgChoice({title,message,choices:[{value,label,description}],...}) -> Promise<string|null>
//   pgForm({title,message,fields:[...],validate(values),...}) -> Promise<object|null>
//
// Dialogs are queued. That matters for multi-step destructive flows such as
// account-data deletion: a second dialog opened immediately after the first
// resolves cannot collide with a still-closing overlay.
let pgDialogQueue=Promise.resolve();

function pgDialogLayer(){
  let layer=document.getElementById("pgDialogLayer");
  if(layer) return layer;
  layer=document.createElement("div");
  layer.id="pgDialogLayer";
  layer.className="pg-dialog-layer";
  layer.setAttribute("aria-hidden","true");
  document.body.appendChild(layer);
  return layer;
}

function pgOpenDialog(options){
  const run=()=>pgOpenDialogNow(options||{});
  const result=pgDialogQueue.then(run,run);
  pgDialogQueue=result.catch(()=>null);
  return result;
}

function pgOpenDialogNow(options){
  return new Promise(resolve=>{
    const layer=pgDialogLayer();
    const previousFocus=document.activeElement;
    const previousOverflow=document.body.style.overflow;
    layer.innerHTML="";
    layer.setAttribute("aria-hidden","false");
    layer.classList.add("open");
    document.body.style.overflow="hidden";

    const panel=document.createElement("div");
    panel.className="pg-dialog"+(options.danger?" pg-dialog-is-danger":"");
    panel.setAttribute("role","dialog");
    panel.setAttribute("aria-modal","true");

    const heading=document.createElement("div");
    heading.className="pg-dialog-heading";
    if(options.eyebrow){
      const eyebrow=document.createElement("div");
      eyebrow.className="pg-dialog-eyebrow";
      eyebrow.textContent=options.eyebrow;
      heading.appendChild(eyebrow);
    }
    const title=document.createElement("h2");
    title.className="pg-dialog-title";
    title.id="pgDialogTitle";
    title.textContent=options.title||"PickGauge";
    heading.appendChild(title);
    panel.setAttribute("aria-labelledby",title.id);
    if(options.message){
      const message=document.createElement("div");
      message.className="pg-dialog-message";
      message.id="pgDialogMessage";
      message.textContent=options.message;
      heading.appendChild(message);
      panel.setAttribute("aria-describedby",message.id);
    }
    panel.appendChild(heading);

    const form=document.createElement("form");
    form.className="pg-dialog-form";
    form.noValidate=true;
    const fields=Array.isArray(options.fields)?options.fields:[];
    const fieldEls={};

    fields.forEach((field,index)=>{
      const wrap=document.createElement("label");
      wrap.className="pg-dialog-field";
      const label=document.createElement("span");
      label.className="pg-dialog-field-label";
      label.textContent=field.label||field.name||"Value";
      wrap.appendChild(label);
      const input=document.createElement(field.multiline?"textarea":"input");
      if(!field.multiline) input.type=field.type||"text";
      input.name=field.name||`field${index}`;
      input.value=field.value==null?"":String(field.value);
      if(field.placeholder) input.placeholder=field.placeholder;
      if(field.autocomplete) input.autocomplete=field.autocomplete;
      if(field.inputMode) input.inputMode=field.inputMode;
      if(field.min!=null) input.min=String(field.min);
      if(field.max!=null) input.max=String(field.max);
      if(field.step!=null) input.step=String(field.step);
      if(field.required) input.required=true;
      if(field.maxLength!=null) input.maxLength=Number(field.maxLength);
      if(field.multiline && field.rows) input.rows=Number(field.rows);
      input.className="pg-dialog-input";
      wrap.appendChild(input);
      if(field.help){
        const help=document.createElement("span");
        help.className="pg-dialog-help";
        help.textContent=field.help;
        wrap.appendChild(help);
      }
      form.appendChild(wrap);
      fieldEls[input.name]=input;
    });

    let selectedChoice=options.choiceValue==null?null:String(options.choiceValue);
    const choices=Array.isArray(options.choices)?options.choices:[];
    if(choices.length){
      const choiceWrap=document.createElement("div");
      choiceWrap.className="pg-dialog-choices";
      choices.forEach((choice,index)=>{
        const label=document.createElement("label");
        label.className="pg-dialog-choice";
        const radio=document.createElement("input");
        radio.type="radio";
        radio.name="pgDialogChoice";
        radio.value=String(choice.value);
        radio.checked=selectedChoice!=null?radio.value===selectedChoice:index===0;
        if(radio.checked) selectedChoice=radio.value;
        radio.onchange=()=>{ if(radio.checked) selectedChoice=radio.value; };
        const text=document.createElement("span");
        text.className="pg-dialog-choice-text";
        const primary=document.createElement("span");
        primary.className="pg-dialog-choice-label";
        primary.textContent=choice.label==null?String(choice.value):choice.label;
        text.appendChild(primary);
        if(choice.description){
          const desc=document.createElement("span");
          desc.className="pg-dialog-choice-description";
          desc.textContent=choice.description;
          text.appendChild(desc);
        }
        label.append(radio,text);
        choiceWrap.appendChild(label);
      });
      form.appendChild(choiceWrap);
    }

    const error=document.createElement("div");
    error.className="pg-dialog-error";
    error.setAttribute("role","alert");
    error.style.display="none";
    form.appendChild(error);

    const actions=document.createElement("div");
    actions.className="pg-dialog-actions";
    const cancelText=options.cancelText===undefined?"Cancel":options.cancelText;
    let cancelBtn=null;
    if(cancelText!==null){
      cancelBtn=document.createElement("button");
      cancelBtn.type="button";
      cancelBtn.className="btn btn-light pg-dialog-cancel";
      cancelBtn.textContent=cancelText;
      actions.appendChild(cancelBtn);
    }
    const confirmBtn=document.createElement("button");
    confirmBtn.type="submit";
    confirmBtn.className=options.danger?"btn pg-dialog-danger":"btn btn-go";
    confirmBtn.textContent=options.confirmText||"Continue";
    actions.appendChild(confirmBtn);
    form.appendChild(actions);
    panel.appendChild(form);
    layer.appendChild(panel);

    let settled=false;
    function readValues(){
      const out={};
      Object.entries(fieldEls).forEach(([name,input])=>{ out[name]=input.value; });
      return out;
    }
    function finish(confirmed){
      if(settled) return;
      settled=true;
      document.removeEventListener("keydown",onKeyDown,true);
      layer.removeEventListener("mousedown",onBackdropMouseDown);
      layer.classList.remove("open");
      layer.setAttribute("aria-hidden","true");
      layer.innerHTML="";
      document.body.style.overflow=previousOverflow;
      if(previousFocus&&typeof previousFocus.focus==="function"&&document.contains(previousFocus)){
        try{ previousFocus.focus(); }catch(_e){}
      }
      resolve({confirmed,values:readValues(),choice:selectedChoice});
    }
    function showError(message){
      error.textContent=message||"Please check the value and try again.";
      error.style.display="block";
    }
    function focusable(){
      return Array.from(panel.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'));
    }
    function onKeyDown(e){
      if(e.key==="Escape" && options.dismissible!==false){ e.preventDefault(); finish(false); return; }
      if(e.key!=="Tab") return;
      const items=focusable();
      if(!items.length){ e.preventDefault(); return; }
      const first=items[0],last=items[items.length-1];
      if(e.shiftKey&&document.activeElement===first){ e.preventDefault(); last.focus(); }
      else if(!e.shiftKey&&document.activeElement===last){ e.preventDefault(); first.focus(); }
    }

    function onBackdropMouseDown(e){
      if(e.target===layer&&options.dismissible!==false) finish(false);
    }
    cancelBtn&&cancelBtn.addEventListener("click",()=>finish(false));
    layer.addEventListener("mousedown",onBackdropMouseDown);
    document.addEventListener("keydown",onKeyDown,true);
    form.addEventListener("submit",e=>{
      e.preventDefault();
      error.style.display="none";
      const values=readValues();
      for(const field of fields){
        const name=field.name;
        const value=name&&Object.prototype.hasOwnProperty.call(values,name)?values[name]:"";
        if(field.required&&!String(value).trim()){
          showError(field.requiredMessage||`${field.label||"This field"} is required.`);
          fieldEls[name]&&fieldEls[name].focus();
          return;
        }
      }
      if(choices.length&&selectedChoice==null){ showError("Choose an option to continue."); return; }
      if(typeof options.validate==="function"){
        const problem=options.validate(values,selectedChoice);
        if(problem){ showError(problem); return; }
      }
      finish(true);
    });

    requestAnimationFrame(()=>{
      const firstField=fields.length?fieldEls[fields[0].name]:null;
      const checked=panel.querySelector('.pg-dialog-choice input:checked');
      const target=firstField||checked||confirmBtn;
      if(target){ target.focus(); if(firstField&&typeof firstField.select==="function") firstField.select(); }
    });
  });
}

async function pgAlert(arg){
  const o=typeof arg==="string"?{message:arg}:({...arg});
  await pgOpenDialog({...o,cancelText:null,confirmText:o.confirmText||"OK"});
}

async function pgConfirm(arg){
  const o=typeof arg==="string"?{message:arg}:({...arg});
  const result=await pgOpenDialog({...o,confirmText:o.confirmText||"Continue",cancelText:o.cancelText===undefined?"Cancel":o.cancelText});
  return !!result.confirmed;
}

async function pgPrompt(arg,defaultValue){
  const o=typeof arg==="string"?{message:arg,value:defaultValue}:({...arg});
  const field={
    name:"value",label:o.label||"Value",value:o.value==null?"":o.value,
    type:o.type||"text",placeholder:o.placeholder,autocomplete:o.autocomplete,
    inputMode:o.inputMode,min:o.min,max:o.max,step:o.step,required:!!o.required,
    requiredMessage:o.requiredMessage,maxLength:o.maxLength,help:o.help
  };
  const result=await pgOpenDialog({...o,fields:[field],choices:undefined,validate:o.validate?values=>o.validate(values.value):undefined});
  return result.confirmed?result.values.value:null;
}

async function pgChoice(arg){
  const o={...arg};
  const result=await pgOpenDialog(o);
  return result.confirmed?result.choice:null;
}

async function pgForm(arg){
  const result=await pgOpenDialog({...arg});
  return result.confirmed?result.values:null;
}
