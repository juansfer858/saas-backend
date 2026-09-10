/* VANTIX_RESTAURANT_V2_UX_V78 */
(()=>{'use strict';
  const MARKER='VANTIX_RESTAURANT_V2_UX_V78';
  const OPEN_MESSAGE='VANTIX_RESTAURANT_V2_OPEN_MODULE_V78';
  const initialPath=location.pathname;
  const titles=new Map([
    ['/app/restaurante-v2/mesas','Mesas'],
    ['/app/restaurante-v2/pedidos','Pedidos'],
    ['/app/restaurante-v2/kds','Cocina / KDS'],
    ['/app/restaurante-v2/caja','Caja'],
    ['/app/restaurante-v2/division','División'],
    ['/app/restaurante-v2/domicilios','Domicilios'],
    ['/app/restaurante-v2/carta','Carta'],
    ['/app/restaurante-v2/empleados','Empleados'],
    ['/app/restaurante-v2/qrs','QR de mesas'],
    ['/app/restaurante-v2/dispositivos','Dispositivos']
  ]);
  document.documentElement.dataset.restaurantV2Ux=MARKER;

  function canonicalTitle(){return titles.get(location.pathname)||null}
  function mainHeader(){return document.querySelector('.kds-top,.rv2-top,.rv2-order-top,.cash-top,.split-top,.menu-top,.admin-top,.rv2-v78-top')}
  function enforceHeader(){
    const title=canonicalTitle();const header=mainHeader();if(!title||!header)return;
    const h1=header.querySelector('h1');if(h1&&h1.textContent.trim()!==title)h1.textContent=title;
    const eyebrow=header.querySelector('span,.eyebrow');if(eyebrow){const expected=`RESTAURANTE V2 · ${title.toUpperCase()}`;if(eyebrow.textContent.trim()!==expected)eyebrow.textContent=expected}
  }
  if(canonicalTitle()){
    enforceHeader();
    const observer=new MutationObserver(enforceHeader);observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
    window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
  }

  function validTableId(value){const text=String(value||'').trim();return /^[A-Za-z0-9_-]{1,120}$/.test(text)?text:''}
  function openContextModule(module,tableId){
    const id=validTableId(tableId);if(!id||!['caja','division'].includes(module))return;
    if(window.parent&&window.parent!==window){window.parent.postMessage({type:OPEN_MESSAGE,module,tableId:id},location.origin);return}
    const route=module==='caja'?'/app/restaurante-v2/caja':'/app/restaurante-v2/division';location.assign(`${route}?tableId=${encodeURIComponent(id)}`);
  }

  function ensureSettleDialog(){
    let dialog=document.getElementById('rv2V78SettleDialog');if(dialog)return dialog;
    dialog=document.createElement('dialog');dialog.id='rv2V78SettleDialog';dialog.className='rv2-v78-settle-dialog';dialog.innerHTML='<div class="rv2-v78-settle-card"><small>CUENTA SOLICITADA</small><h2>¿Cómo se va a cobrar esta mesa?</h2><p>Confirma el tipo de cuenta antes de continuar para evitar liquidar una mesa de forma equivocada.</p><div class="rv2-v78-settle-actions"><button class="rv2-btn rv2-btn-primary" type="button" data-v78-settle="joint">Cuenta conjunta</button><button class="rv2-btn" type="button" data-v78-settle="split">Cuenta dividida</button><button class="rv2-btn cancel" type="button" data-v78-settle="cancel">Cancelar</button></div></div>';
    document.body.appendChild(dialog);
    dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close()});
    return dialog;
  }

  let currentTableId='';
  function upgradeRequestedAccount(){
    if(initialPath!=='/app/restaurante-v2/mesas'||!currentTableId)return;
    const body=document.getElementById('dialogBody');if(!body)return;
    const badge=[...body.querySelectorAll('.rv2-badge,.rv2-status-danger')].find(node=>/CUENTA SOLICITADA/i.test(node.textContent||''));
    if(!badge||badge.dataset.v78Upgraded==='1')return;
    const button=document.createElement('button');button.id='settleRequestedAccount';button.type='button';button.className='rv2-btn rv2-btn-danger';button.dataset.v78Upgraded='1';button.dataset.tableId=currentTableId;button.textContent='CUENTA SOLICITADA';
    badge.replaceWith(button);
  }
  if(initialPath==='/app/restaurante-v2/mesas'){
    document.addEventListener('click',event=>{const card=event.target.closest?.('[data-table]');if(card?.dataset?.table)currentTableId=validTableId(card.dataset.table)||currentTableId},true);
    const body=document.getElementById('dialogBody');if(body){const observer=new MutationObserver(upgradeRequestedAccount);observer.observe(body,{childList:true,subtree:true});window.addEventListener('pagehide',()=>observer.disconnect(),{once:true})}
    document.addEventListener('click',event=>{
      const trigger=event.target.closest?.('#settleRequestedAccount');if(!trigger)return;
      const id=validTableId(trigger.dataset.tableId||currentTableId);if(!id)return;
      const dialog=ensureSettleDialog();dialog.dataset.tableId=id;dialog.showModal();
    });
    document.addEventListener('click',event=>{
      const action=event.target.closest?.('[data-v78-settle]');if(!action)return;
      const dialog=ensureSettleDialog();const id=validTableId(dialog.dataset.tableId);const mode=action.dataset.v78Settle;
      if(mode==='cancel'){dialog.close();return}if(!id)return;
      dialog.close();document.getElementById('tableDialog')?.close?.();openContextModule(mode==='split'?'division':'caja',id);
    });
  }

  function preselectTableFromQuery(){
    if(!['/app/restaurante-v2/caja','/app/restaurante-v2/division'].includes(initialPath))return;
    const params=new URLSearchParams(location.search);const tableId=validTableId(params.get('tableId'));if(!tableId)return;
    let done=false;
    const select=()=>{
      if(done)return true;
      const buttons=[...document.querySelectorAll('#queue [data-table]')];const target=buttons.find(button=>String(button.dataset.table||'')===tableId);if(!target)return false;
      done=true;target.click();const url=new URL(location.href);url.searchParams.delete('tableId');history.replaceState(history.state,'',url.pathname+url.search);return true;
    };
    if(select())return;
    const queue=document.getElementById('queue')||document.body;const observer=new MutationObserver(()=>{if(select())observer.disconnect()});observer.observe(queue,{childList:true,subtree:true});setTimeout(()=>observer.disconnect(),12000);
  }
  preselectTableFromQuery();

  if(initialPath==='/app/centro-de-control-v2'){
    window.addEventListener('message',event=>{
      if(event.origin!==location.origin)return;const data=event.data||{};if(data.type!==OPEN_MESSAGE)return;
      const frame=document.getElementById('p11Frame');if(!frame||event.source!==frame.contentWindow)return;
      const module=String(data.module||'');const tableId=validTableId(data.tableId);if(!tableId||!['caja','division'].includes(module))return;
      const nav=document.querySelector(`#p11Nav [data-module="${module}"]`);if(!nav)return;
      const route=module==='caja'?'/app/restaurante-v2/caja':'/app/restaurante-v2/division';frame.src=`${route}?tableId=${encodeURIComponent(tableId)}`;
      document.querySelectorAll('#p11Nav [data-module]').forEach(item=>item.classList.toggle('active',item.dataset.module===module));
      history.replaceState({...(history.state||{}),p11Module:module},'',`/app/centro-de-control-v2?module=${module}`);
    });
  }

  window.VantixGCRestaurantUxV78=Object.freeze({marker:MARKER,openMessage:OPEN_MESSAGE,contextSettlement:true,canonicalHeader:true});
})();
