/* VANTIX_RESTAURANT_V2_KDS_PRINTER_HYBRID_V24 */
(()=>{'use strict';
const MARKER='VANTIX_RESTAURANT_V2_KDS_PRINTER_HYBRID_V24';
const RV2=window.RestaurantV2;if(!RV2)return;
if(!location.pathname.startsWith('/app/restaurante-v2/kds'))return;
const session=RV2.readSession?.()||null;
const ADMIN_ROLES=new Set(['ADMIN','SUPER_ADMIN']);
const role=String(session?.user?.rol||'').toUpperCase();
if(!ADMIN_ROLES.has(role))return;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const baseFetch=window.fetch.bind(window);
let pendingPrinter=null;
let edgeTimer=null;

async function api(path,options={}){return RV2.api(path,options)}
function esc(value){return String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
function printerMode(value){return ['IMPRESORA','AMBOS'].includes(String(value||'').toUpperCase())}
function setPrinterStatus(section,text,error=false){const n=section?.querySelector('[data-rv2-printer-status]');if(!n)return;n.textContent=text||'';n.classList.toggle('error',Boolean(error));}

async function onlineEdge(){
  const rows=await api('/api/v1/edge/installations');
  const list=Array.isArray(rows)?rows:[];
  const online=list.find(row=>row?.agent?.state==='ACTIVE'&&row?.installation?.online===true);
  if(!online)throw new Error('El Edge local del restaurante no está en línea.');
  return online;
}
async function relay(operation,requestBody={}){
  const edge=await onlineEdge();
  const created=await api('/api/v1/edge/relay/requests',{method:'POST',body:JSON.stringify({edgeAgentId:edge.agent.id,action:'PRINT_QUEUE',requestBody:{operation,...requestBody},ttlSeconds:30})});
  for(let attempt=0;attempt<50;attempt+=1){
    await sleep(350);
    const row=await api('/api/v1/edge/relay/requests/'+created.id);
    if(row?.state==='COMPLETED')return row.responseBody||{};
    if(row?.state==='FAILED'||row?.state==='EXPIRED')throw new Error(row.errorMessage||'El Edge no pudo completar la operación.');
  }
  throw new Error('El Edge no respondió a tiempo.');
}
function printerOptions(select,printers,current=''){
  if(!select)return;
  const selected=String(current||select.value||'');
  select.innerHTML='<option value="">Sin impresora</option>'+printers.map(p=>`<option value="${esc(p.name)}">${esc(p.name)}${p.default?' · Predeterminada':''}${p.workOffline?' · Offline':''}</option>`).join('');
  if(selected&&!Array.from(select.options).some(o=>o.value===selected))select.insertAdjacentHTML('beforeend',`<option value="${esc(selected)}">${esc(selected)}</option>`);
  select.value=selected;
}
async function detectPrinters(section){
  const button=section.querySelector('[data-rv2-printer-detect]');if(button)button.disabled=true;
  setPrinterStatus(section,'Buscando impresoras instaladas en Windows…');
  try{
    const result=await relay('WINDOWS_PRINTERS');
    const printers=Array.isArray(result?.printers)?result.printers:[];
    printerOptions(section.querySelector('[data-rv2-printer-select]'),printers);
    setPrinterStatus(section,printers.length?`${printers.length} impresora(s) detectada(s).`:'Windows no reportó impresoras instaladas.',!printers.length);
  }catch(error){setPrinterStatus(section,error.message||'No fue posible detectar impresoras.',true)}
  finally{if(button)button.disabled=false}
}
async function testPrinter(section){
  const printerName=String(section.querySelector('[data-rv2-printer-select]')?.value||'').trim();
  if(!printerName){setPrinterStatus(section,'Selecciona una impresora primero.',true);return}
  const button=section.querySelector('[data-rv2-printer-test]');if(button)button.disabled=true;
  setPrinterStatus(section,'Enviando impresión de prueba…');
  try{await relay('WINDOWS_TEST',{printerName});setPrinterStatus(section,'Prueba enviada correctamente. Revisa el papel.');}
  catch(error){setPrinterStatus(section,error.message||'No fue posible imprimir la prueba.',true)}
  finally{if(button)button.disabled=false}
}
async function currentStation(dialog){
  const name=String(dialog.querySelector('[name="name"]')?.value||'').trim().toLocaleLowerCase('es');
  if(!name)return null;
  const rows=await api('/api/v1/impresion/estaciones');
  return (Array.isArray(rows)?rows:[]).find(row=>String(row.name||'').trim().toLocaleLowerCase('es')===name)||null;
}
function syncPrinterVisibility(dialog,section){
  const mode=dialog.querySelector('[name="mode"]')?.value||'KDS';
  section.hidden=!printerMode(mode);
}
async function enhanceEditor(dialog){
  if(!dialog||dialog.querySelector('[data-rv2-printer-v24]'))return;
  const form=dialog.querySelector('[data-station-form]');if(!form)return;
  const section=document.createElement('section');
  section.dataset.rv2PrinterV24='true';
  section.className='rv2-printer-v24';
  section.innerHTML=`<div class="rv2-printer-title"><div><b>Impresora de esta estación</b><small>Se detecta desde el Edge del computador del restaurante. No necesitas escribir el nombre manualmente.</small></div><span>EDGE / WINDOWS</span></div><div class="rv2-printer-row"><select data-rv2-printer-select><option value="">Sin impresora</option></select><button class="rv2-btn" type="button" data-rv2-printer-detect>Detectar impresoras</button><button class="rv2-btn" type="button" data-rv2-printer-test>Probar impresión</button></div><label>Formato<select data-rv2-printer-format><option value="TERMICA_80">Térmica 80 mm</option><option value="TERMICA_58">Térmica 58 mm</option></select></label><div class="rv2-printer-status" data-rv2-printer-status></div>`;
  const note=form.querySelector('.rv2-station-note');
  if(note){note.textContent='“Pantalla KDS” muestra comandas. “Sólo impresora” envía la comanda a la impresora elegida. “KDS + impresora” usa ambos al mismo tiempo.';note.after(section)}else form.appendChild(section);
  form.querySelector('[name="mode"]')?.addEventListener('change',()=>syncPrinterVisibility(dialog,section));
  section.querySelector('[data-rv2-printer-detect]')?.addEventListener('click',()=>detectPrinters(section));
  section.querySelector('[data-rv2-printer-test]')?.addEventListener('click',()=>testPrinter(section));
  syncPrinterVisibility(dialog,section);
  try{
    const station=await currentStation(dialog);
    const printer=(station?.printers||[]).find(row=>String(row.transport||'').toUpperCase()==='WINDOWS')||null;
    if(printer){
      section.dataset.printerId=printer.id||'';
      section.dataset.previousPrinter=printer.host||'';
      printerOptions(section.querySelector('[data-rv2-printer-select]'),[],printer.host||'');
      section.querySelector('[data-rv2-printer-format]').value=printer.format||'TERMICA_80';
      setPrinterStatus(section,`${printer.active===false?'Configurada pero inactiva':'Configurada'}: ${printer.host||printer.name||''}`);
    }
  }catch{}
}
async function persistPrinter(station,config){
  if(!station?.printerRole)return;
  const mode=String(station.mode||'').toUpperCase();
  const printerName=String(config?.printerName||'').trim();
  const existingId=String(config?.existingId||'').trim();
  const format=String(config?.format||'TERMICA_80');
  if(!printerMode(mode)||!printerName){
    if(existingId){
      await api('/api/v1/impresion/impresoras',{method:'POST',body:JSON.stringify({id:existingId,name:'USB · '+station.name,transport:'WINDOWS',role:station.printerRole,host:config.previousPrinter||'Impresora Windows',port:null,format,active:false})});
    }
    return;
  }
  await api('/api/v1/impresion/impresoras',{method:'POST',body:JSON.stringify({...(existingId?{id:existingId}:{}),name:'USB · '+station.name,transport:'WINDOWS',role:station.printerRole,host:printerName,port:null,format,active:true})});
}
window.fetch=async function(input,options={}){
  let url;
  try{url=new URL(typeof input==='string'?input:(input?.url||''),location.origin)}catch{return baseFetch(input,options)}
  const method=String(options?.method||'GET').toUpperCase();
  const stationWrite=url.origin===location.origin&&/^\/api\/v1\/impresion\/estaciones(?:\/[^/]+)?$/.test(url.pathname)&&['POST','PATCH'].includes(method);
  const config=stationWrite?pendingPrinter:null;
  const response=await baseFetch(input,options);
  if(stationWrite&&response.ok&&config){
    try{const body=await response.clone().json();await persistPrinter(body?.data,config)}
    catch(error){setTimeout(()=>alert('La estación se guardó, pero la impresora no pudo guardarse: '+(error.message||error)),0)}
    finally{pendingPrinter=null}
  }
  return response;
};
document.addEventListener('submit',event=>{
  const form=event.target?.closest?.('[data-station-form]');
  const dialog=form?.closest?.('#rv2StationEditorV23');
  const section=dialog?.querySelector?.('[data-rv2-printer-v24]');
  if(!section)return;
  pendingPrinter={printerName:section.querySelector('[data-rv2-printer-select]')?.value||'',existingId:section.dataset.printerId||'',previousPrinter:section.dataset.previousPrinter||section.querySelector('[data-rv2-printer-select]')?.value||'',format:section.querySelector('[data-rv2-printer-format]')?.value||'TERMICA_80'};
},true);

function ensureStyles(){if(document.querySelector('#rv2PrinterHybridV24Styles'))return;const s=document.createElement('style');s.id='rv2PrinterHybridV24Styles';s.textContent=`.rv2-printer-v24{display:grid;gap:10px;padding:13px;border:1px solid #d8e2dd;border-radius:12px;background:#f8fbf9}.rv2-printer-v24[hidden]{display:none!important}.rv2-printer-title{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.rv2-printer-title div{display:grid;gap:3px}.rv2-printer-title small{color:#68766f;font-size:11px;font-weight:500;line-height:1.4}.rv2-printer-title span,.rv2-hybrid-badge{display:inline-flex;align-items:center;gap:6px;padding:5px 8px;border-radius:999px;background:#ddf3e8;color:#0d6b43;font-size:10px;font-weight:900;white-space:nowrap}.rv2-hybrid-badge.off{background:#fff4d7;color:#7a5600}.rv2-printer-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px}.rv2-printer-v24 select{min-height:42px;border:1px solid #cfd8d4;border-radius:10px;padding:0 10px;background:#fff}.rv2-printer-status{min-height:16px;font-size:11px;font-weight:750;color:#176246}.rv2-printer-status.error{color:#a12d2d}@media(max-width:700px){.rv2-printer-row{grid-template-columns:1fr}.rv2-printer-title{display:grid}.rv2-printer-row>.rv2-btn{width:100%}}`;document.head.appendChild(s)}
async function refreshHybridBadge(){
  const badge=document.querySelector('[data-rv2-hybrid-v24]');if(!badge)return;
  try{const edge=await onlineEdge();badge.classList.remove('off');badge.textContent=`HÍBRIDO · Edge conectado${edge?.installation?.deviceName?' · '+edge.installation.deviceName:''}`;badge.title='Core en nube + Edge local. La operación local se sincroniza automáticamente.';}
  catch{badge.classList.add('off');badge.textContent='HÍBRIDO · Edge sin conexión';badge.title='El Core sigue disponible; el Edge local sincronizará lo pendiente cuando recupere conexión.';}
}
function mountHybridBadge(){
  if(document.querySelector('[data-rv2-hybrid-v24]'))return;
  const nav=document.querySelector('.kds-top nav');if(!nav)return;
  const badge=document.createElement('span');badge.className='rv2-hybrid-badge off';badge.dataset.rv2HybridV24='true';badge.textContent='HÍBRIDO · verificando Edge…';
  nav.prepend(badge);refreshHybridBadge();edgeTimer=setInterval(refreshHybridBadge,15000);edgeTimer.unref?.();
}
const observer=new MutationObserver(()=>{const dialog=document.querySelector('#rv2StationEditorV23');if(dialog)enhanceEditor(dialog)});
ensureStyles();
observer.observe(document.documentElement,{childList:true,subtree:true});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mountHybridBadge,{once:true});else mountHybridBadge();
window.addEventListener('beforeunload',()=>{observer.disconnect();if(edgeTimer)clearInterval(edgeTimer)},{once:true});
window.RestaurantV2KdsPrinterHybridV24=Object.freeze({marker:MARKER,detectPrinters,testPrinter,refreshHybridBadge});
})();
