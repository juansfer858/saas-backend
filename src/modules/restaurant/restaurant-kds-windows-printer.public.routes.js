'use strict';

const MARKER = 'VANTIX_RESTAURANT_KDS_WINDOWS_PRINTER_V1';

const runtime = String.raw`
;(()=>{
  const MARKER='VANTIX_RESTAURANT_KDS_WINDOWS_PRINTER_V1';
  if(window.__vantixKdsWindowsPrinter===MARKER)return;
  window.__vantixKdsWindowsPrinter=MARKER;
  const SESSION_KEY='vantixgc_core_session_v1';
  let pendingPrinter=null;
  const baseFetch=window.fetch.bind(window);
  const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));
  function session(){try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{return null}}
  async function api(path,options={}){
    const s=session();
    if(!s?.token||!s?.subdomain)throw new Error('Sesión no disponible');
    const response=await window.fetch(path,{...options,cache:'no-store',headers:{Authorization:'Bearer '+s.token,'x-tenant-subdomain':s.subdomain,...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(body?.error?.message||body?.message||('HTTP '+response.status));
    return body.data;
  }
  async function onlineEdge(){
    const rows=await api('/api/v1/edge/installations');
    const online=(Array.isArray(rows)?rows:[]).filter((row)=>row?.agent?.state==='ACTIVE'&&row?.installation?.online===true);
    if(!online.length)throw new Error('El Edge del restaurante no está en línea.');
    return online[0];
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
  function esc(value){return String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
  async function currentStation(dialog){
    const name=String(dialog.querySelector('#rkdsName')?.value||'').trim().toLocaleLowerCase('es');
    if(!name)return null;
    const rows=await api('/api/v1/impresion/estaciones');
    return (Array.isArray(rows)?rows:[]).find((row)=>String(row.name||'').trim().toLocaleLowerCase('es')===name)||null;
  }
  function setStatus(section,message,error=false){
    const box=section.querySelector('[data-rkds-win-status]');
    if(box){box.textContent=message||'';box.style.color=error?'#a12d2d':'#176246'}
  }
  function syncVisibility(dialog,section){
    const mode=String(dialog.querySelector('#rkdsMode')?.value||'').toUpperCase();
    section.hidden=!['IMPRESORA','AMBOS'].includes(mode);
  }
  function printerOptions(select,printers,current=''){
    const selected=String(current||select.value||'');
    select.innerHTML='<option value="">Sin impresora USB</option>'+printers.map((p)=>'<option value="'+esc(p.name)+'">'+esc(p.name)+(p.default?' · Predeterminada':'')+'</option>').join('');
    if(selected&&!Array.from(select.options).some((o)=>o.value===selected))select.insertAdjacentHTML('beforeend','<option value="'+esc(selected)+'">'+esc(selected)+'</option>');
    select.value=selected;
  }
  async function detectPrinters(section){
    const button=section.querySelector('[data-rkds-win-detect]');
    if(button)button.disabled=true;
    setStatus(section,'Buscando impresoras instaladas en Windows…');
    try{
      const result=await relay('WINDOWS_PRINTERS');
      const printers=Array.isArray(result?.printers)?result.printers:[];
      printerOptions(section.querySelector('[data-rkds-win-select]'),printers);
      setStatus(section,printers.length?printers.length+' impresora(s) detectada(s).':'Windows no reportó impresoras instaladas.',!printers.length);
    }catch(error){setStatus(section,error.message,true)}
    finally{if(button)button.disabled=false}
  }
  async function testPrinter(section){
    const name=section.querySelector('[data-rkds-win-select]')?.value||'';
    if(!name){setStatus(section,'Selecciona una impresora primero.',true);return}
    const button=section.querySelector('[data-rkds-win-test]');
    if(button)button.disabled=true;
    setStatus(section,'Enviando impresión de prueba…');
    try{await relay('WINDOWS_TEST',{printerName:name});setStatus(section,'Prueba enviada correctamente. Revisa el papel.')}
    catch(error){setStatus(section,error.message,true)}
    finally{if(button)button.disabled=false}
  }
  async function enhanceEditor(){
    const dialog=document.querySelector('#restaurantKdsStationEditor');
    if(!dialog||dialog.querySelector('[data-rkds-windows-printer]'))return;
    const grid=dialog.querySelector('.rkds-grid');
    if(!grid)return;
    const section=document.createElement('div');
    section.dataset.rkdsWindowsPrinter='true';
    section.style.cssText='display:grid;gap:10px;padding:13px;border:1px solid #d8e2dd;border-radius:12px;background:#f8fbf9';
    section.innerHTML='<div><b>Impresora USB / Windows</b><div style="font-size:11px;color:#68766f;margin-top:3px">El Edge detecta las impresoras instaladas en el computador del restaurante.</div></div><div style="display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px"><select data-rkds-win-select style="min-height:42px;border:1px solid #cfd8d4;border-radius:10px;padding:0 10px"><option value="">Sin impresora USB</option></select><button type="button" class="rkds-admin-btn" data-rkds-win-detect>Detectar impresoras</button><button type="button" class="rkds-admin-btn" data-rkds-win-test>Probar impresión</button></div><label style="display:grid;gap:6px;font-size:12px;font-weight:850">Formato<select data-rkds-win-format style="min-height:42px;border:1px solid #cfd8d4;border-radius:10px;padding:0 10px"><option value="TERMICA_80">Térmica 80 mm</option><option value="TERMICA_58">Térmica 58 mm</option></select></label><div data-rkds-win-status style="font-size:11px;font-weight:750"></div>';
    grid.after(section);
    dialog.querySelector('#rkdsMode')?.addEventListener('change',()=>syncVisibility(dialog,section));
    section.querySelector('[data-rkds-win-detect]')?.addEventListener('click',()=>detectPrinters(section));
    section.querySelector('[data-rkds-win-test]')?.addEventListener('click',()=>testPrinter(section));
    syncVisibility(dialog,section);
    try{
      const station=await currentStation(dialog);
      const printer=(station?.printers||[]).find((row)=>String(row.transport||'').toUpperCase()==='WINDOWS'&&row.active!==false)||null;
      if(printer){
        section.dataset.printerId=printer.id||'';
        printerOptions(section.querySelector('[data-rkds-win-select]'),[],printer.host||'');
        section.querySelector('[data-rkds-win-format]').value=printer.format||'TERMICA_80';
        setStatus(section,'Configurada: '+String(printer.host||printer.name||''));
      }
    }catch{}
  }
  async function persistPrinter(station,config){
    if(!station?.printerRole)return;
    const printerName=String(config?.printerName||'').trim();
    const existingId=String(config?.existingId||'').trim();
    if(!printerName){
      if(existingId&&['IMPRESORA','AMBOS'].includes(String(station.mode||'').toUpperCase())){
        await api('/api/v1/impresion/impresoras',{method:'POST',body:JSON.stringify({id:existingId,name:'USB · '+station.name,transport:'WINDOWS',role:station.printerRole,host:config.previousName||'Impresora Windows',port:null,format:config.format||'TERMICA_80',active:false})});
      }
      return;
    }
    await api('/api/v1/impresion/impresoras',{method:'POST',body:JSON.stringify({...(existingId?{id:existingId}:{}),name:'USB · '+station.name,transport:'WINDOWS',role:station.printerRole,host:printerName,port:null,format:config.format||'TERMICA_80',active:true})});
  }
  window.fetch=async function(input,options={}){
    const url=new URL(typeof input==='string'?input:(input?.url||''),location.origin);
    const method=String(options?.method||'GET').toUpperCase();
    const stationWrite=/^\/api\/v1\/impresion\/estaciones(?:\/[^/]+)?$/.test(url.pathname)&&['POST','PATCH'].includes(method);
    const config=stationWrite?pendingPrinter:null;
    const response=await baseFetch(input,options);
    if(stationWrite&&response.ok&&config){
      try{
        const body=await response.clone().json();
        await persistPrinter(body?.data,config);
      }catch(error){setTimeout(()=>alert('La estación se guardó, pero la impresora USB no pudo guardarse: '+error.message),0)}
      finally{pendingPrinter=null}
    }
    return response;
  };
  document.addEventListener('submit',(event)=>{
    const form=event.target?.closest?.('[data-rkds-form]');
    const dialog=form?.closest?.('#restaurantKdsStationEditor');
    const section=dialog?.querySelector?.('[data-rkds-windows-printer]');
    if(!section)return;
    pendingPrinter={
      printerName:section.querySelector('[data-rkds-win-select]')?.value||'',
      previousName:section.querySelector('[data-rkds-win-select]')?.value||'',
      existingId:section.dataset.printerId||'',
      format:section.querySelector('[data-rkds-win-format]')?.value||'TERMICA_80'
    };
  },true);
  document.addEventListener('click',(event)=>{
    if(event.target?.closest?.('[data-rkds-new],[data-rkds-edit],[data-rkds-create-first]'))setTimeout(enhanceEditor,0);
  },true);
  setTimeout(enhanceEditor,0);
})();`;

function installKdsWindowsPrinterRuntime(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/app/restaurant-kds-stations-admin.js') return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source && !source.includes(MARKER)) {
      const patched = `${source}\n/* ${MARKER} */\n${runtime}\n`;
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
      res.set('X-VantixGC-KDS-Windows-Printer', 'v1-usb-windows');
    }
    return originalSend(body);
  };
  return next();
}

module.exports = { MARKER, runtime, installKdsWindowsPrinterRuntime };
