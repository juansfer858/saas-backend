/* VANTIX_RESTAURANT_CARTA_EDIT_V27 */
(() => {
  'use strict';

  const R = window.RestaurantV2;
  if (!R) return;
  R.requireSession();

  const MARKER = 'VANTIX_RESTAURANT_CARTA_EDIT_V27';
  const $ = (selector, root = document) => root.querySelector(selector);

  function showError(message = '') {
    const box = $('#editError');
    if (!box) return;
    box.hidden = !message;
    box.textContent = message || '';
  }

  function selectedCommercialCategory() {
    const select = $('#editCommercialCategory');
    const option = select?.selectedOptions?.[0];
    const api = window.VantixGCRestaurantV2MenuCategorySelectorV14;
    const central = api?.selectedCategory?.('editCommercialCategory');
    const categoryId = String(central?.id || option?.dataset?.categoryId || '').trim();
    const category = String(central?.name || select?.value || '').trim();
    return { categoryId, category };
  }

  async function save(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.id !== 'editForm') return;

    event.preventDefault();
    event.stopImmediatePropagation();
    showError('');

    const submit = form.querySelector('button[type="submit"]');
    if (submit?.disabled) return;

    const menuItemId = String($('#editMenuId')?.value || '').trim();
    const commercial = selectedCommercialCategory();
    const input = {
      name:String($('#editName')?.value || '').trim(),
      price:Number($('#editPrice')?.value || 0),
      categoryId:commercial.categoryId,
      category:commercial.category,
      operationalCategory:String($('#editCategory')?.value || ''),
      station:String($('#editStation')?.value || ''),
      mode:String($('#editKind')?.value || ''),
      active:Boolean($('#editActive')?.checked)
    };

    if (!menuItemId) return showError('Producto de Carta no identificado. Actualiza e inténtalo de nuevo.');
    if (!input.name) return showError('El nombre del producto es obligatorio.');
    if (!Number.isFinite(input.price) || input.price < 0) return showError('El precio no es válido.');
    if (!input.categoryId || !input.category) return showError('Selecciona una categoría visible.');

    if (submit) {
      submit.disabled = true;
      submit.dataset.originalText = submit.textContent;
      submit.textContent = 'Guardando…';
    }

    try {
      const updated = await R.api(`/api/v1/restaurante/carta-importacion/items/${encodeURIComponent(menuItemId)}/editar-v27`, {
        method:'PATCH',
        body:JSON.stringify(input)
      });
      if (updated?.marker !== MARKER) throw new Error('La edición no confirmó el contrato V27.');
      $('#editDialog')?.close();
      await window.VantixGCRestaurantV2MenuV1?.refresh?.();
      await window.VantixGCRestaurantV2MenuCategorySelectorV14?.refresh?.();
    } catch (error) {
      showError(error?.message || 'No fue posible guardar los cambios.');
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = submit.dataset.originalText || 'Guardar cambios';
        delete submit.dataset.originalText;
      }
    }
  }

  document.addEventListener('submit', save, true);
  window.VantixGCRestaurantCartaEditV27 = Object.freeze({ marker:MARKER, atomic:true, importedProducts:true, allCartaProducts:true });
})();
