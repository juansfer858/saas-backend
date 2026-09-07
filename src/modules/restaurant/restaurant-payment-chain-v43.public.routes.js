'use strict';

const MARKER = 'VANTIX_RESTAURANT_PAYMENT_CHAIN_V43';

const runtime = String.raw`
;(()=>{
  'use strict';
  const MARKER='VANTIX_RESTAURANT_PAYMENT_CHAIN_V43';
  if(window[MARKER]) return;
  window[MARKER]=Object.freeze({
    version:'43.3.0',
    cashOnlyToCashAccount:true,
    bankOnlyToBankAccount:true,
    creditRequiresCustomer:true,
    creditCustomerSelector:true,
    creditCreatesCxc:true,
    creditNoTreasuryMovement:true,
    genericCustomerCannotReceiveCredit:true,
    creditSelectionSticky:true,
    creditChangeIsolation:true,
    quickCustomerCreate:true,
    invalidCombinationBlocked:true,
    treasurySource:'MOVIMIENTO_TESORERIA',
    selectionSurvivesRerender:true,
    methodSelectionAuthoritative:true
  });

  const SESSION_KEY='vantixgc_core_session_v1';
  const GENERIC_CUSTOMER_IDENTIFICATION='222222222222';
  const QUICK_DIALOG_ID='creditQuickCustomerDialogV47';
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
  const esc=(v)=>String(v??'').replace(/[&<>"']/g,(m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));

  function currentPanel(){return $('#view .cash-fast-panel.cash-collect-dialog-v40')||$('#view .cash-fast-panel')}

  function authoritativeMethod(){
    const stored=currentPanel()?.dataset?.paymentMethodAuthoritative;
    if(['EFECTIVO','BANCO','CREDITO'].includes(stored)) return stored;
    return selectedMethod;
  }

  function setSelectedMethod(method){
    selectedMethod=['EFECTIVO','BANCO','CREDITO'].includes(method)?method:'EFECTIVO';
    const panel=currentPanel();
    if(panel) panel.dataset.paymentMethodAuthoritative=selectedMethod;
    applyMethodVisual(selectedMethod);
    return selectedMethod;
  }

  async function authenticatedJson(path,opts={}){
    const response=await nativeFetch(path,{
      ...opts,
      cache:'no-store',
      headers:{
        Authorization:'Bearer '+session.token,
        'x-tenant-subdomain':session.subdomain,
        ...(opts.body?{'Content-Type':'application/json'}:{}),
        ...(opts.headers||{})
      }
    });
    let body={};
    try{body=await response.json()}catch{}
    if(!response.ok) throw new Error(body?.error?.message||body?.message||('HTTP '+response.status));
    return body.data;
  }

  async function loadAccounts(force=false){
    if(loadPromise&&!force) return loadPromise;
    loadPromise=(async()=>{
      accounts=await authenticatedJson('/api/v1/tesoreria/cajas-bancos');
      if(!Array.isArray(accounts)) accounts=[];
      return accounts;
    })().finally(()=>{loadPromise=null});
    return loadPromise;
  }

  async function loadCustomers(force=false){
    if(customerLoadPromise&&!force) return customerLoadPromise;
    customerLoadPromise=(async()=>{
      const rows=await authenticatedJson('/api/v1/terceros?activo=true&limit=500');
      customers=(Array.isArray(rows)?rows:[]).filter((row)=>
        row&&row.activo!==false&&
        (row.tipo==='CLIENTE'||row.tipo==='CLIENTE_PROVEEDOR')&&
        String(row.identificacion||'').trim()!==GENERIC_CUSTOMER_IDENTIFICATION
      );
      return customers;
    })().finally(()=>{customerLoadPromise=null});
    return customerLoadPromise;
  }

  function detectedMethod(){
    const stored=authoritativeMethod();
    if(['EFECTIVO','BANCO','CREDITO'].includes(stored)) return stored;
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
      const own=String(button.dataset.cashMethod||'').toUpperCase();
      if(own==='CREDITO'){
        button.disabled=false;
        button.title='Venta a crédito: selecciona o crea el cliente que quedará en cartera.';
        button.dataset.creditRequiresCustomer='true';
      }
      button.classList.toggle('active',own===method);
      if(own===method) button.setAttribute('aria-pressed','true');
      else button.setAttribute('aria-pressed','false');
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

  function ensureQuickCustomerDialog(){
    let dialog=$('#'+QUICK_DIALOG_ID);
    if(dialog) return dialog;
    dialog=document.createElement('dialog');
    dialog.id=QUICK_DIALOG_ID;
    dialog.className='ri-card';
    dialog.style.cssText='width:min(620px,calc(100vw - 24px));max-height:90dvh;border:0;border-radius:16px;padding:0;box-shadow:0 30px 90px rgba(15,23,42,.35);overflow:auto;z-index:1300';
    dialog.innerHTML='<form id="creditQuickCustomerFormV47" style="padding:18px;display:grid;gap:12px"><div style="display:flex;align-items:center;gap:10px"><div><h2 style="margin:0">Crear cliente</h2><p style="margin:4px 0 0;color:#64748b;font-size:12px">Se crea como cliente activo y queda seleccionado para este crédito.</p></div><button type="button" class="ri-btn small" data-credit-quick-close style="margin-left:auto">Cerrar</button></div><div style="display:grid;grid-template-columns:1fr 1.2fr;gap:10px"><label class="ri-label">Tipo de documento<select id="creditQuickDocTypeV47" class="ri-select"><option value="CC">CC</option><option value="NIT">NIT</option><option value="CE">CE</option><option value="PASAPORTE">Pasaporte</option></select></label><label class="ri-label">Identificación<input id="creditQuickIdentificationV47" class="ri-input" required minlength="3" maxlength="40"></label></div><label class="ri-label">Nombre / razón social<input id="creditQuickNameV47" class="ri-input" required minlength="2" maxlength="160"></label><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><label class="ri-label">Teléfono<input id="creditQuickPhoneV47" class="ri-input" maxlength="50"></label><label class="ri-label">Correo<input id="creditQuickEmailV47" class="ri-input" type="email" maxlength="254"></label></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><label class="ri-label">Cupo de crédito<input id="creditQuickLimitV47" class="ri-input" type="number" min="0" value="0"><small style="font-weight:600;color:#64748b">0 = sin tope configurado</small></label><label class="ri-label">Plazo en días<input id="creditQuickDaysV47" class="ri-input" type="number" min="0" max="3650" value="0"></label></div><div id="creditQuickMessageV47"></div><button type="submit" class="ri-btn primary">Crear y seleccionar cliente</button></form>';
    document.body.appendChild(dialog);
    $('[data-credit-quick-close]',dialog)?.addEventListener('click',()=>dialog.close?.());
    dialog.addEventListener('click',(event)=>{if(event.target===dialog)dialog.close?.()});
    $('#creditQuickCustomerFormV47',dialog)?.addEventListener('submit',async(event)=>{
      event.preventDefault();
      const message=$('#creditQuickMessageV47',dialog);
      const submit=event.submitter||$('button[type="submit"]',dialog);
      if(submit) submit.disabled=true;
      if(message) message.innerHTML='';
      try{
        const created=await authenticatedJson('/api/v1/restaurante/credito/clientes',{
          method:'POST',
          body:JSON.stringify({
            tipoDocumento:$('#creditQuickDocTypeV47',dialog)?.value||'CC',
            identificacion:$('#creditQuickIdentificationV47',dialog)?.value?.trim()||'',
            nombre:$('#creditQuickNameV47',dialog)?.value?.trim()||'',
            telefono:$('#creditQuickPhoneV47',dialog)?.value?.trim()||null,
            email:$('#creditQuickEmailV47',dialog)?.value?.trim()||null,
            cupoCredito:Number($('#creditQuickLimitV47',dialog)?.value||0),
            diasPlazo:Number($('#creditQuickDaysV47',dialog)?.value||0)
          })
        });
        setSelectedMethod('CREDITO');
        selectedCreditCustomerId=String(created?.id||'');
        await loadCustomers(true);
        dialog.close?.();
        event.target.reset?.();
        setSelectedMethod('CREDITO');
        await synchronize({forceAccounts:false});
      }catch(error){
        if(message) message.innerHTML='<div class="ri-error">'+esc(error.message)+'</div>';
      }finally{
        if(submit) submit.disabled=false;
      }
    });
    return dialog;
  }

  function openQuickCustomerDialog(){
    setSelectedMethod('CREDITO');
    const dialog=ensureQuickCustomerDialog();
    if(typeof dialog.showModal==='function'&&!dialog.open) dialog.showModal();
    else dialog.setAttribute('open','');
    setTimeout(()=>$('#creditQuickIdentificationV47',dialog)?.focus(),0);
  }

  function ensureCreditField(){
    const accountLabel=$('#accountLabel');
    if(!accountLabel) return null;
    let field=$('#creditCustomerField');
    if(!field){
      field=document.createElement('div');
      field.id='creditCustomerField';
      field.className='cash-credit-customer-field';
      field.innerHTML='<label class="ri-label">Cliente para crédito<select id="creditCustomer" class="ri-select"><option value="">Selecciona un cliente</option></select></label><button type="button" id="createCreditCustomerV47" class="ri-btn" style="margin-top:8px;width:100%">+ Crear cliente</button><small id="creditCustomerHelp" style="display:block;margin-top:6px;color:#637997;font-weight:700"></small>';
      accountLabel.insertAdjacentElement('afterend',field);
      $('#createCreditCustomerV47',field)?.addEventListener('click',(event)=>{
        event.preventDefault();
        event.stopImmediatePropagation();
        openQuickCustomerDialog();
      });
    }
    field.hidden=authoritativeMethod()!=='CREDITO';
    return field;
  }

  function populateCreditCustomers(){
    const field=ensureCreditField();
    const select=$('#creditCustomer',field);
    const help=$('#creditCustomerHelp',field);
    if(!select) return;
    const previous=selectedCreditCustomerId||select.value||'';
    select.innerHTML='<option value="">Selecciona un cliente</option>'+customers.map((row)=>{
      const id=esc(row.id||'');
      const label=esc(row.nombre||row.razonSocial||row.identificacion||'Cliente');
      const doc=esc(String(row.identificacion||'').trim());
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
      if(!customers.length) help.textContent='No hay clientes identificados. Usa “+ Crear cliente”.';
      else if(selected) help.textContent='Plazo: '+Number(selected.diasPlazo||0)+' día(s) · cupo configurado: '+Number(selected.cupoCredito||0).toLocaleString('es-CO');
      else help.textContent='Selecciona un cliente o créalo aquí. El crédito irá a Cartera y no moverá Caja/Banco.';
    }
  }

  function setTipMode(){
    const tip=$('#tip');
    if(!tip) return;
    if(authoritativeMethod()==='CREDITO'){
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

    const stateMethod=authoritativeMethod();
    if(['EFECTIVO','BANCO','CREDITO'].includes(stateMethod)) selectedMethod=stateMethod;
    else selectedMethod=detectedMethod();
    setSelectedMethod(selectedMethod);
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
      setSelectedMethod('CREDITO');
      populateCreditCustomers();
      const field=$('#creditCustomerField');
      if(field) field.hidden=false;
      setConfirmState(selectedCreditCustomerId?'':'Selecciona o crea el cliente que recibirá el crédito.');
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

    setSelectedMethod(selectedMethod);
    const wanted=methodAccountType(selectedMethod);
    const rows=accounts.filter((row)=>row.activo&&row.tipo===wanted);
    const preferred=selectedAccountByMethod[selectedMethod]||select.value;
    select.innerHTML=rows.map((row)=>'<option value="'+esc(row.id)+'">'+esc(row.nombre||row.tipo)+'</option>').join('');
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
        setSelectedMethod(authoritativeMethod());
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
        if(authoritativeMethod()==='CREDITO'||String(payload?.formaPago||'').toUpperCase()==='CREDITO'){
          payload.formaPago='CREDITO';
          payload.cajaBancoId=null;
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
      const next=own==='BANCO'?'BANCO':own==='CREDITO'?'CREDITO':'EFECTIVO';
      event.preventDefault();
      event.stopImmediatePropagation();
      setSelectedMethod(next);
      stabilizeSelection(false);
      return;
    }

    const quickCreate=event.target?.closest?.('#createCreditCustomerV47');
    if(quickCreate){
      event.preventDefault();
      event.stopImmediatePropagation();
      setSelectedMethod('CREDITO');
      openQuickCustomerDialog();
      return;
    }

    const confirm=event.target?.closest?.('#closeTable');
    if(confirm){
      const method=authoritativeMethod();
      if(method==='CREDITO'){
        setSelectedMethod('CREDITO');
        if(!selectedCreditCustomerId){
          event.preventDefault();
          event.stopImmediatePropagation();
          alert('Selecciona o crea el cliente que recibirá el crédito.');
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
      const wanted=methodAccountType(method);
      if(!wanted||!account||account.tipo!==wanted){
        event.preventDefault();
        event.stopImmediatePropagation();
        alert(method==='EFECTIVO'?'Selecciona una cuenta tipo CAJA para efectivo.':'Selecciona una cuenta tipo BANCO para Tarjeta / QR.');
      }
      return;
    }

    if(event.target?.closest?.('[data-cash-table],[data-tab="caja"],[data-cc-tab="caja"],[data-cash-metric],[data-cash-metric-back]')){
      stabilizeSelection(false);
    }
  },true);

  document.addEventListener('change',(event)=>{
    const customer=event.target?.closest?.('#creditCustomer');
    if(customer){
      event.stopImmediatePropagation();
      selectedCreditCustomerId=String(customer.value||'');
      setSelectedMethod('CREDITO');
      setTipMode();
      setConfirmState(selectedCreditCustomerId?'':'Selecciona o crea el cliente que recibirá el crédito.');
      stabilizeSelection(false);
      return;
    }
    const account=event.target?.closest?.('#paymentAccount');
    if(account?.value) selectedAccountByMethod[authoritativeMethod()]=account.value;
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
    res.set('X-VantixGC-Restaurant-Payment-Chain', 'v43.3-credit-sticky-quick-customer');
    return originalSend(body);
  };
  return next();
}

module.exports = { MARKER, runtime, installRestaurantPaymentChainV43 };
