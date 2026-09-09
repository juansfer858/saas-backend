/* VANTIX_RESTAURANT_V2_CLIENT_QR_OPEN_REQUEST_P10_FIX */
(()=>{'use strict';
  const token=decodeURIComponent(location.pathname.split('/').filter(Boolean).pop()||'');
  if(!token)return;
  const prefix=`/api/public/restaurante/qr/${encodeURIComponent(token)}`;
  let bypass=false;
  let submitting=false;
  let stream=null;

  async function api(path,options={}){
    const response=await fetch(path,{...options,cache:'no-store',headers:{Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
    let body={};try{body=await response.json()}catch{}
    if(!response.ok)throw new Error(body?.error?.message||body?.message||`HTTP ${response.status}`);
    return body?.data;
  }
  function esc(value){return String(value??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
  function toast(text){const node=document.getElementById('toast');if(!node)return;node.textContent=text;node.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>{node.hidden=true},3200)}
  function resumeNative(button){
    bypass=true;
    button.disabled=false;
    button.click();
    queueMicrotask(()=>{bypass=false});
  }
  function showWaiting(request){
    const title=document.getElementById('sheetTitle');
    const kicker=document.getElementById('sheetKicker');
    const body=document.getElementById('sheetBody');
    if(title)title.textContent='Esperando apertura de mesa';
    if(kicker)kicker.textContent='SOLICITUD ENVIADA';
    if(body)body.innerHTML=`<div class="p7-message"><b>Ya avisamos al restaurante.</b><br>La ${esc(request?.table?.name||'mesa')} está esperando que un mesero la abra. Tu pedido sigue guardado en este teléfono.</div><div class="p7-message" style="margin-top:10px">Cuando la mesa quede abierta volveremos a mostrar tu pedido. Después ingresarás el código de 4 dígitos para enviarlo.</div><button id="p7OpenRequestClose" class="p7-secondary" type="button" style="margin-top:12px">SEGUIR VIENDO LA CARTA</button>`;
    document.getElementById('p7OpenRequestClose')?.addEventListener('click',()=>document.getElementById('sheetClose')?.click());
    toast('Solicitud de apertura enviada al restaurante.');
  }
  function stopStream(){try{stream?.close()}catch{}stream=null}
  function tableOpened(){
    stopStream();
    toast('La mesa ya está abierta. Confirma tu pedido.');
    setTimeout(()=>{
      document.getElementById('sheetClose')?.click();
      setTimeout(()=>document.getElementById('cartButton')?.click(),60);
    },120);
  }
  function watchOpening(){
    stopStream();
    if(!window.EventSource)return;
    stream=new EventSource(`${prefix}/visita/realtime`);
    const handle=(event)=>{let data={};try{data=JSON.parse(event.data||'{}')}catch{}if(data?.open)tableOpened()};
    stream.addEventListener('availability',handle);
    stream.addEventListener('ready',handle);
  }

  document.addEventListener('click',async(event)=>{
    const button=event.target.closest?.('#submitOrder');
    if(!button||bypass)return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if(submitting)return;
    submitting=true;
    const original=button.textContent;
    button.disabled=true;
    button.textContent='VERIFICANDO MESA…';
    try{
      const visit=await api(`${prefix}/visita`);
      // Si la mesa ya abrió o Edge exige acceso local, el flujo P7 canónico conserva
      // la autoridad para autorización, envío y fallback local.
      if(visit?.open||visit?.localModeRequired){resumeNative(button);return}
      const request=await api(`${prefix}/solicitar-apertura`,{method:'POST',body:'{}'});
      if(request?.open){resumeNative(button);return}
      showWaiting(request);
      watchOpening();
    }catch(error){
      button.disabled=false;
      button.textContent=original;
      toast(error.message||'No fue posible solicitar la apertura de la mesa.');
    }finally{submitting=false}
  },true);

  window.addEventListener('pagehide',stopStream);
  window.VantixGCRestaurantQrOpenRequest=Object.freeze({marker:'VANTIX_RESTAURANT_V2_CLIENT_QR_OPEN_REQUEST_P10_FIX',eventDriven:true,opensTableAutomatically:false});
})();
