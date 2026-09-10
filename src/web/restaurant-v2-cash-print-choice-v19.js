/* VANTIX_RESTAURANT_V2_CASH_PRINT_CHOICE_V19 */
(()=>{'use strict';
const MARKER='VANTIX_RESTAURANT_V2_CASH_PRINT_CHOICE_V19';
if(window[MARKER])return;
window[MARKER]=Object.freeze({version:'19.0.0',postSettlement:true,yesNo:true,defaultNoPrint:true,paymentFirst:true});
if(location.pathname!=='/app/restaurante-v2/caja')return;
const RV2=window.RestaurantV2;if(!RV2)return;

let pending=null;
let rendering=false;
const $=(q,root=document)=>root.querySelector(q);

function ensureStyle(){
  if($('#restaurantCashPrintChoiceV19Style'))return;
  const style=document.createElement('style');
  style.id='restaurantCashPrintChoiceV19Style';
  style.textContent=`
    .v19-print-choice{margin:16px 0 4px;padding:15px;border:1px solid #dbe3eb;border-radius:14px;background:#f8fafc;text-align:left}
    .v19-print-choice>small{display:block;color:#64748b;font-size:10px;font-weight:850;letter-spacing:.05em;text-transform:uppercase}
    .v19-print-choice>strong{display:block;margin-top:5px;color:#111827;font-size:18px}.v19-print-choice>p{margin:5px 0 0;color:#64748b;font-size:12px}
    .v19-print-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:13px}.v19-print-actions .rv2-btn{min-height:45px}
    .v19-print-status{margin-top:10px!important;color:#334155!important;font-weight:750}.v19-print-status.error{color:#b42318!important}
    @media(max-width:520px){.v19-print-actions{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

function cleanResultText(){
  const text=$('#resultText');if(!text)return;
  text.textContent=String(text.textContent||'')
    .replace('Tirilla POS enviada a la cola de impresión.','Venta liquidada correctamente.')
    .replace('La venta quedó registrada; la cola de impresión no confirmó el encolado.','Venta liquidada correctamente.');
}

function finishWithoutPrint(){
  pending=null;
  $('#v19PrintChoice')?.remove();
  const close=$('#resultClose');if(close)close.hidden=false;
  $('#resultDialog')?.close();
}

async function requestPrint(){
  if(!pending?.sessionId||pending.busy)return;
  pending.busy=true;
  const root=$('#v19PrintChoice');
  const yes=$('[data-v19-print-yes]',root);const no=$('[data-v19-print-no]',root);const status=$('[data-v19-print-status]',root);
  if(yes)yes.disabled=true;if(no)no.disabled=true;
  if(status){status.textContent='Enviando recibo a impresión…';status.classList.remove('error')}
  try{
    const data=await RV2.api('/api/v1/restaurante/v2/caja/recibo/imprimir',{method:'POST',body:JSON.stringify({sessionId:pending.sessionId})});
    if(!data?.receiptRequested)throw new Error('La cola de impresión no confirmó el recibo');
    if(status)status.textContent='Recibo enviado a la cola de impresión.';
    const close=$('#resultClose');if(close){close.hidden=false;close.textContent='VOLVER A CAJA'}
    if(yes)yes.hidden=true;if(no)no.hidden=true;
    pending.printed=true;
  }catch(error){
    pending.busy=false;
    if(status){status.textContent=`La venta está liquidada, pero no se pudo enviar el recibo: ${error.message||'error de impresión'}.`;status.classList.add('error')}
    if(yes){yes.disabled=false;yes.textContent='REINTENTAR IMPRESIÓN'}
    if(no){no.disabled=false;no.textContent='NO IMPRIMIR'}
  }
}

function renderChoice(){
  if(rendering||!pending?.sessionId)return;
  const dialog=$('#resultDialog');if(!dialog?.open)return;
  if($('#v19PrintChoice'))return;
  rendering=true;
  try{
    ensureStyle();
    cleanResultText();
    const close=$('#resultClose');if(close)close.hidden=true;
    const root=document.createElement('section');
    root.id='v19PrintChoice';
    root.className='v19-print-choice';
    root.innerHTML='<small>VENTA LIQUIDADA</small><strong>¿Imprimir recibo?</strong><p>La venta ya quedó registrada. Esta decisión sólo controla la tirilla POS.</p><div class="v19-print-actions"><button type="button" class="rv2-btn rv2-btn-primary" data-v19-print-yes>SÍ, IMPRIMIR</button><button type="button" class="rv2-btn" data-v19-print-no>NO</button></div><p class="v19-print-status" data-v19-print-status></p>';
    close?.insertAdjacentElement('beforebegin',root);
    $('[data-v19-print-yes]',root).onclick=requestPrint;
    $('[data-v19-print-no]',root).onclick=finishWithoutPrint;
  }finally{rendering=false}
}

const previousFetch=window.fetch.bind(window);
window.fetch=async function(input,init={}){
  const url=typeof input==='string'?input:String(input?.url||'');
  const method=String(init?.method||input?.method||'GET').toUpperCase();
  const isCharge=method==='POST'&&/^\/api\/v1\/restaurante\/v2\/caja\/mesas\/[^/]+\/cobrar(?:\?|$)/.test(url);
  const response=await previousFetch(input,init);
  if(isCharge&&response.ok){
    response.clone().json().then(body=>{
      const data=body?.data;
      const sessionId=data?.result?.session?.id;
      if(data?.charged&&data?.receiptDecisionRequired&&sessionId){
        pending={sessionId:String(sessionId),saleNumber:data?.result?.sale?.numero||null,busy:false,printed:false};
        setTimeout(renderChoice,0);
      }
    }).catch(()=>{});
  }
  return response;
};

const observer=new MutationObserver(()=>renderChoice());
observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
$('#resultDialog')?.addEventListener('close',()=>{
  $('#v19PrintChoice')?.remove();
  const close=$('#resultClose');if(close){close.hidden=false;close.textContent='VOLVER A CAJA'}
  pending=null;
});
})();
