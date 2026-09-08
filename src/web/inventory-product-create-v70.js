'use strict';

(() => {
  const MARKER = 'VANTIX_INVENTORY_PRODUCT_CREATE_V70';
  if (window[MARKER]) return;
  window[MARKER] = Object.freeze({ version:'70.0.0', inventoryOnly:true, endpoint:'/api/v1/inventario/productos' });

  function htmlEscape(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'
    })[char]);
  }

  function isInventoryPage() {
    return location.pathname === '/app/inventario';
  }

  function ensureButton() {
    if (!isInventoryPage()) return;
    const pagehead = document.querySelector('.content .pagehead') || document.querySelector('.pagehead');
    if (!pagehead || pagehead.querySelector('#inventoryAddProductButton')) return;

    let actions = pagehead.querySelector(':scope > .actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'actions';
      [...pagehead.children]
        .filter((node) => node.tagName === 'BUTTON' || node.tagName === 'A')
        .forEach((node) => actions.appendChild(node));
      pagehead.appendChild(actions);
    }

    const button = document.createElement('button');
    button.id = 'inventoryAddProductButton';
    button.type = 'button';
    button.className = 'btn primary';
    button.textContent = '+ Agregar producto';
    button.addEventListener('click', () => window.openInventoryProductForm?.());
    actions.insertBefore(button, actions.firstChild);
  }

  function modalMarkup() {
    return `<div class="modal-back" id="inventoryProductModal"><form class="modal" id="inventoryProductForm" style="width:min(680px,100%);max-height:92vh;overflow:auto"><h2>Agregar producto</h2><div class="grid2"><div class="field"><label>Tipo</label><select class="select" id="invProductType"><option value="PRODUCTO">Producto</option><option value="SERVICIO">Servicio</option></select></div><div class="field"><label>SKU</label><input class="input" id="invProductSku" maxlength="80" required autocomplete="off"></div></div><div class="field"><label>Nombre</label><input class="input" id="invProductName" maxlength="180" required autocomplete="off"></div><div class="grid2"><div class="field"><label>Código de barras</label><input class="input" id="invProductBarcode" maxlength="120" autocomplete="off"></div><div class="field"><label>Unidad de medida</label><input class="input" id="invProductUnit" maxlength="20" value="UND" required autocomplete="off"></div></div><div class="field"><label>Descripción</label><textarea class="input" id="invProductDescription" rows="2" maxlength="1000"></textarea></div><div class="grid3"><div class="field"><label>Precio de venta</label><input class="input" id="invProductPrice" type="number" min="0" step="0.01" value="0" required></div><div class="field"><label>IVA %</label><input class="input" id="invProductVat" type="number" min="0" max="100" step="0.01" value="0"></div><div class="field"><label>Impoconsumo %</label><input class="input" id="invProductConsumptionTax" type="number" min="0" max="100" step="0.01" value="0"></div></div><div class="field"><label><input type="checkbox" id="invProductTrackStock" checked> Controla inventario</label><div class="muted" style="font-size:12px;margin-top:5px">El producto se crea con existencia 0. Las existencias entran por Compras o Ajuste de inventario para conservar Kardex y contabilidad.</div></div><div id="inventoryProductError"></div><div class="actions" style="justify-content:flex-end;margin-top:16px"><button class="btn" type="button" id="inventoryProductCancel">Cancelar</button><button class="btn primary" type="submit">Guardar producto</button></div></form></div>`;
  }

  window.openInventoryProductForm = function openInventoryProductForm() {
    document.querySelector('#inventoryProductModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', modalMarkup());

    const type = document.querySelector('#invProductType');
    const track = document.querySelector('#invProductTrackStock');
    const syncType = () => {
      if (!type || !track) return;
      if (type.value === 'SERVICIO') {
        track.checked = false;
        track.disabled = true;
      } else {
        track.disabled = false;
      }
    };
    type?.addEventListener('change', syncType);
    syncType();

    document.querySelector('#inventoryProductCancel')?.addEventListener('click', () => {
      document.querySelector('#inventoryProductModal')?.remove();
    });

    const form = document.querySelector('#inventoryProductForm');
    if (!form) return;
    form.onsubmit = async (event) => {
      event.preventDefault();
      const errorBox = document.querySelector('#inventoryProductError');
      if (errorBox) errorBox.innerHTML = '';
      const submit = form.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        if (typeof window.api !== 'function') throw new Error('No fue posible abrir la conexión de Inventario.');
        const productType = document.querySelector('#invProductType').value;
        await window.api('/api/v1/inventario/productos', {
          method:'POST',
          body:JSON.stringify({
            tipo:productType,
            sku:document.querySelector('#invProductSku').value.trim(),
            codigoBarras:document.querySelector('#invProductBarcode').value.trim() || null,
            nombre:document.querySelector('#invProductName').value.trim(),
            descripcion:document.querySelector('#invProductDescription').value.trim() || null,
            unidadMedida:document.querySelector('#invProductUnit').value.trim() || 'UND',
            controlaInventario:productType === 'SERVICIO' ? false : document.querySelector('#invProductTrackStock').checked,
            costoPromedio:0,
            stockActual:0,
            precio1:Number(document.querySelector('#invProductPrice').value || 0),
            ivaPct:Number(document.querySelector('#invProductVat').value || 0),
            impoconsumoPct:Number(document.querySelector('#invProductConsumptionTax').value || 0),
            activo:true
          })
        });
        document.querySelector('#inventoryProductModal')?.remove();
        if (typeof window.render === 'function') await window.render();
        requestAnimationFrame(ensureButton);
      } catch (error) {
        if (errorBox) errorBox.innerHTML = `<div class="error">${htmlEscape(error.message || 'No fue posible crear el producto')}</div>`;
      } finally {
        if (submit && submit.isConnected) submit.disabled = false;
      }
    };
  };

  const observer = new MutationObserver(() => requestAnimationFrame(ensureButton));
  observer.observe(document.documentElement, { childList:true, subtree:true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureButton, { once:true });
  else ensureButton();
})();
