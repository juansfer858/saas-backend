'use strict';

const MARKER = 'VANTIX_RESTAURANT_PAYMENT_CHAIN_V43';

const runtime = String.raw`
;(()=>{
  'use strict';
  const MARKER='VANTIX_RESTAURANT_PAYMENT_CHAIN_V43';
  if(window[MARKER]) return;
  window[MARKER]=Object.freeze({
    version:'43.1.0',
    cashOnlyToCashAccount:true,
    bankOnlyToBankAccount:true,
    creditRequiresCustomer:true,
    invalidCombinationBlocked:true,
    treasurySource:'MOVIMIENTO_TESORERIA',
    selectionSurvivesRerender:true,
    methodSelectionAuthoritative:true
  });

  const SESSION_KEY='vantixgc_core_session_v1';
  let session=null;
  try{session=JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{}
  if(!session?.token) return;

  let accounts=[];
  let loadPromise=null;
  let syncToken=0;
  let selectedMethod='EFECTIVO';
  const selectedAccountByMethod=Object.create(null);

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

  function detectedMethod(){
    return $$('[data-cash-method]').find((button)=>button.classList.contains('active'))?.dataset.cashMethod||'EFECTIVO';
  }

  function activeMethod(){
    return selectedMethod||detectedMethod();
  }

  function methodAccountType(method){
    if(method==='EFECTIVO') return 'CAJA';
    if(method==='BANCO') return 'BANCO';
    return null;
  }

  function applyMethodVisual(method){
    const buttons=$$('[data-cash-method]');
    if(!buttons.length) return;
    buttons.forEach((button)=>{
      const own=button.dataset.cashMethod;
      if(own==='CREDITO'){
        button.disabled=true;
        button.title='El crédito requiere seleccionar un cliente y generar cartera. No usa Caja/Banco.';
        button.dataset.creditRequiresCustomer='true';
      }
      button.classList.toggle('active',own===method);
    });
  }

  function setConfirmState(message=''){
    const confirm=$('#closeTable');
    if(!confirm) return;
    if(message){
      confirm.disabled=true;
      confirm.dataset.paymentChainBlocked='true';
      confirm.title=message;
    }else{
      confirm.disabled=false;
      delete confirm.dataset.paymentChainBlocked;
      confirm.removeAttribute('title');
    }
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
    let select=$('#paymentAccount');
    let label=$('#accountLabel');
    let received=$('#cashReceivedRow');
    let confirm=$('#closeTable');
    let buttons=$$('[data-cash-method]');
    if(!select||!label||!confirm||!buttons.length) return;

    markCreditUnavailable();
    if(!['EFECTIVO','BANCO'].includes(selectedMethod)) selectedMethod='EFECTIVO';
    applyMethodVisual(selectedMethod);

    try{await loadAccounts(forceAccounts)}catch(error){
      if(token!==syncToken) return;
      select=$('#paymentAccount');
      if(select) select.innerHTML='';
      setConfirmState('No fue posible cargar las cuentas de Tesorería: '+error.message);
      return;
    }
    if(token!==syncToken) return;

    // El panel de Caja puede reconstruirse mientras esperamos el fetch. Nunca usar
    // referencias DOM capturadas antes del await: volvemos a tomar el panel actual.
    select=$('#paymentAccount');
    label=$('#accountLabel');
    received=$('#cashReceivedRow');
    confirm=$('#closeTable');
    buttons=$$('[data-cash-method]');
    if(!select||!label||!confirm||!buttons.length) return;

    applyMethodVisual(selectedMethod);
    const wanted=methodAccountType(selectedMethod);
    const rows=accounts.filter((row)=>row.activo&&row.tipo===wanted);
    const preferred=selectedAccountByMethod[selectedMethod]||select.value;
    select.innerHTML=rows.map((row)=>'<option value="'+row.id+'">'+String(row.nombre||row.tipo)+'</option>').join('');
    if(rows.some((row)=>row.id===preferred)) select.value=preferred;
    if(select.value) selectedAccountByMethod[selectedMethod]=select.value;

    label.classList.remove('hidden');
    label.hidden=false;
    if(label.childNodes?.[0]) label.childNodes[0].textContent=selectedMethod==='EFECTIVO'?'Caja de efectivo':'Banco / billetera';
    if(received) received.hidden=selectedMethod!=='EFECTIVO';

    if(!rows.length){
      setConfirmState(selectedMethod==='EFECTIVO'?'No hay una caja activa configurada para efectivo.':'No hay un banco/billetera activo para Tarjeta / QR.');
    }else{
      setConfirmState('');
    }
    document.documentElement.dataset.paymentChainV43=selectedMethod+':'+(select.value||'NO_ACCOUNT');
  }

  function schedule(forceAccounts=false){
    queueMicrotask(()=>synchronize({forceAccounts}).catch(()=>{}));
  }

  function stabilizeSelection(forceAccounts=false){
    [0,25,70,140,260,480,800].forEach((delay)=>{
      setTimeout(()=>{
        applyMethodVisual(selectedMethod);
        synchronize({forceAccounts:forceAccounts&&delay===0}).catch(()=>{});
      },delay);
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
      if(method.disabled) return;
      selectedMethod=method.dataset.cashMethod==='BANCO'?'BANCO':'EFECTIVO';
      // La selección se aplica en captura antes de cualquier capa que pueda repintar Caja.
      // Los reintentos posteriores la restauran si el panel fue reconstruido.
      applyMethodVisual(selectedMethod);
      stabilizeSelection(false);
      return;
    }

    const confirm=event.target?.closest?.('#closeTable');
    if(confirm){
      const select=$('#paymentAccount');
      const account=accounts.find((row)=>row.id===select?.value)||null;
      const wanted=methodAccountType(selectedMethod);
      if(!wanted||!account||account.tipo!==wanted){
        event.preventDefault();
        event.stopImmediatePropagation();
        alert(selectedMethod==='EFECTIVO'?'Selecciona una cuenta tipo CAJA para efectivo.':'Selecciona una cuenta tipo BANCO para Tarjeta / QR.');
      }
      return;
    }

    if(event.target?.closest?.('[data-cash-table],[data-tab="caja"],[data-cc-tab="caja"]')){
      stabilizeSelection(false);
    }
  },true);

  document.addEventListener('change',(event)=>{
    const select=event.target?.closest?.('#paymentAccount');
    if(select?.value) selectedAccountByMethod[selectedMethod]=select.value;
  },true);

  window.addEventListener('vantix:tenant-realtime',()=>stabilizeSelection(true));
  window.addEventListener('vantix:tenant-realtime-ready',()=>stabilizeSelection(true));
  window.addEventListener('pageshow',()=>stabilizeSelection(false));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>stabilizeSelection(false),{once:true});
  else stabilizeSelection(false);
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
    res.set('X-VantixGC-Restaurant-Payment-Chain', 'v43.1-method-stick-account-treasury');
    return originalSend(body);
  };
  return next();
}

module.exports = { MARKER, runtime, installRestaurantPaymentChainV43 };
