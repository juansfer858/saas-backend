/* VANTIX_RESTAURANT_V2_MENU_VISIBLE_CATEGORY_SELECTOR_V14 · VANTIX_RESTAURANT_COMMERCIAL_CATEGORIES_V26 */
(() => {
  'use strict';

  const R = window.RestaurantV2;
  if (!R) return;

  const MARKER = 'VANTIX_RESTAURANT_COMMERCIAL_CATEGORIES_V26';
  const LEGACY_MARKER = 'VANTIX_RESTAURANT_V2_MENU_VISIBLE_CATEGORY_SELECTOR_V14';
  const SELECT_IDS = ['preparedCommercialCategory', 'inventoryCommercialCategory', 'editCommercialCategory'];
  let rows = [];
  let refreshing = null;

  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) => R.esc(value);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function activeRows() {
    return rows.filter((row) => row.active !== false);
  }

  function optionHtml(category) {
    // El value conserva el nombre para que restaurant-v2-menu.js mantenga su contrato
    // de descripción legado. El id central viaja aparte para la asignación V26.
    return `<option value="${esc(category.name)}" data-category-id="${esc(category.id)}">${esc(category.name)}</option>`;
  }

  function renderSelects() {
    const active = activeRows();
    for (const id of SELECT_IDS) {
      const target = document.getElementById(id);
      if (!target) continue;
      const current = String(target.value || '');
      target.innerHTML = active.length
        ? active.map(optionHtml).join('')
        : '<option value="">Sin categorías activas</option>';
      if (active.some((row) => row.name === current)) target.value = current;
      else if (active[0]) target.value = active[0].name;
      target.dataset.categorySource = MARKER;
      target.title = 'Categorías comerciales administradas por este restaurante';
    }
  }

  function renderManager() {
    const box = $('#commercialCategoryList');
    if (!box) return;
    box.innerHTML = rows.length ? rows.map((category, index) => {
      const count = Number(category.productCount || 0);
      const disableDeactivate = category.active !== false && count > 0;
      return `<div class="menu-category-row ${category.active === false ? 'off' : ''}" data-category-row="${esc(category.id)}">
        <div class="menu-category-order">
          <button type="button" class="rv2-btn" data-category-up="${esc(category.id)}" ${index === 0 ? 'disabled' : ''} aria-label="Subir">↑</button>
          <button type="button" class="rv2-btn" data-category-down="${esc(category.id)}" ${index === rows.length - 1 ? 'disabled' : ''} aria-label="Bajar">↓</button>
        </div>
        <input class="menu-input" data-category-name="${esc(category.id)}" maxlength="80" value="${esc(category.name)}" aria-label="Nombre de categoría">
        <span class="menu-category-count">${count} producto${count === 1 ? '' : 's'}</span>
        <button type="button" class="rv2-btn" data-category-save="${esc(category.id)}">Guardar</button>
        <button type="button" class="rv2-btn" data-category-toggle="${esc(category.id)}" ${disableDeactivate ? 'disabled title="Mueve primero sus productos"' : ''}>${category.active === false ? 'Activar' : 'Desactivar'}</button>
      </div>`;
    }).join('') : '<div class="menu-empty">Aún no hay categorías comerciales.</div>';

    box.querySelectorAll('[data-category-save]').forEach((button) => button.addEventListener('click', () => saveName(button.dataset.categorySave)));
    box.querySelectorAll('[data-category-toggle]').forEach((button) => button.addEventListener('click', () => toggleCategory(button.dataset.categoryToggle)));
    box.querySelectorAll('[data-category-up]').forEach((button) => button.addEventListener('click', () => moveCategory(button.dataset.categoryUp, -1)));
    box.querySelectorAll('[data-category-down]').forEach((button) => button.addEventListener('click', () => moveCategory(button.dataset.categoryDown, 1)));
  }

  function showError(message = '') {
    const box = $('#commercialCategoryError');
    if (!box) return;
    box.hidden = !message;
    box.textContent = message || '';
  }

  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const data = await R.api('/api/v1/restaurante/carta-importacion/categorias?includeInactive=true');
        rows = Array.isArray(data) ? data : [];
        renderSelects();
        renderManager();
        showError('');
        document.dispatchEvent(new CustomEvent('restaurant:v2-commercial-categories', { detail: { rows:[...rows] } }));
        return rows;
      } catch (error) {
        showError(error.message || 'No fue posible cargar las categorías.');
        return rows;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  async function createCategory(event) {
    event.preventDefault();
    const input = $('#commercialCategoryNewName');
    const name = String(input?.value || '').trim();
    if (!name) return;
    showError('');
    try {
      await R.api('/api/v1/restaurante/carta-importacion/categorias', {
        method:'POST', body:JSON.stringify({ name })
      });
      input.value = '';
      await refresh();
    } catch (error) { showError(error.message); }
  }

  async function saveName(id) {
    const input = document.querySelector(`[data-category-name="${CSS.escape(id)}"]`);
    const name = String(input?.value || '').trim();
    if (!name) return showError('El nombre de la categoría es obligatorio.');
    showError('');
    try {
      await R.api(`/api/v1/restaurante/carta-importacion/categorias/${encodeURIComponent(id)}`, {
        method:'PATCH', body:JSON.stringify({ name })
      });
      await refresh();
      await window.VantixGCRestaurantV2MenuV1?.refresh?.();
    } catch (error) { showError(error.message); }
  }

  async function toggleCategory(id) {
    const category = rows.find((row) => row.id === id);
    if (!category) return;
    showError('');
    try {
      await R.api(`/api/v1/restaurante/carta-importacion/categorias/${encodeURIComponent(id)}`, {
        method:'PATCH', body:JSON.stringify({ active: category.active === false })
      });
      await refresh();
    } catch (error) { showError(error.message); }
  }

  async function moveCategory(id, direction) {
    const index = rows.findIndex((row) => row.id === id);
    const otherIndex = index + direction;
    if (index < 0 || otherIndex < 0 || otherIndex >= rows.length) return;
    const current = rows[index];
    const other = rows[otherIndex];
    showError('');
    try {
      const currentOrder = Number.isFinite(Number(current.sortOrder)) ? Number(current.sortOrder) : index * 10;
      const otherOrder = Number.isFinite(Number(other.sortOrder)) ? Number(other.sortOrder) : otherIndex * 10;
      await R.api(`/api/v1/restaurante/carta-importacion/categorias/${encodeURIComponent(current.id)}`, {
        method:'PATCH', body:JSON.stringify({ sortOrder: otherOrder })
      });
      await R.api(`/api/v1/restaurante/carta-importacion/categorias/${encodeURIComponent(other.id)}`, {
        method:'PATCH', body:JSON.stringify({ sortOrder: currentOrder })
      });
      await refresh();
    } catch (error) { showError(error.message); }
  }

  async function openManager() {
    await refresh();
    $('#commercialCategoryDialog')?.showModal();
  }

  function categoryById(id) {
    return rows.find((row) => row.id === id) || null;
  }

  function categoryByName(name) {
    const key = String(name || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
    return rows.find((row) => String(row.name || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es') === key) || null;
  }

  function selectedCategory(selectId) {
    const select = document.getElementById(selectId);
    const option = select?.selectedOptions?.[0];
    return option?.dataset?.categoryId ? categoryById(option.dataset.categoryId) : categoryByName(select?.value);
  }

  function selectCategory(selectId, categoryId, categoryName = '') {
    const target = document.getElementById(selectId);
    if (!target) return false;
    const category = categoryById(categoryId) || categoryByName(categoryName);
    if (!category || category.active === false) return false;
    target.value = category.name;
    return true;
  }

  async function assign(menuItemId, categoryId) {
    if (!menuItemId || !categoryId) return;
    await R.api(`/api/v1/restaurante/carta-importacion/items/${encodeURIComponent(menuItemId)}/categoria`, {
      method:'PUT', body:JSON.stringify({ categoryId })
    });
  }

  async function settleAfterSuccessfulDialogClose(dialog, errorBox, callback) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await sleep(75);
      if (errorBox && errorBox.hidden === false) return;
      if (!dialog?.open) {
        await callback();
        await refresh();
        await window.VantixGCRestaurantV2MenuV1?.refresh?.();
        return;
      }
    }
  }

  function bindAssignmentBridges() {
    $('#editForm')?.addEventListener('submit', () => {
      const category = selectedCategory('editCommercialCategory');
      const menuItemId = String($('#editMenuId')?.value || '');
      if (!category || !menuItemId) return;
      settleAfterSuccessfulDialogClose($('#editDialog'), $('#editError'), () => assign(menuItemId, category.id)).catch((error) => showError(error.message));
    });

    $('#inventoryForm')?.addEventListener('submit', () => {
      const category = selectedCategory('inventoryCommercialCategory');
      const productId = String($('#inventoryProductId')?.value || '');
      if (!category || !productId) return;
      settleAfterSuccessfulDialogClose($('#inventoryDialog'), $('#inventoryError'), async () => {
        const carta = await R.api('/api/v1/restaurante/carta-importacion/lista');
        const item = (Array.isArray(carta) ? carta : []).find((row) => row.productId === productId);
        if (item?.id) await assign(item.id, category.id);
      }).catch((error) => showError(error.message));
    });
  }

  function bind() {
    $('#manageCategories')?.addEventListener('click', openManager);
    $('#commercialCategoryCreateForm')?.addEventListener('submit', createCategory);
    $('#commercialCategoryClose')?.addEventListener('click', () => $('#commercialCategoryDialog')?.close());
    $('#refresh')?.addEventListener('click', () => setTimeout(refresh, 150));
    $('#newPrepared')?.addEventListener('click', () => refresh());
    $('#addInventory')?.addEventListener('click', () => refresh());
    bindAssignmentBridges();
    document.addEventListener('click', (event) => {
      if (event.target.closest?.('#ccOcrDone')) setTimeout(refresh, 250);
    }, true);
  }

  async function boot() {
    bind();
    await refresh();
    window.VantixGCRestaurantV2MenuCategorySelectorV14 = Object.freeze({
      marker: MARKER,
      legacyMarker: LEGACY_MARKER,
      version:'26.0.0',
      tenantManaged:true,
      refresh,
      categoryById,
      categoryByName,
      selectedCategory,
      selectCategory,
      categories:() => [...rows]
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
