/* VANTIX_RESTAURANT_V2_MENU_DELETE_V2 */
(() => {
  'use strict';

  const R = window.RestaurantV2;
  if (!R) return;

  const DELETE_MARKER = 'VANTIX_RESTAURANT_V2_MENU_DELETE_V2';

  function decorateDeleteButtons() {
    const grid = document.getElementById('menuGrid');
    if (!grid) return;

    grid.querySelectorAll('.menu-card').forEach((card) => {
      const actions = card.querySelector('.menu-card-actions');
      const editButton = actions?.querySelector('[data-edit-menu]');
      const menuItemId = String(editButton?.dataset?.editMenu || '').trim();
      if (!actions || !menuItemId || actions.querySelector('[data-delete-menu]')) return;

      const button = document.createElement('button');
      button.className = 'rv2-btn';
      button.type = 'button';
      button.dataset.deleteMenu = menuItemId;
      button.textContent = 'Eliminar';
      button.style.color = '#b42318';
      button.style.borderColor = '#fecaca';
      button.style.background = '#fff';
      button.setAttribute('aria-label', 'Eliminar producto de la Carta');

      button.addEventListener('click', async () => {
        const productName = String(card.querySelector('h3')?.textContent || 'este producto').trim();
        const accepted = window.confirm(
          `¿Eliminar “${productName}” de la Carta?\n\n` +
          'Se retirará de la Carta y no volverá a aparecer como oculto. ' +
          'El producto maestro y el historial de ventas se conservarán.'
        );
        if (!accepted) return;

        button.disabled = true;
        button.textContent = 'Eliminando…';
        try {
          const result = await R.api(`/api/v1/restaurante/menu/${encodeURIComponent(menuItemId)}`, { method:'DELETE' });
          if (!result?.removedFromMenu || result?.productPreserved !== true) {
            throw new Error('El servidor no confirmó la eliminación segura de la Carta.');
          }
          if (window.VantixGCRestaurantV2MenuV1?.refresh) {
            await window.VantixGCRestaurantV2MenuV1.refresh();
          } else {
            card.remove();
          }
        } catch (error) {
          button.disabled = false;
          button.textContent = 'Eliminar';
          window.alert(error?.message || 'No fue posible eliminar el producto de la Carta.');
        }
      });

      actions.appendChild(button);
    });
  }

  function boot() {
    decorateDeleteButtons();
    const grid = document.getElementById('menuGrid');
    if (grid) {
      new MutationObserver(decorateDeleteButtons).observe(grid, { childList:true, subtree:true });
    }
    window.VantixGCRestaurantV2MenuDeleteV2 = Object.freeze({
      marker: DELETE_MARKER,
      version: '2.0.0',
      safeMenuRemoval: true,
      preservesMasterProduct: true,
      refresh: decorateDeleteButtons
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
