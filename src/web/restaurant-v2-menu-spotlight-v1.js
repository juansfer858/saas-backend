/* VANTIX_RESTAURANT_V2_MENU_SPOTLIGHT_V1 */
(()=>{'use strict';
  const MARKER='VANTIX_RESTAURANT_V2_MENU_SPOTLIGHT_V1';
  const V=window.RestaurantV2;if(!V||location.pathname!=='/app/restaurante-v2/carta')return;
  const $=selector=>document.querySelector(selector);const esc=V.esc;
  let theme=null;let menu=[];
  function productName(row){return row?.product?.nombre||row?.product?.name||row?.nombre||'Producto'}
  function productPrice(row){return Number(row?.product?.precio1??row?.product?.price??row?.precio??0)}
  function menuRows(){return (Array.isArray(menu)?menu:[]).filter(row=>row?.product&&!row?.warning)}
  function currentPromo(){const spot=theme?.clientSpotlight;return spot?.kind==='PROMO_DIA'?spot:{active:false,kind:'PROMO_DIA',menuItemId:null,label:'Promo del día',description:null}}
  function ensureDialog(){
    let dialog=$('#promoDayDialog');if(dialog)return dialog;
    dialog=document.createElement('dialog');dialog.id='promoDayDialog';dialog.className='menu-dialog menu-dialog-wide';dialog.innerHTML=`<form id="promoDayForm" method="dialog"><div class="menu-dialog-head"><div><small>PROMO DEL DÍA</small><h2>Tarjeta destacada para el QR</h2></div><button class="rv2-btn" type="button" data-promo-close>Cerrar</button></div><div class="menu-dialog-body"><div class="menu-grid2"><label>Producto de la Carta<select id="promoMenuItem" class="menu-select"></select></label><label>Título<input id="promoLabel" class="menu-input" maxlength="80" placeholder="Promo del día"></label></div><label>Texto corto<textarea id="promoDescription" class="menu-input" maxlength="220" rows="3" placeholder="Ej. Sólo por hoy · incluye bebida"></textarea></label><label class="menu-check"><input id="promoActive" type="checkbox"> Mostrar esta promo al frente del QR</label><div id="promoPreview" class="menu-promo-preview"></div><div id="promoStatus" class="menu-promo-status">Selecciona un producto y revisa cómo se verá.</div></div><div class="menu-dialog-actions"><button id="promoDisable" class="rv2-btn" type="button">Retirar del QR</button><button class="rv2-btn rv2-btn-primary" type="submit">Guardar promo</button></div></form>`;
    document.body.appendChild(dialog);
    dialog.querySelector('[data-promo-close]').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close()});
    dialog.querySelector('#promoDayForm').addEventListener('submit',savePromo);
    dialog.querySelector('#promoDisable').addEventListener('click',disablePromo);
    ['#promoMenuItem','#promoLabel','#promoDescription','#promoActive'].forEach(id=>dialog.querySelector(id)?.addEventListener('input',renderPreview));
    return dialog;
  }
  function ensureButton(){
    const actions=$('.menu-actions');if(!actions||$('#promoDayButton'))return;
    const button=document.createElement('button');button.id='promoDayButton';button.className='rv2-btn';button.type='button';button.textContent='★ Promo del día';button.addEventListener('click',openPromo);actions.appendChild(button);
  }
  function status(text,type=''){const node=$('#promoStatus');if(!node)return;node.textContent=text;node.className=`menu-promo-status ${type}`.trim()}
  function selectedRow(){const id=$('#promoMenuItem')?.value;return menuRows().find(row=>String(row.id)===String(id))||null}
  function renderPreview(){
    const row=selectedRow();const preview=$('#promoPreview');if(!preview)return;
    const label=String($('#promoLabel')?.value||'Promo del día').trim()||'Promo del día';const description=String($('#promoDescription')?.value||'').trim();
    if(!row){preview.innerHTML='<small>PROMO DEL DÍA</small><h3>Selecciona un producto</h3><p>La promo aparecerá arriba de las categorías, separada de la lista normal.</p>';return}
    preview.innerHTML=`<small>${esc(label)}</small><h3>${esc(productName(row))}</h3>${description?`<p>${esc(description)}</p>`:''}<strong>${V.money(productPrice(row))}</strong>`;
  }
  async function loadData(){
    const [themeData,menuData]=await Promise.all([V.api('/api/v1/restaurante/theme'),V.api('/api/v1/restaurante/menu?active=true')]);theme=themeData||{};menu=Array.isArray(menuData)?menuData:[];
  }
  function fill(){
    const spot=currentPromo();const rows=menuRows();const select=$('#promoMenuItem');select.innerHTML='<option value="">Seleccionar producto…</option>'+rows.map(row=>`<option value="${esc(row.id)}">${esc(productName(row))} · ${esc(V.money(productPrice(row)))}</option>`).join('');
    select.value=rows.some(row=>String(row.id)===String(spot.menuItemId))?String(spot.menuItemId):'';$('#promoLabel').value=spot.label||'Promo del día';$('#promoDescription').value=spot.description||'';$('#promoActive').checked=Boolean(spot.active);renderPreview();status(spot.active?'Promo actualmente publicada en el QR.':'La promo está retirada del QR.',spot.active?'ok':'');
  }
  async function openPromo(){
    const dialog=ensureDialog();status('Cargando publicación…');dialog.showModal();
    try{await loadData();fill()}catch(error){status(error.message||'No fue posible cargar la promo.','error')}
  }
  async function savePromo(event){
    event.preventDefault();const row=selectedRow();const active=Boolean($('#promoActive')?.checked);if(active&&!row){status('Selecciona el producto que quieres destacar.','error');return}
    const button=event.submitter;button.disabled=true;status('Guardando promo…');
    try{
      await V.api('/api/v1/restaurante/theme',{method:'PATCH',body:JSON.stringify({clientSpotlight:{active,kind:'PROMO_DIA',menuItemId:row?.id||null,label:String($('#promoLabel')?.value||'').trim()||'Promo del día',description:String($('#promoDescription')?.value||'').trim()||null}})});
      await loadData();fill();status(active?'Promo publicada al frente del QR.':'Configuración guardada; la promo sigue retirada.','ok');
    }catch(error){status(error.message||'No fue posible guardar la promo.','error')}finally{button.disabled=false}
  }
  async function disablePromo(){
    const row=selectedRow();const button=$('#promoDisable');button.disabled=true;status('Retirando promo…');
    try{await V.api('/api/v1/restaurante/theme',{method:'PATCH',body:JSON.stringify({clientSpotlight:{active:false,kind:'PROMO_DIA',menuItemId:row?.id||null,label:String($('#promoLabel')?.value||'').trim()||'Promo del día',description:String($('#promoDescription')?.value||'').trim()||null}})});$('#promoActive').checked=false;status('Promo retirada del QR. La configuración quedó guardada.','ok')}catch(error){status(error.message||'No fue posible retirar la promo.','error')}finally{button.disabled=false}
  }
  ensureButton();const observer=new MutationObserver(ensureButton);observer.observe(document.documentElement,{subtree:true,childList:true});window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
  window.VantixGCRestaurantMenuSpotlightV1=Object.freeze({marker:MARKER,kind:'PROMO_DIA',frontCard:true,reusesClientSpotlight:true});
})();
