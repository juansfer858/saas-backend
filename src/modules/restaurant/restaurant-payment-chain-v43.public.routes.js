'use strict';

const MARKER = 'VANTIX_RESTAURANT_PAYMENT_CHAIN_V43';

const runtime = String.raw`
;(()=>{
  'use strict';
  const MARKER='VANTIX_RESTAURANT_PAYMENT_CHAIN_V43';
  if(window[MARKER]) return;
  window[MARKER]=Object.freeze({
    version:'43.0.0',
    cashOnlyToCashAccount:true,
    bankOnlyToBankAccount:true,
    creditRequiresCustomer:true,
    invalidCombinationBlocked:true,
    treasurySource:'MOVIMIENTO_TESORERIA'
  });

  const SESSION_KEY='vantixgc_core_session_v1';
  let session=null;
  try{session=JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{}
  if(!session?.token) return;

  let accounts=[];
  let loadPromise=null;
  let syncToken=0;

  const $=(q,r=document)=>r.querySelector(q);
  const $$=(q,r=document)=>[...r.querySelectorAll(q)];

  async function loadAccounts(force=false){
    if(loadPromise&&!force) return loadPromise;
    loadPromise=(async()=>{
      const response=await fetch('/api/v1/tesoreria/cajas-bancos',{
        cache:'no-store',
        headers:{Authorization:'Bearer '+session.token,'x-tenant-subdomain':session.subdomain}
      });
      let body={};
      try{body=await response.json()}catch{}
      if(!response.ok) throw new Error(body?.error?.message||body?.message||('HTTP '+response.status));
      accounts=Array.isArray(body.data)?body.data:[];
      return accounts;
    })().finally(()=>{loadPromise=null});
    return loadPromise;
  }

  function activeMethod(){
    return $$('[data-cash-method]').find((button)=>button.classList.contains('active'))?.dataset.cashMethod||'EFECTIVO';
  }

  function methodAccountType(method){
    if(method==='EFECTIVO') return 'CAJA';
    if(method==='BANCO') return 'BANCO';
    return null;
  }

  function setConfirmState(message=''){
    const confirm=$('#closeTable');
    if(!confirm) return;
    const totalText=String(confirm.textContent||'').replace(/^.*?Confirmar cobro/i,'').trim();
    if(message){
      confirm.disabled=true;
      confirm.dataset.paymentChainBlocked='true';
      confirm.title=message;
    }else{
      confirm.disabled=false;
      delete confirm.dataset.paymentChainBlocked;
      confirm.removeAttribute('title');
    }
    if(totalText&&!String(confirm.textContent||'').includes('Confirmar cobro')) confirm.textContent='Confirmar cobro '+totalText;
  }

  function markCreditUnavailable(){
    const credit=$('[data-cash-method="CREDITO"]');
    if(!credit) return;
    credit.disabled=true;
    credit.title='El crédito requiere seleccionar un cliente y generar cartera. No usa Caja/Banco.';
    credit.dataset.creditRequiresCustomer='true';
    const small=credit.querySelector('small');
    if(small) small.textContent='Requiere cliente';
    else credit.insertAdjacentHTML?.('beforeend','<small>Requiere cliente</small>');
  }

  async function synchronize({forceAccounts=false}={}){
    const token=++syncToken;
    const select=$('#paymentAccount');
    const label=$('#accountLabel');
    const received=$('#cashReceivedRow');
    const confirm=$('#closeTable');
    const buttons=$$('[data-cash-method]');
    if(!select||!label||!confirm||!buttons.length) return;

    markCreditUnavailable();
    let method=activeMethod();
    if(method==='CREDITO'){
      const cash=buttons.find((button)=>button.dataset.cashMethod==='EFECTIVO'&&!button.disabled);
      if(cash){buttons.forEach((button)=>button.classList.toggle('active',button===cash));method='EFECTIVO'}
    }

    try{await loadAccounts(forceAccounts)}catch(error){
      if(token!==syncToken) return;
      select.innerHTML='';
      setConfirmState('No fue posible cargar las cuentas de Tesorería: '+error.message);
      return;
    }
    if(token!==syncToken) return;

    const wanted=methodAccountType(method);
    const rows=accounts.filter((row)=>row.activo&&row.tipo===wanted);
    const previous=select.value;
    select.innerHTML=rows.map((row)=>'<option value="'+row.id+'">'+String(row.nombre||row.tipo)+'</option>').join('');
    if(rows.some((row)=>row.id===previous)) select.value=previous;
    label.classList.remove('hidden');
    label.hidden=false;
    label.childNodes?.[0] && (label.childNodes[0].textContent=method==='EFECTIVO'?'Caja de efectivo':'Banco / billetera');
    if(received) received.hidden=method!=='EFECTIVO';

    if(!rows.length){
      setConfirmState(method==='EFECTIVO'?'No hay una caja activa configurada para efectivo.':'No hay un banco/billetera activo para Tarjeta / QR.');
    }else{
      setConfirmState('');
    }
    document.documentElement.dataset.paymentChainV43=method+':'+(select.value||'NO_ACCOUNT');
  }

  function schedule(forceAccounts=false){
    const token=++syncToken;
    queueMicrotask(()=>{
      if(token!==syncToken) return;
      synchronize({forceAccounts}).catch(()=>{});
    });
  }

  document.addEventListener('click',(event)=>{
    const method=event.target?.closest?.('[data-cash-method]');
    if(method){
      if(method.dataset.cashMethod==='CREDITO'){
        event.preventDefault();
        event.stopImmediatePropagation();
        alert('El crédito requiere seleccionar un cliente. No se puede enviar a Caja General ni a un banco.');
        return;
      }
      schedule(false);
      return;
    }

    const confirm=event.target?.closest?.('#closeTable');
    if(confirm){
      const methodNow=activeMethod();
      const select=$('#paymentAccount');
      const account=accounts.find((row)=>row.id===select?.value)||null;
      const wanted=methodAccountType(methodNow);
      if(!wanted||!account||account.tipo!==wanted){
        event.preventDefault();
        event.stopImmediatePropagation();
        alert(methodNow==='EFECTIVO'?'Selecciona una cuenta tipo CAJA para efectivo.':'Selecciona una cuenta tipo BANCO para Tarjeta / QR.');
      }
      return;
    }

    if(event.target?.closest?.('[data-cash-table],[data-tab="caja"],[data-cc-tab="caja"]')){
      [0,80,180,350,700].forEach((delay)=>setTimeout(()=>synchronize().catch(()=>{}),delay));
    }
  },true);

  window.addEventListener('vantix:tenant-realtime',()=>synchronize({forceAccounts:true}).catch(()=>{}));
  window.addEventListener('vantix:tenant-realtime-ready',()=>synchronize({forceAccounts:true}).catch(()=>{}));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>[0,100,300,800].forEach((delay)=>setTimeout(()=>synchronize().catch(()=>{}),delay)),{once:true});
  else [0,100,300,800].forEach((delay)=>setTimeout(()=>synchronize().catch(()=>{}),delay));
})();
`;

function installRestaurantPaymentChainV43(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/app/restaurant-ui.js') return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source && !source.includes(MARKER)) {
      const patched = `${source}\n;${runtime}\n`;
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
    }
    res.set('X-VantixGC-Restaurant-Payment-Chain', 'v43-method-account-treasury');
    return originalSend(body);
  };
  return next();
}

module.exports = { MARKER, runtime, installRestaurantPaymentChainV43 };
