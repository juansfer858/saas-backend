'use strict';

const PAYMENT_METHODS_VISIBILITY_MARKER = 'VANTIX_RESTAURANT_PAYMENT_METHODS_VISIBLE_V2';

const paymentMethodsVisibilityRuntime = String.raw`
;(()=>{
  'use strict';
  const MARKER='VANTIX_RESTAURANT_PAYMENT_METHODS_VISIBLE_V2';
  if(window[MARKER]) return;
  window[MARKER]=Object.freeze({version:'2.1.0',location:'CAJA_HEADER',independentOfSelectedTable:true,eventDriven:true});

  const SESSION_KEY='vantixgc_core_session_v1';
  let session=null;
  try{session=JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{}
  if(!session?.token) return;

  const $=(q,r=document)=>r.querySelector(q);
  const $$=(q,r=document)=>[...r.querySelectorAll(q)];
  const esc=(v)=>String(v??'').replace(/[&<>"']/g,(m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#039;'}[m]));
  const currentRole=()=>String(session.user?.rol||$('#userRole')?.textContent||'').trim().toUpperCase();
  const canManage=()=>['ADMIN','ADMINISTRADOR','SUPER_ADMIN'].includes(currentRole());
  let editingId=null;
  let methods=[];
  let accounts=[];

  async function api(path,opts={}){
    const response=await fetch(path,{
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

  function ensureStyles(){
    if($('#rpmvStyles')) return;
    const style=document.createElement('style');
    style.id='rpmvStyles';
    style.textContent=\`
      .cash-page-head .rpmv-shortcut{margin-left:auto;min-height:42px;padding:0 14px;border:1px solid #cfd9e3;border-radius:11px;background:#fff;color:#122b4a;font-weight:900;white-space:nowrap}
      .cash-page-head .rpmv-shortcut:hover{border-color:#ffb28e;background:#fff5f0;color:#b83f0e}
      .rpmv-dialog{width:min(820px,calc(100vw - 24px));max-height:90dvh;padding:0;border:0;border-radius:18px;background:#fff;box-shadow:0 28px 80px rgba(15,23,42,.30);overflow:hidden;color:#0f172a}
      .rpmv-dialog::backdrop{background:rgba(15,23,42,.54);backdrop-filter:blur(2px)}
      .rpmv-head{display:flex;align-items:center;gap:12px;padding:15px 17px;border-bottom:1px solid #e2e8f0;background:#f8fafc}.rpmv-head>div{min-width:0}.rpmv-head h2{margin:0;font-size:20px}.rpmv-head p{margin:3px 0 0;color:#64748b;font-size:11px}.rpmv-head button{margin-left:auto}
      .rpmv-body{padding:15px;max-height:calc(90dvh - 72px);overflow:auto}.rpmv-list{display:grid;gap:8px}.rpmv-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:11px;border:1px solid #e2e8f0;border-radius:12px}.rpmv-row.inactive{opacity:.58}.rpmv-row b{display:block}.rpmv-row small{display:block;margin-top:3px;color:#64748b}.rpmv-actions{display:flex;gap:6px;flex-wrap:wrap}
      .rpmv-form{display:grid;grid-template-columns:1.2fr 1fr 1.2fr auto;gap:8px;align-items:end;margin-top:14px;padding:13px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc}.rpmv-form label{display:grid;gap:4px;font-size:10px;font-weight:900;color:#475569}.rpmv-form input,.rpmv-form select{min-height:42px;padding:0 9px;border:1px solid #cbd5e1;border-radius:9px;background:#fff}.rpmv-check{display:flex!important;align-items:center!important;gap:6px!important;min-height:42px}.rpmv-check input{width:18px;height:18px;min-height:0}.rpmv-form-buttons{grid-column:1/-1;display:flex;gap:8px;justify-content:flex-end}
      .rpmv-bank{margin-top:12px;padding:11px;border:1px dashed #cbd5e1;border-radius:11px;background:#fff}.rpmv-bank summary{cursor:pointer;font-weight:900;color:#334155}.rpmv-bank-form{display:grid;grid-template-columns:1.1fr 1fr 1fr auto;gap:7px;align-items:end;margin-top:10px}.rpmv-bank-form label{display:grid;gap:4px;font-size:10px;font-weight:850;color:#475569}.rpmv-bank-form input{min-height:40px;padding:0 9px;border:1px solid #cbd5e1;border-radius:8px}.rpmv-empty{padding:12px;border:1px dashed #cbd5e1;border-radius:10px;color:#64748b;font-size:12px}
      @media(max-width:720px){.cash-page-head{gap:8px;flex-wrap:wrap}.cash-page-head .rpmv-shortcut{width:100%;margin-left:0}.rpmv-form,.rpmv-bank-form{grid-template-columns:1fr}.rpmv-form-buttons{grid-column:auto}.rpmv-row{grid-template-columns:1fr}}
    \`;
    document.head.appendChild(style);
  }

  function kindLabel(kind){return ({EFECTIVO:'Efectivo',TRANSFERENCIA:'Transferencia / QR',TARJETA:'Tarjeta',CREDITO:'Crédito'})[kind]||kind}
  function accountById(id){return accounts.find((row)=>row.id===id)||null}
  function methodSubtitle(method){const account=method.account||accountById(method.cajaBancoId);return kindLabel(method.kind)+(account?.nombre?' · '+account.nombre:'')}
  function accountOptions(kind,selected=''){
    if(kind==='CREDITO') return '<option value="">No aplica</option>';
    const wanted=kind==='EFECTIVO'?'CAJA':'BANCO';
    return '<option value="">Seleccionar…</option>'+accounts.filter((row)=>row.activo&&row.tipo===wanted).map((row)=>'<option value="'+esc(row.id)+'" '+(row.id===selected?'selected':'')+'>'+esc(row.nombre)+(row.banco?' · '+esc(row.banco):'')+'</option>').join('');
  }

  function ensureDialog(){
    let dialog=$('#rpmvDialog');
    if(dialog) return dialog;
    dialog=document.createElement('dialog');
    dialog.id='rpmvDialog';
    dialog.className='rpmv-dialog';
    dialog.innerHTML='<header class="rpmv-head"><div><h2>Métodos de pago</h2><p>Configuración propia del restaurante · disponible aunque no haya mesas por cobrar.</p></div><button type="button" class="ri-btn small" data-rpmv-close>Cerrar</button></header><div class="rpmv-body"></div>';
    document.body.appendChild(dialog);
    $('[data-rpmv-close]',dialog).addEventListener('click',()=>dialog.close());
    dialog.addEventListener('click',(event)=>{if(event.target===dialog) dialog.close()});
    return dialog;
  }

  async function load(){
    [methods,accounts]=await Promise.all([
      api('/api/v1/restaurante/metodos-pago'),
      api('/api/v1/tesoreria/cajas-bancos')
    ]);
    if(!Array.isArray(methods)) methods=[];
    if(!Array.isArray(accounts)) accounts=[];
  }

  function syncPaymentPanel(){
    $('#restaurantPaymentMethodPanel')?.remove();
    $('.cash-methods')?.classList.remove('rpm-base-hidden');
    $('#accountLabel')?.classList.remove('rpm-base-hidden');
  }

  function render(dialog){
    const body=$('.rpmv-body',dialog);
    const list=methods.map((method)=>'<div class="rpmv-row '+(method.active?'':'inactive')+'"><div><b>'+esc(method.name)+'</b><small>'+esc(methodSubtitle(method))+' · '+(method.active?'Activo':'Inactivo')+'</small></div><div class="rpmv-actions"><button type="button" class="ri-btn small" data-rpmv-edit="'+esc(method.id)+'">Editar</button>'+(method.active?'<button type="button" class="ri-btn small danger" data-rpmv-disable="'+esc(method.id)+'">Desactivar</button>':'<button type="button" class="ri-btn small" data-rpmv-enable="'+esc(method.id)+'">Activar</button>')+'</div></div>').join('');
    body.innerHTML='<div class="rpmv-list">'+(list||'<div class="rpmv-empty">Aún no hay métodos configurados.</div>')+'</div><form id="rpmvForm" class="rpmv-form"><label>Nombre<input id="rpmvName" maxlength="80" placeholder="Ej. Nequi" required></label><label>Tipo<select id="rpmvKind"><option value="EFECTIVO">Efectivo</option><option value="TRANSFERENCIA">Transferencia / QR</option><option value="TARJETA">Tarjeta</option><option value="CREDITO">Crédito</option></select></label><label>Caja / banco<select id="rpmvAccount"></select></label><label class="rpmv-check"><input id="rpmvActive" type="checkbox" checked> Activo</label><div class="rpmv-form-buttons"><button type="button" class="ri-btn" id="rpmvCancel" hidden>Cancelar edición</button><button type="submit" class="ri-btn primary">Guardar método</button></div></form><details class="rpmv-bank"><summary>+ Crear cuenta / billetera para transferencias</summary><form id="rpmvBankForm" class="rpmv-bank-form"><label>Nombre<input id="rpmvBankName" maxlength="120" placeholder="Ej. Nequi" required></label><label>Banco / billetera<input id="rpmvBankBrand" maxlength="120" placeholder="Ej. Nequi"></label><label>Número / referencia<input id="rpmvBankNumber" maxlength="80" placeholder="Opcional"></label><button type="submit" class="ri-btn">Crear</button></form></details>';

    const kind=$('#rpmvKind',body),account=$('#rpmvAccount',body);
    const refreshAccount=(selected='')=>{account.innerHTML=accountOptions(kind.value,selected);account.disabled=kind.value==='CREDITO'};
    refreshAccount();
    kind.addEventListener('change',()=>refreshAccount());

    $$('[data-rpmv-edit]',body).forEach((button)=>button.addEventListener('click',()=>{
      const method=methods.find((row)=>row.id===button.dataset.rpmvEdit);if(!method)return;
      editingId=method.id;$('#rpmvName',body).value=method.name;kind.value=method.kind;refreshAccount(method.cajaBancoId||'');$('#rpmvActive',body).checked=method.active!==false;$('#rpmvCancel',body).hidden=false;$('#rpmvName',body).focus();
    }));
    $('#rpmvCancel',body).addEventListener('click',()=>{editingId=null;$('#rpmvForm',body).reset();kind.value='EFECTIVO';refreshAccount();$('#rpmvCancel',body).hidden=true});

    $$('[data-rpmv-disable]',body).forEach((button)=>button.addEventListener('click',async()=>{
      if(!confirm('¿Desactivar este método de pago?'))return;
      await api('/api/v1/restaurante/metodos-pago/'+button.dataset.rpmvDisable,{method:'DELETE'});await load();syncPaymentPanel();render(dialog);
    }));
    $$('[data-rpmv-enable]',body).forEach((button)=>button.addEventListener('click',async()=>{
      const method=methods.find((row)=>row.id===button.dataset.rpmvEnable);if(!method)return;
      await api('/api/v1/restaurante/metodos-pago/'+method.id,{method:'PATCH',body:JSON.stringify({name:method.name,kind:method.kind,cajaBancoId:method.cajaBancoId||null,active:true,sortOrder:method.sortOrder||100})});await load();syncPaymentPanel();render(dialog);
    }));

    $('#rpmvForm',body).addEventListener('submit',async(event)=>{
      event.preventDefault();
      const payload={name:$('#rpmvName',body).value.trim(),kind:kind.value,cajaBancoId:kind.value==='CREDITO'?null:(account.value||null),active:$('#rpmvActive',body).checked,sortOrder:editingId?(methods.find((row)=>row.id===editingId)?.sortOrder||100):100};
      const path=editingId?'/api/v1/restaurante/metodos-pago/'+editingId:'/api/v1/restaurante/metodos-pago';
      await api(path,{method:editingId?'PATCH':'POST',body:JSON.stringify(payload)});editingId=null;await load();syncPaymentPanel();render(dialog);
    });

    $('#rpmvBankForm',body).addEventListener('submit',async(event)=>{
      event.preventDefault();
      await api('/api/v1/tesoreria/cajas-bancos',{method:'POST',body:JSON.stringify({tipo:'BANCO',nombre:$('#rpmvBankName',body).value.trim(),banco:$('#rpmvBankBrand',body).value.trim()||null,numeroCuenta:$('#rpmvBankNumber',body).value.trim()||null,saldoActual:0,activo:true})});
      await load();render(dialog);
    });
  }

  async function openManager(){
    ensureStyles();
    const dialog=ensureDialog();
    const body=$('.rpmv-body',dialog);
    body.innerHTML='<div class="rpmv-empty">Cargando métodos de pago…</div>';
    if(typeof dialog.showModal==='function'&&!dialog.open) dialog.showModal(); else dialog.setAttribute('open','');
    try{await load();render(dialog)}catch(error){body.innerHTML='<div class="ri-error">'+esc(error.message)+'</div>'}
  }

  function ensureShortcut(){
    ensureStyles();
    const shell=$('#view .cash-shell');
    if(!shell){$('#rpmvShortcut')?.remove();return}
    const head=$('.cash-page-head',shell);
    if(!head)return;
    if(!canManage()){$('#rpmvShortcut')?.remove();return}
    if($('#rpmvShortcut'))return;
    const button=document.createElement('button');
    button.type='button';button.id='rpmvShortcut';button.className='rpmv-shortcut';button.dataset.rpmvManage='true';button.textContent='⚙ Métodos de pago';
    head.appendChild(button);
  }

  let queued=false;
  let burstToken=0;
  function schedule(){
    if(queued)return;
    queued=true;
    queueMicrotask(()=>{queued=false;ensureShortcut()});
  }
  function scheduleBurst(){
    const token=++burstToken;
    [0,80,180,400,800,1400,2400,4000].forEach((delay)=>{
      setTimeout(()=>{if(token!==burstToken)return;schedule()},delay);
    });
  }

  document.addEventListener('click',(event)=>{
    const manage=event.target.closest?.('[data-rpmv-manage]');
    if(manage){event.preventDefault();openManager().catch((error)=>alert(error.message))}
    const target=event.target.closest?.('[data-tab="caja"],[data-cc-tab="caja"],.cash-shell button,.cash-shell summary,[data-rpmv-manage]');
    if(target)scheduleBurst();
  },true);
  window.addEventListener('vantix:tenant-realtime',scheduleBurst);
  window.addEventListener('vantix:tenant-realtime-ready',scheduleBurst);
  window.addEventListener('popstate',scheduleBurst);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scheduleBurst,{once:true});else scheduleBurst();
})();
`;

function installPaymentMethodsVisibilityRuntime(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/app/restaurant-ui.js') return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source && !source.includes(PAYMENT_METHODS_VISIBILITY_MARKER)) {
      const patched = `${source}\n;${paymentMethodsVisibilityRuntime}\n`;
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
    }
    res.set('X-VantixGC-Payment-Methods-Visibility', 'v2-caja-header');
    return originalSend(body);
  };
  return next();
}

module.exports = {
  PAYMENT_METHODS_VISIBILITY_MARKER,
  paymentMethodsVisibilityRuntime,
  installPaymentMethodsVisibilityRuntime
};
