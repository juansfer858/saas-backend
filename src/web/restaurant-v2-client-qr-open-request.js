/* VANTIX_RESTAURANT_V2_QR_NO_CODE_V11 */
(()=>{'use strict';
  const token=decodeURIComponent(location.pathname.split('/').filter(Boolean).pop()||'');
  if(!token)return;
  const prefix=`/api/public/restaurante/qr/${encodeURIComponent(token)}`;
  const visitKey=`vantixgc_restaurant_visit_v2:${token}`;
  const pendingKey=`vantixgc_restaurant_pending_order_v11:${token}`;
  const pendingMaxAgeMs=30*60*1000;
  let submitting=false;
  let stream=null;

  async function api(path,options={},visitToken=''){
    const response=await fetch(path,{...options,cache:'no-store',headers:{Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(visitToken?{'x-vantix-restaurant-visit':visitToken}:{}),...(options.headers||{})}});
    let body={};try{body=await response.json()}catch{}
    if(!response.ok){const error=new Error(body?.error?.message||body?.message||`HTTP ${response.status}`);error.status=response.status;error.code=body?.error?.code||body?.code||null;error.details=body?.error?.details||null;throw error}
    return body?.data;
  }
  function esc(value){return String(value??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#039;'}[m]))}
  function toast(text){const node=document.getElementById('toast');if(!node)return;node.textContent=text;node.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>{node.hidden=true},3200)}
  function roundMoney(value){return Math.round((Number(value||0)+Number.EPSILON)*100)/100}
  function savedVisit(){return String(localStorage.getItem(visitKey)||'')}
  function storeVisit(value){if(value)localStorage.setItem(visitKey,String(value));else localStorage.removeItem(visitKey)}
  function readPending(){try{const value=JSON.parse(localStorage.getItem(pendingKey)||'null');if(!value?.payload||Date.now()-Number(value.createdAt||0)>pendingMaxAgeMs){localStorage.removeItem(pendingKey);return null}return value}catch{localStorage.removeItem(pendingKey);return null}}
  function savePending(payload){const value={createdAt:Date.now(),payload};localStorage.setItem(pendingKey,JSON.stringify(value));return value}
  function clearPending(){localStorage.removeItem(pendingKey)}

  function sanitizeCopy(){
    const availability=document.getElementById('availabilityText');
    if(availability&&/c[oó]digo/i.test(availability.textContent||''))availability.textContent='Arma tu pedido. Si la mesa está libre, avisaremos al restaurante para que la abra antes de enviarlo.';
    const body=document.getElementById('sheetBody');
    if(!body)return;
    body.querySelectorAll('.p7-message').forEach(node=>{if(/c[oó]digo|4 d[ií]gitos/i.test(node.textContent||''))node.innerHTML='Al confirmar, el pedido se envía directamente. Si la mesa está libre, primero solicitaremos su apertura al restaurante.'});
    body.querySelectorAll('.p7-help article').forEach(article=>{if(/autoriza|c[oó]digo|4 d[ií]gitos/i.test(article.textContent||'')){const index=[...article.parentNode.children].indexOf(article);if(index===1)article.innerHTML='<b>2. Confirma el pedido</b><span>Si la mesa está libre, avisaremos al restaurante. Cuando el personal la abra, el pedido continúa sin claves ni códigos.</span>'}});
  }
  [0,180,650,1400].forEach(delay=>setTimeout(sanitizeCopy,delay));
  document.addEventListener('click',event=>{if(event.target.closest?.('#cartButton,#helpButton'))queueMicrotask(sanitizeCopy)},false);

  async function payloadFromSheet(){
    const context=await api(prefix);
    const menu=new Map((Array.isArray(context?.menu)?context.menu:[]).map(row=>[row.id,row]));
    const rows=[];
    document.querySelectorAll('#sheetBody .p7-line').forEach(line=>{
      const control=line.querySelector('[data-sheet-plus]');
      if(!control)return;
      const menuItemId=String(control.dataset.sheetPlus||'');
      const quantity=Math.max(0,Number(line.querySelector('.p7-line-controls b')?.textContent||0));
      if(!menuItemId||!quantity)return;
      const notes=String(line.querySelector('textarea[data-note]')?.value||'').slice(0,300);
      rows.push({menuItemId,quantity,...(notes?{notes}:{})});
    });
    if(!rows.length)throw new Error('El pedido no tiene productos para enviar.');
    let total=0;
    for(const item of rows){
      const row=menu.get(item.menuItemId);if(!row?.product)throw new Error('Uno de los productos ya no está disponible.');
      const subtotal=Number(row.product.price||0)*item.quantity;
      total+=roundMoney(subtotal+(subtotal*Number(row.product.ivaPct||0)/100)+(subtotal*Number(row.product.impoconsumoPct||0)/100));
    }
    return {items:rows,confirmedTotal:roundMoney(total),externalRequestId:crypto.randomUUID()};
  }

  function showWaiting(request){
    const title=document.getElementById('sheetTitle');
    const kicker=document.getElementById('sheetKicker');
    const body=document.getElementById('sheetBody');
    if(title)title.textContent='Esperando apertura de mesa';
    if(kicker)kicker.textContent='SOLICITUD ENVIADA';
    if(body)body.innerHTML=`<div class="p7-message"><b>Ya avisamos al restaurante.</b><br>La ${esc(request?.table?.name||'mesa')} está esperando que el personal la abra. Tu pedido ya quedó confirmado y guardado.</div><div class="p7-message" style="margin-top:10px">No necesitas claves ni códigos. Cuando abran la mesa, este pedido continuará automáticamente.</div><button id="p7OpenRequestClose" class="p7-secondary" type="button" style="margin-top:12px">SEGUIR VIENDO LA CARTA</button>`;
    document.getElementById('p7OpenRequestClose')?.addEventListener('click',()=>document.getElementById('sheetClose')?.click());
    toast('Solicitud de apertura enviada al restaurante.');
  }
  function showLocalFallback(visit){
    const body=document.getElementById('sheetBody');
    if(!body)return;
    body.innerHTML=`<div class="p7-message warn">Esta sede necesita el acceso local para recibir el pedido en este momento.</div>${visit?.localFallbackUrl?`<a class="p7-primary" style="display:grid;place-items:center;text-decoration:none;margin-top:10px" href="${esc(visit.localFallbackUrl)}">ABRIR ACCESO LOCAL</a>`:''}`;
  }
  function stopStream(){try{stream?.close()}catch{}stream=null}

  async function startNoCodeVisit(){
    const current=savedVisit();
    const data=await api(`${prefix}/iniciar-visita`,{method:'POST',body:JSON.stringify({seatNumber:1})},current);
    storeVisit(data.visitToken);
    return data.visitToken;
  }
  async function deliverPending(){
    if(submitting)return;
    const pending=readPending();if(!pending)return;
    submitting=true;
    try{
      const visit=await api(`${prefix}/visita`,{},savedVisit());
      if(visit?.localModeRequired){showLocalFallback(visit);return}
      if(!visit?.open){const request=await api(`${prefix}/solicitar-apertura`,{method:'POST',body:'{}'});showWaiting(request);watchOpening();return}
      const visitToken=await startNoCodeVisit();
      await api(`${prefix}/pedidos`,{method:'POST',body:JSON.stringify(pending.payload)},visitToken);
      clearPending();
      stopStream();
      sessionStorage.setItem(`vantixgc_restaurant_order_sent_v11:${token}`,'1');
      toast('Pedido enviado. Ya está en la operación del restaurante.');
      setTimeout(()=>location.reload(),450);
    }catch(error){
      toast(error.message||'No fue posible enviar el pedido.');
      throw error;
    }finally{submitting=false}
  }
  function watchOpening(){
    stopStream();
    if(!window.EventSource)return;
    stream=new EventSource(`${prefix}/visita/realtime`);
    const handle=event=>{let data={};try{data=JSON.parse(event.data||'{}')}catch{}if(data?.open){stopStream();deliverPending().catch(()=>{})}};
    stream.addEventListener('availability',handle);
    stream.addEventListener('ready',handle);
  }

  document.addEventListener('click',async event=>{
    const button=event.target.closest?.('#submitOrder');
    if(!button)return;
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    if(submitting)return;
    const original=button.textContent;
    button.disabled=true;button.textContent='CONFIRMANDO PEDIDO…';
    try{
      const payload=await payloadFromSheet();
      savePending(payload);
      const visit=await api(`${prefix}/visita`,{},savedVisit());
      if(visit?.localModeRequired){showLocalFallback(visit);return}
      if(!visit?.open){const request=await api(`${prefix}/solicitar-apertura`,{method:'POST',body:'{}'});showWaiting(request);watchOpening();return}
      await deliverPending();
    }catch(error){toast(error.message||'No fue posible procesar el pedido.');button.disabled=false;button.textContent=original}
  },true);

  async function resumePending(){
    const pending=readPending();if(!pending)return;
    try{
      const visit=await api(`${prefix}/visita`,{},savedVisit());
      if(visit?.open){await deliverPending();return}
      if(!visit?.localModeRequired){const request=await api(`${prefix}/solicitar-apertura`,{method:'POST',body:'{}'});const availability=document.getElementById('availabilityCard');if(availability){document.getElementById('availabilityTitle').textContent='Pedido esperando apertura';document.getElementById('availabilityText').textContent='Ya avisamos al restaurante. Cuando abran la mesa, tu pedido se enviará automáticamente.'}toast(`Esperando apertura de ${request?.table?.name||'la mesa'}.`);watchOpening()}
    }catch{}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>resumePending(),350),{once:true});else setTimeout(()=>resumePending(),350);
  if(sessionStorage.getItem(`vantixgc_restaurant_order_sent_v11:${token}`)==='1'){sessionStorage.removeItem(`vantixgc_restaurant_order_sent_v11:${token}`);setTimeout(()=>document.getElementById('trackingButton')?.click(),700)}

  window.addEventListener('pagehide',stopStream);
  window.VantixGCRestaurantQrNoCode=Object.freeze({marker:'VANTIX_RESTAURANT_V2_QR_NO_CODE_V11',eventDriven:true,opensTableAutomatically:false,visibleAccessCode:false,staffOpeningOnly:true,automaticSendAfterOpening:true});
})();
