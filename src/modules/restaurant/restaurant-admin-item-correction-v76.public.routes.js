'use strict';

const MARKER = 'VANTIX_RESTAURANT_ADMIN_ITEM_CORRECTION_V76';

const runtime = String.raw`
;(()=>{
  'use strict';
  const MARKER='VANTIX_RESTAURANT_ADMIN_ITEM_CORRECTION_V76';
  if(window[MARKER])return;
  window[MARKER]=Object.freeze({version:'76.0.0',adminOnly:true,audited:true,fiscalLock:true});
  const SESSION_KEY='vantixgc_core_session_v1';
  const stateOrder={POR_ENVIAR:0,PENDIENTE:1,EN_PREPARACION:2,LISTO:3,ENTREGADO:4,CANCELADO:5};
  let adminAllowed=false;
  let currentDetail=null;
  let decorateTimer=null;
  let busy=false;
  const esc=(v)=>String(v??'').replace(/[&<>"']/g,(m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  function session(){try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{return null}}
  function authHeaders(json=false){const s=session();if(!s?.token||!s?.subdomain)return null;return {Authorization:'Bearer '+s.token,'x-tenant-subdomain':s.subdomain,...(json?{'Content-Type':'application/json'}:{})}}
  async function api(path,options={}){const headers=authHeaders(Boolean(options.body));if(!headers)throw new Error('Sesión no disponible');const response=await fetch(path,{...options,cache:'no-store',headers:{...headers,...(options.headers||{})}});let body={};try{body=await response.json()}catch{}if(!response.ok)throw new Error(body?.error?.message||body?.message||('HTTP '+response.status));return body.data}
  function schedule(){if(decorateTimer)clearTimeout(decorateTimer);decorateTimer=setTimeout(()=>{decorateTimer=null;decorate()},40)}
  function flattened(items){const map=new Map();for(const item of items||[]){if(!map.has(item.state))map.set(item.state,[]);map.get(item.state).push(item)}return [...map.entries()].sort((a,b)=>(stateOrder[a[0]]??99)-(stateOrder[b[0]]??99)).flatMap(([,rows])=>rows)}
  function ensureStyle(){if(document.getElementById('restaurantAdminCorrectionV76Style'))return;const style=document.createElement('style');style.id='restaurantAdminCorrectionV76Style';style.textContent='.v76-remove-item{display:block;margin-top:7px;padding:5px 8px;border:1px solid #efb3ad;border-radius:8px;background:#fff7f6;color:#b42318;font:800 10px/1.1 inherit;cursor:pointer;white-space:nowrap}.v76-remove-item:hover{background:#feeceb}.v76-history{border-color:#cbd5e1!important;background:#fff!important}.v76-audit-dialog{width:min(650px,calc(100vw - 24px));max-height:82vh;overflow:auto;border:0;border-radius:16px;padding:0;box-shadow:0 24px 70px rgba(16,35,63,.28)}.v76-audit-dialog::backdrop{background:rgba(15,23,42,.44)}.v76-audit-head{position:sticky;top:0;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px 18px;background:#fff;border-bottom:1px solid #e5e7eb}.v76-audit-head h3{margin:0;color:#10233f}.v76-audit-body{padding:16px 18px;background:#f8fafc}.v76-audit-row{padding:12px;border:1px solid #dce3ea;border-radius:11px;background:#fff;margin-bottom:9px}.v76-audit-row b{color:#17212b}.v76-audit-row small{display:block;margin-top:4px;color:#64748b}.v76-audit-empty{padding:20px;text-align:center;color:#64748b}';document.head.appendChild(style)}
  function detailResponseOrder(items){return flattened(items)}
  function decorate(){
    if(!adminAllowed||!currentDetail?.open||currentDetail?.sale?.estado!=='BORRADOR')return;
    const dialog=document.querySelector('#tableLiveDetailV67');
    if(!dialog||!dialog.open)return;
    ensureStyle();
    const rows=[...dialog.querySelectorAll('.table-live-v67-item')];
    const items=detailResponseOrder(currentDetail.items||[]);
    if(rows.length===items.length){rows.forEach((row,index)=>{const item=items[index];row.dataset.v76ItemId=item.id;const price=row.querySelector('.table-live-v67-price');if(!price||price.querySelector('[data-v76-remove]'))return;const button=document.createElement('button');button.type='button';button.className='v76-remove-item';button.dataset.v76Remove=item.id;button.textContent='Quitar producto';button.title='Solo Administración · requiere motivo y queda auditado';price.appendChild(button)})}
    const actions=dialog.querySelector('.table-live-v67-actions');
    if(actions&&currentDetail.sale?.id&&!actions.querySelector('[data-v76-history]')){const button=document.createElement('button');button.type='button';button.className='ri-btn v76-history';button.dataset.v76History=currentDetail.sale.id;button.textContent='Historial de correcciones';actions.appendChild(button)}
  }
  async function loadPermission(){try{const context=await api('/api/v1/restaurante/ui-context');const permissions=context?.permissions||[];adminAllowed=permissions.includes('*')||permissions.includes('RESTAURANTE.ADMINISTRAR');schedule()}catch{adminAllowed=false}}
  async function removeItem(button,itemId){
    if(busy||!adminAllowed)return;
    const item=(currentDetail?.items||[]).find((row)=>row.id===itemId);
    if(!item)return alert('El producto ya no está disponible en esta cuenta.');
    const reason=prompt('Motivo obligatorio para quitar “'+item.description+'” de la cuenta:');
    if(reason===null)return;
    const clean=String(reason).trim().replace(/\s+/g,' ');
    if(clean.length<5)return alert('El motivo debe tener al menos 5 caracteres.');
    if(clean.length>300)return alert('El motivo no puede superar 300 caracteres.');
    if(!confirm('Se quitará '+item.description+' de la cuenta. Esta acción quedará registrada con usuario, fecha, producto, valores y motivo. ¿Continuar?'))return;
    busy=true;button.disabled=true;const old=button.textContent;button.textContent='Quitando…';
    try{const result=await api('/api/v1/restaurante/admin-correcciones-v76/items/'+encodeURIComponent(itemId)+'/quitar',{method:'POST',body:JSON.stringify({reason:clean})});alert('Producto retirado. La corrección quedó registrada en el historial.'+(result?.accountWorkflowReset?' La cuenta volvió a estado abierto y debe enviarse nuevamente a Caja.':''));location.reload()}catch(error){button.disabled=false;button.textContent=old;alert(error.message)}finally{busy=false}
  }
  function auditDialog(){ensureStyle();let d=document.getElementById('restaurantAdminCorrectionAuditV76');if(!d){d=document.createElement('dialog');d.id='restaurantAdminCorrectionAuditV76';d.className='v76-audit-dialog';document.body.appendChild(d);d.addEventListener('click',(event)=>{if(event.target===d)d.close?.()})}return d}
  function renderHistory(data){const d=auditDialog();const rows=data?.rows||[];const sale=data?.sale||{};d.innerHTML='<div class="v76-audit-head"><div><div style="font-size:10px;font-weight:850;color:#64748b">AUDITORÍA</div><h3>Correcciones · '+esc(sale.numero||'Cuenta')+'</h3></div><button type="button" class="ri-btn" data-v76-history-close>Cerrar</button></div><div class="v76-audit-body">'+(rows.length?rows.map((row)=>{const meta=row.metadata||{};const item=meta?.before?.item||{};const when=row.creadoEn?new Date(row.creadoEn).toLocaleString('es-CO'):'';return '<div class="v76-audit-row"><b>'+esc(item.description||'Producto retirado')+' · '+esc(item.quantity||'')+'× · '+esc(item.lineTotal||'')+'</b><small>'+esc(when)+' · '+esc(row.user?.nombre||row.user?.email||'Administrador')+'</small><small><b>Motivo:</b> '+esc(meta.reason||'')+'</small></div>'}).join(''):'<div class="v76-audit-empty">Esta cuenta todavía no tiene correcciones administrativas.</div>')+'</div>';d.querySelector('[data-v76-history-close]')?.addEventListener('click',()=>d.close?.());if(typeof d.showModal==='function'){if(!d.open)d.showModal()}else d.setAttribute('open','')}
  async function showHistory(saleId){try{renderHistory(await api('/api/v1/restaurante/admin-correcciones-v76/ventas/'+encodeURIComponent(saleId)+'/historial?limit=100'))}catch(error){alert(error.message)}}
  const previousFetch=window.fetch.bind(window);
  window.fetch=async function(input,options){const response=await previousFetch(input,options);try{const url=typeof input==='string'?input:input?.url||'';if(response.ok&&/\/api\/v1\/restaurante\/mesas\/[^/]+\/detalle-v67(?:\?|$)/.test(url)){const clone=response.clone();clone.json().then((body)=>{if(body?.data){currentDetail=body.data;schedule()}}).catch(()=>{})}}catch{}return response};
  document.addEventListener('click',(event)=>{const remove=event.target?.closest?.('[data-v76-remove]');if(remove){event.preventDefault();event.stopPropagation();removeItem(remove,remove.dataset.v76Remove).catch(()=>{});return}const history=event.target?.closest?.('[data-v76-history]');if(history){event.preventDefault();event.stopPropagation();showHistory(history.dataset.v76History).catch(()=>{})}},true);
  const observer=new MutationObserver(()=>schedule());
  function start(){observer.observe(document.body,{childList:true,subtree:true});loadPermission().catch(()=>{})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
`;

function installRestaurantAdminItemCorrectionV76(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/app/restaurant-ui.js') return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source && source.includes('VANTIX_RESTAURANT_TABLE_LIVE_DETAIL_V67') && !source.includes(MARKER)) {
      const patched = `${source}\n;${runtime}\n`;
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
      res.set('X-VantixGC-Restaurant-Admin-Correction', 'v76-audited-admin-only');
    } else if (source) {
      res.set('X-VantixGC-Restaurant-Admin-Correction', source.includes(MARKER) ? 'v76-audited-admin-only' : 'v76-hook-missing');
    }
    return originalSend(body);
  };
  return next();
}

module.exports = { MARKER, runtime, installRestaurantAdminItemCorrectionV76 };
