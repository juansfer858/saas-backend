/* VANTIX_DEMO_RESTAURANTE_PRODUCTION_SIMPLE_V1 */
(()=>{'use strict';
const MARKER='VANTIX_DEMO_RESTAURANTE_PRODUCTION_SIMPLE_V1';
const TENANT='demo-restaurante';
const RV2=window.RestaurantV2;
if(!RV2)return;
const session=RV2.readSession?.()||RV2.requireSession?.();
if(String(session?.subdomain||'').trim().toLowerCase()!==TENANT)return;

document.body.dataset.kdsSimpleDemo='1';
document.documentElement.dataset.kdsSimpleDemo=MARKER;

let scheduled=false;
let applying=false;

function injectStyles(){
  if(document.querySelector('#kdsSimpleDemoStyles'))return;
  const style=document.createElement('style');
  style.id='kdsSimpleDemoStyles';
  style.textContent=`
body[data-kds-simple-demo="1"] .kds-top nav>a{display:none!important}
body[data-kds-simple-demo="1"] .stats{grid-template-columns:repeat(2,minmax(120px,1fr))}
body[data-kds-simple-demo="1"] #preparingCount{display:none}
body[data-kds-simple-demo="1"] #preparingCount.closest{}
body[data-kds-simple-demo="1"] .board{grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr)}
body[data-kds-simple-demo="1"] .board>.lane:nth-child(2){display:none!important}
body[data-kds-simple-demo="1"] .ticket{padding:14px}
body[data-kds-simple-demo="1"] .ticket-head h3{font-size:20px}
body[data-kds-simple-demo="1"] .item{font-size:15px}
body[data-kds-simple-demo="1"] .item strong{font-size:19px}
body[data-kds-simple-demo="1"] .ticket-action{min-height:48px;font-size:15px;font-weight:950}
body[data-kds-simple-demo="1"] .ticket-cancel{background:#fff!important;color:#991b1b!important;border-color:#fecaca!important;font-size:11px!important}
body[data-kds-simple-demo="1"] .state{background:#edf7f1;color:#0d6b43}
body[data-kds-simple-demo="1"] .ticket.EN_PREPARACION{border-left-color:#0d6b43;background:linear-gradient(90deg,#eefaf3,#fff 25%)}
body[data-kds-simple-demo="1"] .ticket.LISTA{border-left-color:#0d6b43;background:linear-gradient(90deg,#eefaf3,#fff 25%)}
body[data-kds-simple-demo="1"] .simple-delivered{background:#fff!important;color:#0d6b43!important;border:1px solid #9fd1ba!important}
body[data-kds-simple-demo="1"] .queue-tab b{font-size:13px}
body[data-kds-simple-demo="1"] .queue-tab small{font-size:9px}
@media(max-width:980px){body[data-kds-simple-demo="1"] .board{grid-template-columns:1fr}}
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

function apply(){
  if(applying)return Promise.resolve();
  applying=true;
  try{
    injectStyles();
    const h1=document.querySelector('.kds-top h1');
    const eyebrow=document.querySelector('.kds-top>div>span');
    const manageButton=document.querySelector('[data-rv2-stations-v23]');
    if(h1)h1.textContent='Producción';
    if(eyebrow)eyebrow.textContent='RESTAURANTE · PRODUCCIÓN SIMPLE · PILOTO';
    if(manageButton){manageButton.textContent='⚙ Administrar estaciones';manageButton.title='Crear, editar o eliminar estaciones';}
    relabelQueues();

    const prepArticle=document.querySelector('#preparingCount')?.closest('article');
    const activeArticle=document.querySelector('#activeCount')?.closest('article');
    if(prepArticle)prepArticle.style.display='none';
    if(activeArticle)activeArticle.style.display='none';

    const pendingArticle=document.querySelector('#pendingCount')?.closest('article');
    const readyArticle=document.querySelector('#readyCount')?.closest('article');
    pendingArticle?.querySelector('small')&&(pendingArticle.querySelector('small').textContent='POR PREPARAR');
    readyArticle?.querySelector('small')&&(readyArticle.querySelector('small').textContent='LISTOS');

    const lanes=[...document.querySelectorAll('.board>.lane')];
    if(lanes[0]){
      lanes[0].querySelector('small')&&(lanes[0].querySelector('small').textContent='01');
      lanes[0].querySelector('h2')&&(lanes[0].querySelector('h2').textContent='Por preparar');
    }
    if(lanes[2]){
      lanes[2].querySelector('small')&&(lanes[2].querySelector('small').textContent='02');
      lanes[2].querySelector('h2')&&(lanes[2].querySelector('h2').textContent='Listos para recoger');
    }

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

    const notice=document.querySelector('#notice');
    if(notice&&!notice.dataset.simpleDemo){
      notice.dataset.simpleDemo='1';
      notice.textContent='Producción simple activa únicamente para demo-restaurante.';
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
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
window.VantixDemoRestaurantProductionSimpleV1=Object.freeze({marker:MARKER,tenant:TENANT,refresh:schedule});
})();