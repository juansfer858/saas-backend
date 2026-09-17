'use strict';

const MARKER = 'VANTIX_RESTAURANT_EXPENSES_DAILY_SALES_V116';

const runtime = String.raw`
;(()=>{
  'use strict';
  const MARKER='VANTIX_RESTAURANT_EXPENSES_DAILY_SALES_V116';
  if(window[MARKER])return;
  window[MARKER]=Object.freeze({version:'116.0.1',basicExpenses:true,dailySalesXls:true});
  const SESSION_KEY='vantixgc_core_session_v1';
  const $=(q,r=document)=>r.querySelector(q);
  const money=(v)=>new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(v||0));
  const businessDate=()=>new Date(Date.now()-300*60000).toISOString().slice(0,10);
  function auth(){try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{return null}}
  function allowed(){const role=String(auth()?.user?.rol||'').toUpperCase();return ['SUPERADMIN','ADMIN','CAJERO'].includes(role)||Boolean($('#rail [data-tab="caja"]'))}
  async function api(path,opts={}){const s=auth();if(!s?.token)throw new Error('Sesión no disponible');const headers={'Content-Type':'application/json',Authorization:'Bearer '+s.token,'x-tenant-subdomain':s.subdomain,...(opts.headers||{})};const r=await fetch(path,{...opts,headers,cache:'no-store'});let b={};try{b=await r.json()}catch{}if(!r.ok)throw new Error(b?.error?.message||b?.message||('HTTP '+r.status));return b.data}
  function ensureStyle(){if($('#vantixExpensesV116Style'))return;const s=document.createElement('style');s.id='vantixExpensesV116Style';s.textContent='.expense-v116-button{width:100%;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;text-align:center}.expense-v116-dialog{width:min(880px,calc(100vw - 24px));max-height:90vh;border:0;border-radius:20px;padding:0;box-shadow:0 28px 80px rgba(15,23,42,.3)}.expense-v116-dialog::backdrop{background:rgba(15,23,42,.55)}.expense-v116-head{display:flex;justify-content:space-between;gap:14px;align-items:center;padding:18px 20px;border-bottom:1px solid #e5e7eb}.expense-v116-body{padding:18px 20px;display:grid;gap:16px}.expense-v116-grid{display:grid;grid-template-columns:1.5fr .8fr .8fr 1fr;gap:10px}.expense-v116-field{display:grid;gap:5px}.expense-v116-field label{font-size:11px;font-weight:850;color:#64748b;text-transform:uppercase}.expense-v116-field input,.expense-v116-field select{width:100%;min-height:44px;border:1px solid #cbd5e1;border-radius:10px;padding:8px 10px;background:#fff}.expense-v116-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}.expense-v116-btn{min-height:42px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;padding:8px 13px;font-weight:800;cursor:pointer}.expense-v116-btn.primary{background:#0d6b43;border-color:#0d6b43;color:#fff}.expense-v116-msg{min-height:20px;font-size:12px}.expense-v116-list{border:1px solid #e2e8f0;border-radius:13px;overflow:hidden}.expense-v116-row{display:grid;grid-template-columns:1fr 1.7fr .8fr .9fr;gap:8px;padding:9px 11px;border-top:1px solid #eef2f7;font-size:12px}.expense-v116-row:first-child{border-top:0}.expense-v116-row.head{font-weight:850;background:#f8fafc;color:#475569}.expense-v116-total{display:flex;justify-content:flex-end;gap:20px;font-weight:900}.daily-sales-v116{margin-left:8px}@media(max-width:700px){.expense-v116-grid{grid-template-columns:1fr}.expense-v116-row{grid-template-columns:1fr 1fr}.expense-v116-row.head{display:none}.expense-v116-actions{justify-content:stretch}.expense-v116-btn{flex:1}}';document.head.appendChild(s)}
  function ensureDialog(){let d=$('#expenseV116Dialog');if(d)return d;ensureStyle();d=document.createElement('dialog');d.id='expenseV116Dialog';d.className='expense-v116-dialog';d.innerHTML='<div class="expense-v116-head"><div><b style="font-size:18px">Gastos</b><div style="font-size:12px;color:#64748b">Gastos básicos del turno · Efectivo o Transferencia</div></div><button type="button" id="expenseV116Close" class="expense-v116-btn">Cerrar</button></div><div class="expense-v116-body"><div class="expense-v116-grid"><div class="expense-v116-field"><label>Concepto</label><input id="expenseV116Concept" maxlength="240" placeholder="Ej. compra de hielo"></div><div class="expense-v116-field"><label>Valor</label><input id="expenseV116Amount" type="number" min="1" step="1" placeholder="0"></div><div class="expense-v116-field"><label>Medio</label><select id="expenseV116Method"><option value="EFECTIVO">Efectivo</option><option value="TRANSFERENCIA">Transferencia</option></select></div><div class="expense-v116-field"><label>Cuenta</label><select id="expenseV116Account"></select></div></div><div id="expenseV116Shift" style="font-size:12px;color:#64748b"></div><div id="expenseV116Msg" class="expense-v116-msg"></div><div class="expense-v116-actions"><button type="button" id="expenseV116Download" class="expense-v116-btn">Descargar ventas del día</button><button type="button" id="expenseV116Save" class="expense-v116-btn primary">Registrar gasto</button></div><div id="expenseV116List" class="expense-v116-list"></div><div id="expenseV116Totals" class="expense-v116-total"></div></div>';document.body.appendChild(d);$('#expenseV116Close',d).onclick=()=>d.close();$('#expenseV116Method',d).onchange=()=>loadContext().catch(showError);$('#expenseV116Save',d).onclick=saveExpense;$('#expenseV116Download',d).onclick=()=>downloadSales(businessDate());return d}
  let ctx=null;
  function showError(e){const el=$('#expenseV116Msg');if(el){el.style.color='#b42318';el.textContent=e?.message||String(e)}}
  function showOk(m){const el=$('#expenseV116Msg');if(el){el.style.color='#166534';el.textContent=m}}
  async function loadContext(){ctx=await api('/api/v1/restaurante/gastos-v116/contexto');const method=$('#expenseV116Method')?.value||'EFECTIVO',select=$('#expenseV116Account');if(!select)return;const accounts=method==='EFECTIVO'?(ctx.cashAccount?[ctx.cashAccount]:[]):ctx.bankAccounts||[];select.innerHTML=accounts.length?accounts.map(a=>'<option value="'+a.id+'">'+String(a.nombre||a.tipo).replace(/[<>&"]/g,'')+'</option>').join(''):'<option value="">Sin cuenta disponible</option>';const line=$('#expenseV116Shift');if(line)line.textContent=ctx.shift?'Turno abierto · '+(ctx.shift.cajaBanco?.nombre||'Caja')+' · gastos en efectivo reducen el efectivo esperado del cierre.':'No hay turno abierto. Abra Caja para registrar gastos.'}
  async function loadExpenses(){const data=await api('/api/v1/restaurante/gastos-v116?date='+encodeURIComponent(businessDate()));const root=$('#expenseV116List');if(root){root.innerHTML='<div class="expense-v116-row head"><span>Hora</span><span>Concepto</span><span>Medio</span><span style="text-align:right">Valor</span></div>'+(data.items||[]).map(x=>'<div class="expense-v116-row"><span>'+new Date(x.creadoEn).toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'})+'</span><span>'+String(x.concepto||'Gasto').replace(/[<>&"]/g,'')+'</span><span>'+x.medio+'</span><span style="text-align:right"><b>'+money(x.valor)+'</b></span></div>').join('')+(data.items?.length?'':'<div style="padding:18px;text-align:center;color:#64748b">Sin gastos registrados hoy.</div>')};const totals=$('#expenseV116Totals');if(totals)totals.innerHTML='<span>Efectivo: '+money(data.totals?.cash)+'</span><span>Transferencia: '+money(data.totals?.transfer)+'</span><span>Total: '+money(data.totals?.total)+'</span>'}
  async function openExpenses(){const d=ensureDialog();showOk('');await Promise.all([loadContext(),loadExpenses()]);if(!d.open)d.showModal()}
  async function saveExpense(){try{const concepto=$('#expenseV116Concept').value.trim(),monto=Number($('#expenseV116Amount').value||0),medio=$('#expenseV116Method').value,cajaBancoId=$('#expenseV116Account').value||null;if(!concepto)throw new Error('Indique el concepto del gasto');if(!(monto>0))throw new Error('Indique un valor mayor que cero');await api('/api/v1/restaurante/gastos-v116',{method:'POST',body:JSON.stringify({concepto,monto,medio,cajaBancoId})});$('#expenseV116Concept').value='';$('#expenseV116Amount').value='';showOk('Gasto registrado. Caja/Banco y cierre actualizados.');await Promise.all([loadContext(),loadExpenses()]);window.dispatchEvent(new CustomEvent('vantix:tenant-realtime'))}catch(e){showError(e)}}
  async function downloadSales(date){try{const s=auth();if(!s?.token)throw new Error('Sesión no disponible');const r=await fetch('/api/v1/restaurante/reportes/ventas-dia-v116.xls?date='+encodeURIComponent(date),{cache:'no-store',headers:{Authorization:'Bearer '+s.token,'x-tenant-subdomain':s.subdomain}});if(!r.ok){let b={};try{b=await r.json()}catch{}throw new Error(b?.error?.message||b?.message||('HTTP '+r.status))}const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='Ventas_'+date+'.xls';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e){showError(e);alert(e.message||String(e))}}
  function ensureRail(){if(!allowed())return;const rail=$('#rail');if(!rail||$('#expenseV116Rail'))return;const b=document.createElement('button');b.type='button';b.id='expenseV116Rail';b.className='rail-ticket expense-v116-button';b.textContent='Gastos';b.onclick=()=>openExpenses().catch(showError);rail.appendChild(b)}
  function ensureCloseDownload(){if(!allowed())return;const panel=$('.cash-close-panel');if(!panel||$('#dailySalesV116',panel))return;const anchor=$('#closeShift',panel)||panel.querySelector('button');const b=document.createElement('button');b.type='button';b.id='dailySalesV116';b.className='ri-btn small daily-sales-v116';b.textContent='Descargar ventas del día';b.onclick=()=>downloadSales(businessDate());if(anchor?.parentElement)anchor.parentElement.appendChild(b);else panel.appendChild(b)}
  function enhance(){ensureStyle();ensureDialog();ensureRail();ensureCloseDownload()}
  let burst=0;
  function schedule(){const token=++burst;[0,40,120,300,700,1400,2500,4000].forEach(delay=>setTimeout(()=>{if(token===burst)enhance()},delay))}
  document.addEventListener('click',(event)=>{if(event.target?.closest?.('[data-tab],#closeShift,[data-cc-tab="caja"],[data-cash-table],[data-cash-metric],[data-cash-metric-back]'))schedule()},true);
  window.addEventListener('vantix:tenant-realtime',schedule);
  window.addEventListener('vantix:tenant-realtime-ready',schedule);
  window.addEventListener('pageshow',schedule);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});else schedule();
})();
`;

function installRestaurantExpensesV116(req, res, next) {
  if (req.method !== 'GET') return next();
  if (req.path === '/app/restaurant-control-center.js') {
    const originalSend = res.send.bind(res);
    res.send = (body) => {
      const isBuffer = Buffer.isBuffer(body);
      const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
      if (source && !source.includes(MARKER)) {
        const patched = `${source}\n;${runtime}\n`;
        body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
      }
      res.set('Cache-Control', 'no-store');
      res.set('X-VantixGC-Restaurant-Expenses', 'v116-control-center');
      return originalSend(body);
    };
    return next();
  }
  if (req.path !== '/app/restaurant-ui.js') return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source && !source.includes(MARKER)) {
      const patched = `${source}\n;${runtime}\n`;
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
    }
    res.set('X-VantixGC-Restaurant-Expenses', 'v116');
    return originalSend(body);
  };
  return next();
}

module.exports = { MARKER, runtime, installRestaurantExpensesV116 };
