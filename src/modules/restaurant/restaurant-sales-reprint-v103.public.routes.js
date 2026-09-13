'use strict';

const express = require('express');

const MARKER = 'VANTIX_RESTAURANT_SALES_REPRINT_V103';
const VERSION = '103.0.0';

const runtime = String.raw`
;(()=>{
  'use strict';
  const MARKER='VANTIX_RESTAURANT_SALES_REPRINT_V103';
  if(window[MARKER])return;
  window[MARKER]=true;
  const SESSION_KEY='vantixgc_core_session_v1';
  let currentSaleId=null;
  let generation=0;

  function session(){try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{return null}}
  async function request(path,options={}){
    const s=session();
    if(!s?.token||!s?.subdomain)throw new Error('Sesión no disponible');
    const response=await fetch(path,{
      ...options,
      headers:{
        Authorization:'Bearer '+s.token,
        'x-tenant-subdomain':s.subdomain,
        'Content-Type':'application/json',
        ...(options.headers||{})
      }
    });
    let body={};
    try{body=await response.json()}catch{}
    if(!response.ok)throw new Error(body?.error?.message||body?.message||('HTTP '+response.status));
    return body;
  }

  function statusNode(actions){
    let node=actions.querySelector('[data-vantix-reprint-status]');
    if(node)return node;
    node=document.createElement('span');
    node.dataset.vantixReprintStatus='1';
    node.className='muted';
    node.style.fontSize='12px';
    node.style.alignSelf='center';
    actions.prepend(node);
    return node;
  }

  async function reprint(saleId,button,actions){
    const status=statusNode(actions);
    const original=button.textContent;
    button.disabled=true;
    button.textContent='ENVIANDO...';
    status.textContent='';
    try{
      const result=await request('/api/v1/restaurante/ventas/'+encodeURIComponent(saleId)+'/reimprimir-tirilla',{
        method:'POST',body:'{}'
      });
      const signaled=result?.data?.edgeSignal?.requested===true;
      button.textContent=signaled?'REIMPRESIÓN ENVIADA ✓':'REIMPRESIÓN ENCOLADA ✓';
      status.textContent=signaled?'Edge recibió la orden de sincronización.':'Edge está fuera de línea; la orden quedó en cola.';
      setTimeout(()=>{if(button.isConnected){button.disabled=false;button.textContent=original}},2600);
    }catch(error){
      button.disabled=false;
      button.textContent=original;
      status.textContent=error?.message||'No se pudo reimprimir.';
    }
  }

  async function injectButton(expectedSaleId=currentSaleId,expectedGeneration=generation){
    if(!expectedSaleId)return;
    const actions=document.querySelector('#modalRoot .receipt-view .actions');
    if(!actions)return;
    if(actions.dataset.vantixReprintSale===expectedSaleId)return;
    actions.dataset.vantixReprintSale=expectedSaleId;

    try{
      const result=await request('/api/v1/restaurante/ventas/'+encodeURIComponent(expectedSaleId)+'/reimpresion-tirilla',{cache:'no-store'});
      if(expectedGeneration!==generation||expectedSaleId!==currentSaleId||!actions.isConnected)return;
      if(result?.data?.eligible!==true)return;

      const button=document.createElement('button');
      button.type='button';
      button.className='btn primary';
      button.dataset.vantixSalesReprint='1';
      button.textContent='REIMPRIMIR TIRILLA';
      button.addEventListener('click',()=>reprint(expectedSaleId,button,actions));
      actions.prepend(button);
    }catch(_){
      // Usuarios sin permiso de Caja o documentos no elegibles no ven el botón.
    }
  }

  document.addEventListener('click',(event)=>{
    const trigger=event.target?.closest?.('[data-view]');
    if(!trigger?.dataset?.view)return;
    currentSaleId=trigger.dataset.view;
    generation+=1;
    const expectedGeneration=generation;
    setTimeout(()=>injectButton(currentSaleId,expectedGeneration),0);
  },true);

  const observer=new MutationObserver(()=>injectButton());
  observer.observe(document.documentElement,{childList:true,subtree:true});
  window.VantixGCRestaurantSalesReprintV103=Object.freeze({version:'103.0.0',printOnly:true,edgeAction:'PRINT_QUEUE'});
})();
`;

const router = express.Router();

router.get('/app/restaurant-sales-reprint-v103.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('application/javascript').send(runtime);
});

function installRestaurantSalesReprintV103(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/app/ventas') return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source && !source.includes(MARKER)) {
      const tag = `<script src="/app/restaurant-sales-reprint-v103.js?v=${VERSION}" data-marker="${MARKER}"></script>`;
      const patched = source.includes('</body>') ? source.replace('</body>', `${tag}</body>`) : `${source}${tag}`;
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
    }
    res.set('X-VantixGC-Sales-Reprint', 'v103-print-only');
    return originalSend(body);
  };
  return next();
}

module.exports = {
  MARKER,
  VERSION,
  runtime,
  restaurantSalesReprintV103PublicRouter: router,
  installRestaurantSalesReprintV103
};
