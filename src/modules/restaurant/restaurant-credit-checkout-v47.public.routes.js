'use strict';

const MARKER = 'VANTIX_RESTAURANT_CREDIT_CHECKOUT_V47';

const runtime = String.raw`
;(()=>{
  'use strict';
  const MARKER='VANTIX_RESTAURANT_CREDIT_CHECKOUT_V47';
  if(window[MARKER]) return;
  window[MARKER]=Object.freeze({version:'47.0.0',creditMethodSticky:true,createCustomerInline:true,creditRequestAuthoritative:true});

  const SESSION_KEY='vantixgc_core_session_v1';
  let session=null;
  try{session=JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{}
  if(!session?.token) return;
  const nativeFetch=window.fetch.bind(window);
  let method='EFECTIVO';
  let customerId='';
  const $=(q,r=document)=>r.querySelector(q);
  const $$=(q,r=document)=>[...r.querySelectorAll(q)];
  const authHeaders=()=>({Authorization:'Bearer '+session.token,'x-tenant-subdomain':session.subdomain,'Content-Type':'application/json'});

  window.fetch=(input,init={})=>{
    let url=typeof input==='string'?input:String(input?.url||'');
    const http=String(init?.method||'GET').toUpperCase();
    if(http==='GET'&&url.startsWith('/api/v1/terceros?')){
      url='/api/v1/restaurante/clientes-credito'+url.slice(url.indexOf('?'));
      input=url;
    }
    if(http==='POST'&&/\/api\/v1\/restaurante\/mesas\/[^/]+\/cerrar(?:\?.*)?$/.test(url)&&typeof init?.body==='string'&&method==='CREDITO'){
      try{
        const payload=JSON.parse(init.body);
        payload.formaPago='CREDITO';
        payload.cajaBancoId=null;
        payload.terceroId=customerId||null;
        payload.tipAmount=0;
        init={...init,body:JSON.stringify(payload)};
      }catch{}
    }
    return nativeFetch(input,init);
  };

  function assertCreditVisual(){
    if(method!=='CREDITO') return;
    $$('[data-cash-method]').forEach((b)=>b.classList.toggle('active',b.dataset.cashMethod==='CREDITO'));
    const field=$('#creditCustomerField'); if(field) field.hidden=false;
    const account=$('#accountLabel'); if(account) account.hidden=true;
    const received=$('#cashReceivedRow'); if(received) received.hidden=true;
  }
  function stabilize(){[0,30,80,160,300,600].forEach((d)=>setTimeout(assertCreditVisual,d));}

  function ensureCreateButton(){
    const field=$('#creditCustomerField');
    if(!field||$('#createCreditCustomer')) return;
    const button=document.createElement('button');
    button.type='button'; button.id='createCreditCustomer'; button.className='ri-btn small';
    button.textContent='+ Crear cliente'; button.style.marginTop='8px';
    field.appendChild(button);
    button.addEventListener('click',openCreateDialog);
  }

  function dialog(){
    let d=$('#creditCustomerCreateDialog');
    if(d) return d;
    d=document.createElement('dialog'); d.id='creditCustomerCreateDialog'; d.className='ri-card salon-dialog';
    d.innerHTML='<form id="creditCustomerCreateForm" method="dialog" style="min-width:min(520px,92vw);display:grid;gap:10px">'
      +'<h2 style="margin:0">Crear cliente</h2><p class="ri-muted" style="margin:0">Quedará disponible inmediatamente para este crédito.</p>'
      +'<label class="ri-label">Tipo de documento<select id="ccTipoDocumento" class="ri-select"><option>CC</option><option>NIT</option><option>CE</option><option>PP</option></select></label>'
      +'<label class="ri-label">Identificación<input id="ccIdentificacion" class="ri-input" required></label>'
      +'<label class="ri-label">Nombre<input id="ccNombre" class="ri-input" required></label>'
      +'<label class="ri-label">Teléfono<input id="ccTelefono" class="ri-input"></label>'
      +'<label class="ri-label">Correo<input id="ccEmail" class="ri-input" type="email"></label>'
      +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><label class="ri-label">Cupo de crédito<input id="ccCupo" class="ri-input" type="number" min="0" value="0"></label><label class="ri-label">Días de plazo<input id="ccPlazo" class="ri-input" type="number" min="0" value="0"></label></div>'
      +'<div id="ccError"></div><div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="ri-btn" id="ccCancel">Cancelar</button><button type="submit" class="ri-btn primary">Crear y seleccionar</button></div></form>';
    document.body.appendChild(d);
    $('#ccCancel',d).addEventListener('click',()=>d.close());
    $('#creditCustomerCreateForm',d).addEventListener('submit',createCustomer);
    return d;
  }
  function openCreateDialog(){const d=dialog(); if(typeof d.showModal==='function') d.showModal(); else d.setAttribute('open','');}

  async function createCustomer(event){
    event.preventDefault();
    const d=dialog(); const error=$('#ccError',d); if(error) error.textContent='';
    const payload={tipoDocumento:$('#ccTipoDocumento',d).value,identificacion:$('#ccIdentificacion',d).value.trim(),nombre:$('#ccNombre',d).value.trim(),telefono:$('#ccTelefono',d).value.trim()||null,email:$('#ccEmail',d).value.trim()||null,cupoCredito:Number($('#ccCupo',d).value||0),diasPlazo:Number($('#ccPlazo',d).value||0)};
    try{
      const response=await nativeFetch('/api/v1/restaurante/clientes-credito',{method:'POST',headers:authHeaders(),body:JSON.stringify(payload)});
      const body=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(body?.error?.message||body?.message||('HTTP '+response.status));
      customerId=String(body.data?.id||''); method='CREDITO'; d.close();
      const select=$('#creditCustomer');
      if(select&&customerId){
        let option=[...select.options].find((o)=>o.value===customerId);
        if(!option){option=document.createElement('option'); option.value=customerId; option.textContent=(body.data?.nombre||'Cliente')+' · '+(body.data?.identificacion||''); select.appendChild(option);}
        select.value=customerId; select.dispatchEvent(new Event('change',{bubbles:true}));
      }
      stabilize(); ensureCreateButton();
    }catch(e){if(error) error.innerHTML='<div class="ri-error">'+String(e.message||e)+'</div>';}
  }

  document.addEventListener('click',(event)=>{
    const b=event.target?.closest?.('[data-cash-method]');
    if(b){const own=String(b.dataset.cashMethod||'').toUpperCase(); method=own==='BANCO'?'BANCO':own==='CREDITO'?'CREDITO':'EFECTIVO'; if(method==='CREDITO'){stabilize(); setTimeout(ensureCreateButton,20); setTimeout(ensureCreateButton,120);}}
    if(event.target?.closest?.('[data-cash-table]')){method='EFECTIVO'; customerId='';}
  },true);
  document.addEventListener('change',(event)=>{
    const c=event.target?.closest?.('#creditCustomer');
    if(c){method='CREDITO'; customerId=String(c.value||''); stabilize(); setTimeout(ensureCreateButton,0);}
  },true);
})();
`;

function installRestaurantCreditCheckoutV47(req,res,next){
  if(req.method!=='GET'||req.path!=='/app/restaurant-ui.js') return next();
  const originalSend=res.send.bind(res);
  res.send=(body)=>{
    const isBuffer=Buffer.isBuffer(body);
    const source=isBuffer?body.toString('utf8'):(typeof body==='string'?body:null);
    if(source&&!source.includes(MARKER)){
      const patched=`${source}\n;${runtime}\n`;
      body=isBuffer?Buffer.from(patched,'utf8'):patched;
    }
    res.set('X-VantixGC-Restaurant-Credit-Checkout','v47-sticky-create-client');
    return originalSend(body);
  };
  return next();
}

module.exports={MARKER,runtime,installRestaurantCreditCheckoutV47};
