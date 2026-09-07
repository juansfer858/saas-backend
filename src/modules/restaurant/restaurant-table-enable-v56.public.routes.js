'use strict';

const { staffEnableRuntimeV55 } = require('./restaurant-table-enable-v55.public.routes');

const MARKER = 'VANTIX_RESTAURANT_TABLE_ENABLE_V56';
const STAFF_MARKER = 'VANTIX_RESTAURANT_TABLE_ENABLE_STAFF_V55';

const qrRuntimeV56 = String.raw`
;(()=>{
  'use strict';
  const MARKER='${MARKER}';
  if(window[MARKER]) return;
  const qrToken=decodeURIComponent(location.pathname.split('/').filter(Boolean).pop()||'');
  if(!qrToken) return;
  const prefix='/api/public/restaurante/qr/'+encodeURIComponent(qrToken);
  const storageKey='vantixgc_restaurant_visit_'+qrToken;
  const previousFetch=window.fetch.bind(window);
  let flow=null;
  let cancelled=false;

  function target(input){return typeof input==='string'?input:(input&&typeof input.url==='string'?input.url:'');}
  function method(input,init){return String(init?.method||(typeof Request!=='undefined'&&input instanceof Request?input.method:'GET')).toUpperCase();}
  function isOrder(input,init){return method(input,init)==='POST'&&target(input).includes(prefix+'/pedidos');}
  const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));
  const stored=()=>String(localStorage.getItem(storageKey)||'').trim();

  async function api(path,options={}){
    const response=await previousFetch(path,{...options,cache:'no-store'});
    const body=await response.clone().json().catch(()=>({}));
    if(!response.ok) throw Object.assign(new Error(body?.error?.message||body?.message||('HTTP '+response.status)),{code:body?.error?.code||body?.code});
    return body?.data||{};
  }

  async function visit(){return api(prefix+'/visita');}
  async function requestEnable(){return api(prefix+'/habilitacion-mesa',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});}

  function ensureStyles(){
    if(document.getElementById('restaurantTableEnableV56Styles')) return;
    const style=document.createElement('style');
    style.id='restaurantTableEnableV56Styles';
    style.textContent='.rtv56-overlay{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:16px;background:rgba(18,20,19,.72);backdrop-filter:blur(7px)}.rtv56-card{width:min(560px,100%);padding:28px 22px;border-radius:24px;background:#fff;color:#172019;text-align:center;box-shadow:0 28px 80px rgba(0,0,0,.35)}.rtv56-kicker{font-size:13px;font-weight:900;letter-spacing:.12em;color:#6b756f}.rtv56-title{margin:8px 0 12px;font-size:clamp(34px,8vw,54px);line-height:.98;font-weight:1000}.rtv56-copy{margin:0 auto;max-width:430px;color:#59645e;font-size:17px;line-height:1.45}.rtv56-status{margin:20px 0 0;padding:14px;border-radius:15px;background:#edf7f1;color:#17603e;font-weight:900}.rtv56-dot{display:inline-block;width:10px;height:10px;margin-right:8px;border-radius:50%;background:currentColor;animation:rtv56pulse 1s infinite alternate}.rtv56-cancel{width:100%;min-height:50px;margin-top:15px;border:1px solid #ccd5d0;border-radius:13px;background:#fff;color:#46514b;font-weight:900}.rtv56-ok .rtv56-status{background:#e9f8ef;color:#116638}@keyframes rtv56pulse{to{opacity:.25;transform:scale(.75)}}';
    document.head.appendChild(style);
  }

  function showGate(table){
    ensureStyles();
    cancelled=false;
    document.getElementById('restaurantTableEnableV56Overlay')?.remove();
    const overlay=document.createElement('div');
    overlay.id='restaurantTableEnableV56Overlay';
    overlay.className='rtv56-overlay';
    const label=String(table?.name||table?.code||'MESA').toUpperCase();
    overlay.innerHTML='<section class="rtv56-card" role="dialog" aria-modal="true"><div class="rtv56-kicker">PEDIDO CONFIRMADO</div><h2 class="rtv56-title">HABILITAR '+label+'</h2><p class="rtv56-copy">Tu pedido ya está preparado. El mesero debe habilitar esta mesa una sola vez. En cuanto lo haga, el pedido se enviará automáticamente a Cocina/Barra.</p><div class="rtv56-status"><span class="rtv56-dot"></span><span id="restaurantTableEnableV56Status">Avisando al mesero…</span></div><button class="rtv56-cancel" type="button">VOLVER AL PEDIDO</button></section>';
    document.body.appendChild(overlay);
    overlay.querySelector('.rtv56-cancel')?.addEventListener('click',()=>{cancelled=true;overlay.remove();});
  }

  function gateStatus(text,ok=false){
    const overlay=document.getElementById('restaurantTableEnableV56Overlay');
    if(ok) overlay?.querySelector('.rtv56-card')?.classList.add('rtv56-ok');
    const node=document.getElementById('restaurantTableEnableV56Status');
    if(node) node.textContent=text;
  }

  async function waitUntilOpen(){
    const started=Date.now();
    while(Date.now()-started<10*60*1000){
      if(cancelled) throw Object.assign(new Error('Tu pedido sigue guardado. Puedes volver a enviarlo cuando quieras.'),{code:'RESTAURANT_TABLE_ENABLE_CANCELLED'});
      const state=await visit().catch(()=>null);
      if(state?.open) return state;
      await sleep(1200);
    }
    throw Object.assign(new Error('La mesa todavía no fue habilitada. Tu pedido sigue guardado.'),{code:'RESTAURANT_TABLE_ENABLE_TIMEOUT'});
  }

  async function ensureTableOpen(){
    const current=await visit().catch(()=>null);
    if(current?.open) return current;
    const request=await requestEnable();
    if(request?.state==='ENABLED') return visit();
    showGate(request?.table||{});
    gateStatus('Solicitud enviada · esperando habilitación…');
    const opened=await waitUntilOpen();
    gateStatus('Mesa habilitada · enviando tu pedido…',true);
    await sleep(300);
    document.getElementById('restaurantTableEnableV56Overlay')?.remove();
    return opened;
  }

  async function directAuthorize(){
    const state=await visit();
    if(state?.authorized&&stored()) return true;
    if(stored()) localStorage.removeItem(storageKey);
    const response=await previousFetch(prefix+'/autorizar-directo',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({seatNumber:Number(state?.seatNumber||1)})});
    const body=await response.clone().json().catch(()=>({}));
    if(!response.ok) throw Object.assign(new Error(body?.error?.message||body?.message||'No fue posible autorizar este teléfono'),{code:body?.error?.code});
    if(!body?.data?.visitToken) throw new Error('VantixGC no devolvió la autorización del teléfono');
    localStorage.setItem(storageKey,body.data.visitToken);
    return true;
  }

  async function prepareSend(){
    if(flow) return flow;
    flow=(async()=>{
      await ensureTableOpen();
      await directAuthorize();
      return true;
    })().finally(()=>{flow=null;});
    return flow;
  }

  window.fetch=async(input,init={})=>{
    if(isOrder(input,init)){
      try{await prepareSend();}
      catch(error){
        document.getElementById('restaurantTableEnableV56Overlay')?.remove();
        return new Response(JSON.stringify({ok:false,error:{code:error?.code||'RESTAURANT_TABLE_ENABLE_REQUIRED',message:error?.message||'La mesa debe ser habilitada antes de enviar el pedido'}}),{status:409,headers:{'Content-Type':'application/json'}});
      }
    }
    return previousFetch(input,init);
  };

  document.documentElement.dataset.tableEnableGate='v56-order-first';
  window[MARKER]=Object.freeze({version:'56.0.0',menuWhileClosed:true,cartWhileClosed:true,requestOnlyOnConfirm:true,staffApprovalOnce:true,autoSendAfterApproval:true,pinRequired:false});
})();
`;

function patchQrSource(source) {
  if (!source || source.includes(MARKER)) return source;
  let patched = source;
  patched = patched.replace(
    "if (!wrap || !nav || !S.ctx?.open) return;",
    "if (!wrap || !nav || !S.ctx) return;"
  );
  patched = patched.replace(
    "if (!bar || !S.ctx?.open) {",
    "if (!bar || !S.ctx) {"
  );
  patched = patched.replace(
    "if (!S.ctx.open) {\n      app.innerHTML = `<section class=\"qrv3-closed\">\n        <div class=\"qrv3-closed-icon\" aria-hidden=\"true\">🪑</div>\n        <h2>${esc(S.ctx.table.name)}</h2>\n        <p>Esta mesa todavía no está abierta. Pídele al mesero que la abra y luego vuelve a intentar. No necesitas cambiar de QR.</p>\n      </section>`;\n      return;\n    }",
    "// V56: la carta y el carrito se pueden usar aunque la mesa todavía esté libre."
  );
  patched = patched.replace(
    "strip.innerHTML = '<b>Mesa pendiente de apertura</b><span>CERRADA</span>';",
    "strip.innerHTML = '<b>Puedes preparar tu pedido</b><span>LA MESA SE HABILITA AL ENVIAR</span>';"
  );
  return `${patched}\n;${qrRuntimeV56}\n`;
}

function installRestaurantTableEnableV56(req, res, next) {
  if (req.method !== 'GET' || !['/app/restaurant-qr-ui.js', '/app/restaurant-ui.js', '/app/restaurant-waiter-runtime-v7.js'].includes(req.path)) return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    let patched = source;
    if (source) {
      if (req.path === '/app/restaurant-qr-ui.js') patched = patchQrSource(source);
      else if (!source.includes(STAFF_MARKER)) patched = `${source}\n;${staffEnableRuntimeV55}\n`;
    }
    if (patched && patched !== source) body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
    res.set('X-VantixGC-Table-Enable', 'v56-order-first');
    return originalSend(body);
  };
  return next();
}

module.exports = { MARKER, qrRuntimeV56, patchQrSource, installRestaurantTableEnableV56 };
