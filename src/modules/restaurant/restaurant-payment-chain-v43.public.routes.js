'use strict';

const MARKER = 'VANTIX_RESTAURANT_PAYMENT_CHAIN_V43';

const runtime = String.raw`
;(()=>{
  'use strict';
  const MARKER='VANTIX_RESTAURANT_PAYMENT_CHAIN_V43';
  if(window[MARKER]) return;
  window[MARKER]=Object.freeze({
    version:'43.2.0',
    cashOnlyToCashAccount:true,
    bankOnlyToBankAccount:true,
    creditRequiresCustomer:true,
    creditCustomerSelector:true,
    creditCreatesCxc:true,
    creditNoTreasuryMovement:true,
    invalidCombinationBlocked:true,
    treasurySource:'MOVIMIENTO_TESORERIA',
    selectionSurvivesRerender:true,
    methodSelectionAuthoritative:true
  });

  const SESSION_KEY='vantixgc_core_session_v1';
  let session=null;
  try{session=JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{}
  if(!session?.token) return;

  const nativeFetch=window.fetch.bind(window);
  let accounts=[];
  let customers=[];
  let loadPromise=null;
  let customerLoadPromise=null;
  let syncToken=0;
  let selectedMethod='EFECTIVO';
  let selectedCreditCustomerId='';
  const selectedAccountByMethod=Object.create(null);

  const $=(q,r=document)=>r.querySelector(q);
  const $$=(q,r=document)=>[...r.querySelectorAll(q)];

  async function loadAccounts(force=false){
    if(loadPromise&&!force) return loadPromise;
    loadPromise=(async()=>{
      const response=await nativeFetch('/api/v1/tesoreria/cajas-bancos',{
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

  async function loadCustomers(force=false){
    if(customerLoadPromise&&!force) return customerLoadPromise;
    customerLoadPromise=(async()=>{
      const response=await nativeFetch('/api/v1/terceros?activo=true&limit=500',{
        cache:'no-store',
        headers:{Authorization:'Bearer '+session.token,'x-tenant-subdomain':session.subdomain}
      });
      let body={};
      try{body=await response.json()}catch{}
      if(!response.ok) throw new Error(body?.error?.message||body?.message||('HTTP '+response.status));
      customers=(Array.isArray(body.data)?body.data:[]).filter((row)=>row&&row.activo!==false&&(row.tipo==='CLIENTE'||row.tipo==='CLIENTE_PROVEEDOR'));
      return customers;
    })().finally(()=>{customerLoadPromise=null});
    return customerLoadPromise;
  }

  function detectedMethod(){
    return $$('[data-cash-method]').find((button)=>button.classList.contains('active'))?.dataset.cashMethod||'EFECTIVO';
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
        button.disabled=false;
        button.title='Venta a crédito: selecciona el cliente que quedará en cartera.';
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

  function ensureCreditField(){
    const accountLabel=$('#accountLabel');
    if(!accountLabel) return null;
    let field=$('#creditCustomerField');
    if(!field){
      field=document.createElement('label');
      field.id='creditCustomerField';
      field.className='ri-label cash-credit-customer-field';
      field.innerHTML='Cliente para crédito<select id="creditCustomer" class="ri-select"><option value="">Selecciona un cliente</option></select><small id="creditCustomerHelp" style="display:block;margin-top:5px;color:#637997;font-weight:700"></small>';
      accountLabel.insertAdjacentElement('afterend',field);
      field.querySelector('#creditCustomer')?.addEventListener('change',(event)=>{
        selectedCreditCustomerId=String(event.target?.value||'');
        synchronize().catch(()=>{});
      });
    }
    field.hidden=selectedMethod!=='CREDITO';
    return field;
  }

  function populateCreditCustomers(){
    const field=ensureCreditField();
    const select=field?.querySelector('#creditCustomer');
    const help=field?.querySelector('#creditCustomerHelp');
    if(!select) return;
    const previous=selectedCreditCustomerId||select.value||'';
    select.innerHTML='<option value="">Selecciona un cliente</option>'+customers.map((row)=>{
      const id=String(row.id||'');
      const label=String(row.nombre||row.razonSocial||row.identificacion||'Cliente');
      const doc=String(row.identificacion||'').trim();
      return '<option value="'+id+'">'+label+(doc?' · '+doc:'')+'</option>';
    }).join('');
    if(customers.some((row)=>String(row.id)===previous)){
      select.value=previous;
      selectedCreditCustomerId=previous;
    }else{
      selectedCreditCustomerId='';
    }
    const selected=customers.find((row)=>String(row.id)===selectedCreditCustomerId)||null;
    if(help){
      if(!customers.length) help.textContent='No hay clientes activos. Créalo primero en Clientes / Proveedores.';
      else if(selected) help.textContent='Plazo: '+Number(selected.diasPlazo||0)+' día(s) · cupo configurado: '+Number(selected.cupoCredito||0).toLocaleString('es-CO');
      else help.textContent='El crédito se registrará como cuenta por cobrar y no moverá Caja/Banco.';
    }
  }

  function setTipMode(){
    const tip=$('#tip');
    if(!tip) return;
    if(selectedMethod==='CREDITO'){
      tip.value='0';
      tip.disabled=true;
      tip.title='La propina debe cobrarse por un medio de contado.';
    }else{
      tip.disabled=false;
      tip.removeAttribute('title');
    }
  }

  async function synchronize({forceAccounts=false}={}){
    const token=++syncToken;
    let select=$('#paymentAccount');
    let label=$('#accountLabel');
    let received=$('#cashReceivedRow');
    const confirm=$('#closeTable');
    const buttons=$$('[data-cash-method]');
    if(!select||!label||!confirm||!buttons.length) return;

    if(!['EFECTIVO','BANCO','CREDITO'].includes(selectedMethod)) selectedMethod=detectedMethod();
    if(!['EFECTIVO','BANCO','CREDITO'].includes(selectedMethod)) selectedMethod='EFECTIVO';
    applyMethodVisual(selectedMethod);
    ensureCreditField();
    setTipMode();

    if(selectedMethod==='CREDITO'){
      label.hidden=true;
      label.classList.add('hidden');
      if(received) received.hidden=true;
      try{await loadCustomers(forceAccounts)}catch(error){
        if(token!==syncToken) return;
        setConfirmState('No fue posible cargar los clientes: '+error.message);
        return;
      }
      if(token!==syncToken) return;
      populateCreditCustomers();
      const field=$('#creditCustomerField');
      if(field) field.hidden=false;
      setConfirmState(selectedCreditCustomerId?'':'Selecciona el cliente que recibirá el crédito.');
      document.documentElement.dataset.paymentChainV43='CREDITO:'+(selectedCreditCustomerId||'NO_CUSTOMER');
      return;
    }

    const creditField=$('#creditCustomerField');
    if(creditField) creditField.hidden=true;
    label.hidden=false;
    label.classList.remove('hidden');
    if(received) received.hidden=selectedMethod!=='EFECTIVO';

    try{await loadAccounts(forceAccounts)}catch(error){
      if(token!==syncToken) return;
      select=$('#paymentAccount');
      if(select) select.innerHTML='';
      setConfirmState('No fue posible cargar las cuentas de Tesorería: '+error.message);
      return;
    }
    if(token!==syncToken) return;

    select=$('#paymentAccount');
    label=$('#accountLabel');
    received=$('#cashReceivedRow');
    if(!select||!label||!$('#closeTable')) return;

    applyMethodVisual(selectedMethod);
    const wanted=methodAccountType(selectedMethod);
    const rows=accounts.filter((row)=>row.activo&&row.tipo===wanted);
    const preferred=selectedAccountByMethod[selectedMethod]||select.value;
    select.innerHTML=rows.map((row)=>'<option value="'+row.id+'">'+String(row.nombre||row.tipo)+'</option>').join('');
    if(rows.some((row)=>row.id===preferred)) select.value=preferred;
    if(select.value) selectedAccountByMethod[selectedMethod]=select.value;

    if(label.childNodes?.[0]) label.childNodes[0].textContent=selectedMethod==='EFECTIVO'?'Caja de efectivo':'Banco / billetera';
    if(received) received.hidden=selectedMethod!=='EFECTIVO';

    if(!rows.length){
      setConfirmState(selectedMethod==='EFECTIVO'?'No hay una caja activa configurada para efectivo.':'No hay un banco/billetera activo para Tarjeta / QR.');
    }else{
      setConfirmState('');
    }
    document.documentElement.dataset.paymentChainV43=selectedMethod+':'+(select.value||'NO_ACCOUNT');
  }

  function stabilizeSelection(forceAccounts=false){
    [0,25,70,140,260,480,800].forEach((delay)=>{
      setTimeout(()=>{
        applyMethodVisual(selectedMethod);
        synchronize({forceAccounts:forceAccounts&&delay===0}).catch(()=>{});
      },delay);
    });
  }

  window.fetch=(input,init={})=>{
    const url=typeof input==='string'?input:String(input?.url||'');
    const method=String(init?.method||'GET').toUpperCase();
    if(method==='POST'&&/\/api\/v1\/restaurante\/mesas\/[^/]+\/cerrar(?:\?.*)?$/.test(url)&&typeof init?.body==='string'){
      try{
        const payload=JSON.parse(init.body);
        if(String(payload?.formaPago||'').toUpperCase()==='CREDITO'){
          payload.terceroId=selectedCreditCustomerId||null;
          init={...init,body:JSON.stringify(payload)};
        }
      }catch{}
    }
    return nativeFetch(input,init);
  };

  document.addEventListener('click',(event)=>{
    const method=event.target?.closest?.('[data-cash-method]');
    if(method){
      if(method.disabled) return;
      const own=String(method.dataset.cashMethod||'').toUpperCase();
      selectedMethod=own==='BANCO'?'BANCO':own==='CREDITO'?'CREDITO':'EFECTIVO';
      applyMethodVisual(selectedMethod);
      stabilizeSelection(false);
      return;
    }

    const confirm=event.target?.closest?.('#closeTable');
    if(confirm){
      if(selectedMethod==='CREDITO'){
        if(!selectedCreditCustomerId){
          event.preventDefault();
          event.stopImmediatePropagation();
          alert('Selecciona el cliente que recibirá el crédito.');
          return;
        }
        const tipValue=Number($('#tip')?.value||0);
        if(tipValue>0){
          event.preventDefault();
          event.stopImmediatePropagation();
          alert('La propina debe cobrarse por un medio de contado.');
        }
        return;
      }
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

    if(event.target?.closest?.('[data-cash-table],[data-tab="caja"],[data-cc-tab="caja"],[data-cash-metric],[data-cash-metric-back]')){
      stabilizeSelection(false);
    }
  },true);

  document.addEventListener('change',(event)=>{
    const account=event.target?.closest?.('#paymentAccount');
    if(account?.value) selectedAccountByMethod[selectedMethod]=account.value;
    const customer=event.target?.closest?.('#creditCustomer');
    if(customer){
      selectedCreditCustomerId=String(customer.value||'');
      synchronize().catch(()=>{});
    }
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
    res.set('X-VantixGC-Restaurant-Payment-Chain', 'v43.2-credit-customer-cxc');
    return originalSend(body);
  };
  return next();
}

module.exports = { MARKER, runtime, installRestaurantPaymentChainV43 };
