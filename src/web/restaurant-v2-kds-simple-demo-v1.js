/* VANTIX_DEMO_RESTAURANTE_PRODUCTION_SIMPLE_V1 · VANTIX_DEMO_PRODUCTION_BAR_LAYOUT_V1 */
(()=>{'use strict';
const MARKER='VANTIX_DEMO_RESTAURANTE_PRODUCTION_SIMPLE_V1';
const LAYOUT_MARKER='VANTIX_DEMO_PRODUCTION_BAR_LAYOUT_V1';
const TENANT='demo-restaurante';
const RV2=window.RestaurantV2;
if(!RV2)return;
const session=RV2.readSession?.()||RV2.requireSession?.();
if(String(session?.subdomain||'').trim().toLowerCase()!==TENANT)return;

document.body.dataset.kdsSimpleDemo='1';
document.body.dataset.productionBarLayout='1';
document.documentElement.dataset.kdsSimpleDemo=MARKER;
document.documentElement.dataset.productionBarLayout=LAYOUT_MARKER;

let scheduled=false;
let applying=false;

function injectStyles(){
  if(document.querySelector('#kdsSimpleDemoStyles'))return;
  const style=document.createElement('style');
  style.id='kdsSimpleDemoStyles';
  style.textContent=`
body[data-kds-simple-demo="1"]{overflow:hidden;background:#e9eeeb}
body[data-kds-simple-demo="1"] .kds-top{position:fixed!important;inset:0 0 auto 0!important;z-index:40!important;min-height:72px!important;padding:11px 16px!important;background:linear-gradient(180deg,#353d40,#272e31)!important;border-bottom:1px solid #161b1d!important;color:#fff!important;box-shadow:0 7px 20px rgba(15,23,42,.18)!important}
body[data-kds-simple-demo="1"] .kds-top>div>span{color:#bfc9c4!important}
body[data-kds-simple-demo="1"] .kds-top h1{margin:1px 0!important;color:#fff!important;font-size:24px!important}
body[data-kds-simple-demo="1"] .kds-top p{color:#cbd5d0!important}
body[data-kds-simple-demo="1"] .kds-top nav{align-self:center!important}
body[data-kds-simple-demo="1"] .kds-top nav>a{display:none!important}
body[data-kds-simple-demo="1"] .kds-top nav .rv2-btn{min-height:40px!important;border-color:#5b6762!important;background:#414a4d!important;color:#fff!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.08)!important}
body[data-kds-simple-demo="1"] .kds-top nav .rv2-btn:hover{background:#4a5558!important}
body[data-kds-simple-demo="1"] .kds-top nav .rv2-station-manage{border-color:#3c9a70!important;background:#0d6b43!important;color:#fff!important}
body[data-kds-simple-demo="1"] .kds-main{box-sizing:border-box!important;max-width:none!important;height:100vh!important;margin:0!important;padding:82px 10px 10px!important;overflow:hidden!important}
body[data-kds-simple-demo="1"] .status-line{height:38px!important;margin:0 0 8px!important;padding:8px 11px!important;border-radius:10px!important;background:#fff!important}
body[data-kds-simple-demo="1"] .stats{display:none!important}
body[data-kds-simple-demo="1"] .station-warning{display:none!important}
body[data-kds-simple-demo="1"] .board{display:none!important}
body[data-kds-simple-demo="1"] .bar-production-layout{display:grid;grid-template-columns:245px minmax(420px,1fr) 355px;gap:9px;height:calc(100vh - 138px);min-height:0}
body[data-kds-simple-demo="1"] .bar-stations-panel,
body[data-kds-simple-demo="1"] .bar-work-panel,
body[data-kds-simple-demo="1"] .bar-ready-panel{min-width:0;min-height:0;border:1px solid #cfd8d3;border-radius:14px;background:#fff;overflow:hidden;box-shadow:0 3px 12px rgba(15,23,42,.05)}
body[data-kds-simple-demo="1"] .bar-stations-panel{display:flex;flex-direction:column}
body[data-kds-simple-demo="1"] .bar-panel-title{padding:12px 13px;border-bottom:1px solid #dce4df;background:linear-gradient(180deg,#fafcfb,#f4f7f5)}
body[data-kds-simple-demo="1"] .bar-panel-title small{display:block;color:#738079;font-size:9px;font-weight:950;letter-spacing:.12em}
body[data-kds-simple-demo="1"] .bar-panel-title b{display:block;margin-top:3px;font-size:16px;color:#17211c}
body[data-kds-simple-demo="1"] .queue-tabs{display:flex!important;flex:1!important;min-height:0!important;flex-direction:column!important;gap:7px!important;overflow-y:auto!important;overflow-x:hidden!important;padding:8px!important}
body[data-kds-simple-demo="1"] .queue-tab{width:100%!important;min-width:0!important;flex:0 0 auto!important;padding:13px 12px!important;border:1px solid #cfd8d3!important;border-radius:11px!important;background:#fff!important;box-shadow:none!important}
body[data-kds-simple-demo="1"] .queue-tab:hover{border-color:#8fac9e!important;background:#f6faf8!important}
body[data-kds-simple-demo="1"] .queue-tab.active{border-color:#0d6b43!important;background:linear-gradient(180deg,#167a54,#0d6b43)!important;color:#fff!important;box-shadow:0 5px 14px rgba(13,107,67,.18)!important}
body[data-kds-simple-demo="1"] .queue-tab b{font-size:15px!important;color:inherit!important}
body[data-kds-simple-demo="1"] .queue-tab small{margin-top:4px!important;font-size:10px!important;color:#6d7973!important}
body[data-kds-simple-demo="1"] .queue-tab.active small{color:#d7ebe1!important}
body[data-kds-simple-demo="1"] .bar-work-panel,
body[data-kds-simple-demo="1"] .bar-ready-panel{display:flex}
body[data-kds-simple-demo="1"] .bar-work-panel>.lane,
body[data-kds-simple-demo="1"] .bar-ready-panel>.lane{display:flex!important;flex:1!important;min-width:0!important;min-height:0!important;height:100%!important;border:0!important;border-radius:0!important;background:#fff!important;overflow:hidden!important;flex-direction:column!important}
body[data-kds-simple-demo="1"] .bar-work-panel>.lane>header,
body[data-kds-simple-demo="1"] .bar-ready-panel>.lane>header{flex:0 0 auto!important;padding:13px 14px!important;background:linear-gradient(180deg,#fafcfb,#f4f7f5)!important}
body[data-kds-simple-demo="1"] .bar-work-panel>.lane h2,
body[data-kds-simple-demo="1"] .bar-ready-panel>.lane h2{font-size:18px!important}
body[data-kds-simple-demo="1"] .bar-work-panel .tickets,
body[data-kds-simple-demo="1"] .bar-ready-panel .tickets{display:grid!important;grid-template-columns:1fr!important;align-content:start!important;gap:8px!important;min-height:0!important;overflow-y:auto!important;padding:9px!important}
body[data-kds-simple-demo="1"] .ticket{padding:14px!important;border-radius:11px!important;border-color:#d8e0dc!important;box-shadow:0 2px 8px rgba(15,23,42,.04)!important}
body[data-kds-simple-demo="1"] .ticket-head h3{font-size:20px!important}
body[data-kds-simple-demo="1"] .item{font-size:15px!important}
body[data-kds-simple-demo="1"] .item strong{font-size:19px!important}
body[data-kds-simple-demo="1"] .ticket-action{min-height:50px!important;font-size:16px!important;font-weight:950!important;border-radius:10px!important}
body[data-kds-simple-demo="1"] .ticket-cancel{background:#fff!important;color:#991b1b!important;border-color:#fecaca!important;font-size:11px!important}
body[data-kds-simple-demo="1"] .state{background:#edf7f1!important;color:#0d6b43!important}
body[data-kds-simple-demo="1"] .ticket.EN_PREPARACION{border-left-color:#0d6b43!important;background:linear-gradient(90deg,#eefaf3,#fff 25%)!important}
body[data-kds-simple-demo="1"] .ticket.LISTA{border-left-color:#0d6b43!important;background:linear-gradient(90deg,#eefaf3,#fff 25%)!important}
body[data-kds-simple-demo="1"] .simple-delivered{background:#fff!important;color:#0d6b43!important;border:1px solid #9fd1ba!important}
body[data-kds-simple-demo="1"] .empty{min-height:150px!important}
@media(max-width:1180px){
  body[data-kds-simple-demo="1"] .bar-production-layout{grid-template-columns:210px minmax(360px,1fr) 300px}
}
@media(max-width:900px){
  body[data-kds-simple-demo="1"]{overflow:auto}
  body[data-kds-simple-demo="1"] .kds-top{position:sticky!important}
  body[data-kds-simple-demo="1"] .kds-main{height:auto!important;padding:9px!important;overflow:visible!important}
  body[data-kds-simple-demo="1"] .bar-production-layout{height:auto;grid-template-columns:1fr 1fr;grid-template-areas:"stations stations" "work ready"}
  body[data-kds-simple-demo="1"] .bar-stations-panel{grid-area:stations}
  body[data-kds-simple-demo="1"] .bar-work-panel{grid-area:work}
  body[data-kds-simple-demo="1"] .bar-ready-panel{grid-area:ready}
  body[data-kds-simple-demo="1"] .queue-tabs{flex-direction:row!important;overflow-x:auto!important;overflow-y:hidden!important}
  body[data-kds-simple-demo="1"] .queue-tab{width:auto!important;min-width:145px!important}
  body[data-kds-simple-demo="1"] .bar-work-panel>.lane,
  body[data-kds-simple-demo="1"] .bar-ready-panel>.lane{min-height:430px!important}
}
@media(max-width:650px){
  body[data-kds-simple-demo="1"] .bar-production-layout{grid-template-columns:1fr;grid-template-areas:"stations" "work" "ready"}
  body[data-kds-simple-demo="1"] .bar-work-panel>.lane,
  body[data-kds-simple-demo="1"] .bar-ready-panel>.lane{min-height:320px!important}
}
`;
  document.head.appendChild(style);
}

function schedule(){
  if(scheduled)return;
  scheduled=true;
  requestAnimationFrame(()=>{scheduled=false;apply().catch(()=>{})});
}

async function setReady(ticket,button){
  const id=button.dataset.command;
  if(!id||button.disabled)return;
  button.disabled=true;
  button.textContent='Guardando…';
  try{
    if(ticket.classList.contains('PENDIENTE')){
      await RV2.api(`/api/v1/restaurante/v2/kds/comandas/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({state:'EN_PREPARACION'})});
    }
    await RV2.api(`/api/v1/restaurante/v2/kds/comandas/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({state:'LISTA'})});
    document.querySelector('#refresh')?.click();
  }catch(error){
    alert(error?.message||'No fue posible marcar el pedido como listo.');
    button.disabled=false;
    button.textContent='✓ LISTO';
  }
}

async function setDelivered(ticket,button){
  const id=button.dataset.command;
  if(!id||button.disabled)return;
  button.disabled=true;
  button.textContent='Guardando…';
  try{
    await RV2.api(`/api/v1/restaurante/v2/kds/comandas/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({state:'ENTREGADA'})});
    document.querySelector('#refresh')?.click();
  }catch(error){
    alert(error?.message||'No fue posible marcar como entregado.');
    button.disabled=false;
    button.textContent='✓ Entregado';
  }
}

function simplifyAction(ticket){
  const old=ticket.querySelector('[data-command]');
  if(!old||old.dataset.simpleDemo==='1')return;
  const fresh=old.cloneNode(true);
  fresh.dataset.simpleDemo='1';
  if(ticket.classList.contains('PENDIENTE')||ticket.classList.contains('EN_PREPARACION')){
    fresh.dataset.state='LISTA';
    fresh.textContent='✓ LISTO';
    fresh.classList.add('rv2-btn-primary');
    fresh.addEventListener('click',()=>setReady(ticket,fresh));
  }else if(ticket.classList.contains('LISTA')){
    fresh.dataset.state='ENTREGADA';
    fresh.textContent='✓ Entregado';
    fresh.classList.remove('rv2-btn-primary');
    fresh.classList.add('simple-delivered');
    fresh.addEventListener('click',()=>setDelivered(ticket,fresh));
  }
  old.replaceWith(fresh);
}

function relabelQueues(){
  let firstVisible=null;
  let activeHidden=false;
  document.querySelectorAll('#queues .queue-tab').forEach(tab=>{
    const title=tab.querySelector('b');
    const small=tab.querySelector('small');
    const queueName=title?.dataset.queueLabel||title?.textContent?.trim()||'Estación';
    const configured=small?.textContent?.replace(/^★ Principal · /,'').trim()||'';
    const hasStation=Boolean(configured&&configured!=='Sin KDS configurado');
    if(!hasStation){
      if(tab.classList.contains('active'))activeHidden=true;
      tab.style.display='none';
      tab.dataset.simpleConfigured='0';
      return;
    }
    tab.style.removeProperty('display');
    tab.dataset.simpleConfigured='1';
    if(!firstVisible)firstVisible=tab;
    if(title){
      if(!title.dataset.queueLabel)title.dataset.queueLabel=queueName;
      title.textContent=configured;
    }
    if(small)small.textContent=queueName;
    tab.dataset.simpleLabeled='1';
  });
  if(activeHidden&&firstVisible&&!firstVisible.classList.contains('active')){
    queueMicrotask(()=>firstVisible.click());
  }
}

function ensureBarLayout(){
  const main=document.querySelector('.kds-main');
  const queues=document.querySelector('#queues');
  const pendingLane=document.querySelector('#pendingLane')?.closest('.lane');
  const readyLane=document.querySelector('#readyLane')?.closest('.lane');
  if(!main||!queues||!pendingLane||!readyLane)return;

  let layout=main.querySelector('[data-bar-production-layout]');
  if(!layout){
    layout=document.createElement('section');
    layout.className='bar-production-layout';
    layout.dataset.barProductionLayout=LAYOUT_MARKER;

    const stations=document.createElement('aside');
    stations.className='bar-stations-panel';
    stations.innerHTML='<div class="bar-panel-title"><small>ESTACIONES</small><b>Áreas de producción</b></div>';

    const work=document.createElement('section');
    work.className='bar-work-panel';

    const ready=document.createElement('section');
    ready.className='bar-ready-panel';

    stations.appendChild(queues);
    work.appendChild(pendingLane);
    ready.appendChild(readyLane);
    layout.append(stations,work,ready);
    main.appendChild(layout);
  }else{
    const stations=layout.querySelector('.bar-stations-panel');
    const work=layout.querySelector('.bar-work-panel');
    const ready=layout.querySelector('.bar-ready-panel');
    if(stations&&!stations.contains(queues))stations.appendChild(queues);
    if(work&&!work.contains(pendingLane))work.appendChild(pendingLane);
    if(ready&&!ready.contains(readyLane))ready.appendChild(readyLane);
  }
}

function selectedStationName(){
  return document.querySelector('#queues .queue-tab.active b')?.textContent?.trim()||'Estación';
}

function apply(){
  if(applying)return Promise.resolve();
  applying=true;
  try{
    injectStyles();
    const h1=document.querySelector('.kds-top h1');
    const eyebrow=document.querySelector('.kds-top>div>span');
    const manageButton=document.querySelector('[data-rv2-stations-v23]');
    if(h1)h1.textContent='Producción';
    if(eyebrow)eyebrow.textContent='VANTIX RESTAURANTE · PRODUCCIÓN';
    if(manageButton){manageButton.textContent='⚙ Estaciones';manageButton.title='Crear, editar o eliminar estaciones';}
    relabelQueues();

    const prepArticle=document.querySelector('#preparingCount')?.closest('article');
    const activeArticle=document.querySelector('#activeCount')?.closest('article');
    if(prepArticle)prepArticle.style.display='none';
    if(activeArticle)activeArticle.style.display='none';

    const pendingArticle=document.querySelector('#pendingCount')?.closest('article');
    const readyArticle=document.querySelector('#readyCount')?.closest('article');
    pendingArticle?.querySelector('small')&&(pendingArticle.querySelector('small').textContent='POR PREPARAR');
    readyArticle?.querySelector('small')&&(readyArticle.querySelector('small').textContent='LISTOS');

    const pendingLane=document.querySelector('#pendingLane')?.closest('.lane');
    const preparingLane=document.querySelector('#preparingLane')?.closest('.lane');
    const readyLane=document.querySelector('#readyLane')?.closest('.lane');
    if(pendingLane){
      pendingLane.querySelector('small')&&(pendingLane.querySelector('small').textContent='ESTACIÓN · '+selectedStationName());
      pendingLane.querySelector('h2')&&(pendingLane.querySelector('h2').textContent='Por preparar');
    }
    if(readyLane){
      readyLane.querySelector('small')&&(readyLane.querySelector('small').textContent='SALIDA');
      readyLane.querySelector('h2')&&(readyLane.querySelector('h2').textContent='Listos para recoger');
    }
    if(preparingLane)preparingLane.style.display='none';

    const pending=document.querySelector('#pendingLane');
    const preparing=document.querySelector('#preparingLane');
    if(pending&&preparing){
      [...preparing.querySelectorAll('.ticket')].forEach(ticket=>pending.appendChild(ticket));
      const count=pending.querySelectorAll('.ticket').length;
      if(count)pending.querySelector('.empty')?.remove();
      const pendingCount=document.querySelector('#pendingCount');
      const pendingBadge=document.querySelector('#pendingBadge');
      if(pendingCount)pendingCount.textContent=String(count);
      if(pendingBadge)pendingBadge.textContent=String(count);
      if(!count)pending.innerHTML='<div class="empty">Sin pedidos por preparar.</div>';
    }

    document.querySelectorAll('.ticket.PENDIENTE,.ticket.EN_PREPARACION').forEach(ticket=>{
      const state=ticket.querySelector('.state');
      if(state)state.textContent='POR PREPARAR';
      simplifyAction(ticket);
    });
    document.querySelectorAll('.ticket.LISTA').forEach(ticket=>{
      const state=ticket.querySelector('.state');
      if(state)state.textContent='LISTO';
      simplifyAction(ticket);
    });

    ensureBarLayout();

    const notice=document.querySelector('#notice');
    if(notice){
      notice.dataset.simpleDemo='1';
      notice.textContent='Selecciona una estación y trabaja sus pedidos. Un toque en ✓ LISTO.';
    }
  }finally{
    applying=false;
  }
  return Promise.resolve();
}

const observer=new MutationObserver(schedule);
function start(){
  injectStyles();
  apply();
  observer.observe(document.body,{childList:true,subtree:true});
  window.addEventListener('vantix:tenant-realtime',schedule);
  window.addEventListener('vantix:restaurant-v2:stations-changed',schedule);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
window.VantixDemoRestaurantProductionSimpleV1=Object.freeze({marker:MARKER,layoutMarker:LAYOUT_MARKER,tenant:TENANT,refresh:schedule});
})();