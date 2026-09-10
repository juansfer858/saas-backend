/* VANTIX_RESTAURANT_V2_MENU_V1 */
(() => {
  'use strict';

  const R = window.RestaurantV2;
  if (!R) throw new Error('Restaurant V2 SDK no disponible');
  const session = R.requireSession();
  const role = String(session.user?.rol || '').toUpperCase();
  if (!['ADMIN', 'SUPER_ADMIN'].includes(role)) {
    location.replace('/app/centro-de-control');
    return;
  }

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const PREFIX = 'Categoría de carta: ';
  const OCR_GUARD = "if (!location.pathname.startsWith('/app/centro-de-control')) return;";
  const OCR_CARTA_GUARD = "if (!location.pathname.startsWith('/app/centro-de-control') && location.pathname !== '/app/restaurante-v2/carta') return;";
  const state = { menu: [], products: [], recipes: [], carta: [], selectedInventory: null, editItem: null, recipeRows: 0 };

  function showNotice(text, error = false) {
    const box = $('#notice');
    if (!box) return;
    box.hidden = !text;
    box.textContent = text || '';
    box.classList.toggle('error', error);
  }

  function setError(id, message = '') {
    const box = $(id);
    if (!box) return;
    box.hidden = !message;
    box.textContent = message || '';
  }

  function esc(value) { return R.esc(value); }
  function money(value) { return R.money(value); }
  function number(value, digits = 2) { return new Intl.NumberFormat('es-CO', { maximumFractionDigits: digits }).format(Number(value || 0)); }

  function descriptionCategory(product, fallback = '') {
    const description = String(product?.descripcion || '').trim();
    if (description.toLowerCase().startsWith(PREFIX.toLowerCase())) return description.slice(PREFIX.length).trim() || fallback;
    return fallback;
  }

  function cartaByMenu() { return new Map(state.carta.map((row) => [row.menuItemId, row])); }
  function productById() { return new Map(state.products.map((row) => [row.id, row])); }
  function recipeByProduct() { return new Map(state.recipes.filter((row) => row.outputProductId).map((row) => [row.outputProductId, row])); }

  function commercialCategory(item) {
    const imported = cartaByMenu().get(item.id);
    return imported?.category || descriptionCategory(item.product, item.category || 'Carta');
  }

  function kindOf(item) {
    if (item.requiresRecipe) return 'RECIPE';
    if (item.product?.controlaInventario) return 'DIRECT';
    return 'PREPARED';
  }

  function kindLabel(kind) {
    return { PREPARED: 'Preparado / sin control', DIRECT: 'Inventario directo', RECIPE: 'Receta' }[kind] || kind;
  }

  function menuPayload(item, changes = {}) {
    return {
      productId: changes.productId ?? item.productId,
      category: changes.category ?? item.category,
      station: changes.station ?? item.station,
      requiresRecipe: changes.requiresRecipe ?? Boolean(item.requiresRecipe),
      active: changes.active ?? Boolean(item.active),
      sortOrder: changes.sortOrder ?? Number(item.sortOrder || 0)
    };
  }

  async function loadData() {
    showNotice('Actualizando Carta…');
    try {
      const [active, inactive, products, recipes, carta] = await Promise.all([
        R.api('/api/v1/restaurante/menu?active=true'),
        R.api('/api/v1/restaurante/menu?active=false'),
        R.api('/api/v1/inventario/productos?activo=true&limit=1000'),
        R.api('/api/v1/consumo/recetas?limit=1000'),
        R.api('/api/v1/restaurante/carta-importacion/lista')
      ]);
      state.menu = [...(Array.isArray(active) ? active : []), ...(Array.isArray(inactive) ? inactive : [])]
        .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
      state.products = Array.isArray(products) ? products : [];
      state.recipes = Array.isArray(recipes) ? recipes : [];
      state.carta = Array.isArray(carta) ? carta : [];
      render();
      showNotice('');
    } catch (error) {
      showNotice(error.message || 'No fue posible cargar la Carta.', true);
    }
  }

  function renderSummary() {
    const rows = state.menu.filter((row) => row.active !== false);
    const prepared = rows.filter((row) => kindOf(row) === 'PREPARED').length;
    const direct = rows.filter((row) => kindOf(row) === 'DIRECT').length;
    const recipes = rows.filter((row) => row.recipeConfigured || kindOf(row) === 'RECIPE').length;
    $('#summary').innerHTML = [
      ['Productos en Carta', rows.length, 'visibles para venta'],
      ['Preparados', prepared, 'sin inventario obligatorio'],
      ['Inventario directo', direct, 'descuentan el mismo producto'],
      ['Con receta', recipes, 'control avanzado opcional']
    ].map(([label, value, hint]) => `<div class="menu-stat"><span>${esc(label)}</span><b>${value}</b><small>${esc(hint)}</small></div>`).join('');
  }

  function refreshCategoryFilter() {
    const select = $('#categoryFilter');
    const current = select.value;
    const categories = [...new Set(state.menu.map(commercialCategory).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    select.innerHTML = '<option value="">Todas las categorías</option>' + categories.map((value) => `<option value="${esc(value)}">${esc(value)}</option>`).join('');
    if (categories.includes(current)) select.value = current;
  }

  function filteredMenu() {
    const q = String($('#search').value || '').trim().toLowerCase();
    const category = $('#categoryFilter').value;
    const station = $('#stationFilter').value;
    const kind = $('#kindFilter').value;
    const showInactive = $('#showInactive').checked;
    return state.menu.filter((item) => {
      const product = item.product || {};
      const text = `${product.sku || ''} ${product.nombre || ''} ${commercialCategory(item)} ${item.category || ''} ${item.station || ''}`.toLowerCase();
      if (q && !text.includes(q)) return false;
      if (category && commercialCategory(item) !== category) return false;
      if (station && item.station !== station) return false;
      if (kind && kindOf(item) !== kind) return false;
      if (!showInactive && item.active === false) return false;
      return true;
    });
  }

  function renderMenu() {
    const rows = filteredMenu();
    const grid = $('#menuGrid');
    if (!rows.length) {
      grid.innerHTML = '<div class="menu-empty">No hay productos que coincidan con estos filtros.</div>';
      return;
    }
    grid.innerHTML = rows.map((item) => {
      const product = item.product || {};
      const kind = kindOf(item);
      const inactive = item.active === false;
      const stock = kind === 'DIRECT'
        ? `<div class="menu-stock">Stock actual: <strong>${number(product.stockActual, 4)} ${esc(product.unidadMedida || 'UND')}</strong></div>`
        : kind === 'RECIPE'
          ? `<div class="menu-stock">${item.recipeConfigured ? 'Receta configurada' : 'Receta pendiente'}</div>`
          : '<div class="menu-stock">Se vende sin exigir receta ni existencias.</div>';
      return `<article class="menu-card ${inactive ? 'off' : ''}">
        <div class="menu-card-head"><div><small>${esc(product.sku || '')}</small><h3>${esc(product.nombre || 'Producto')}</h3><p>${esc(commercialCategory(item))} · ${esc(item.station)}</p></div><div class="menu-price">${money(product.precio1)}</div></div>
        <div class="menu-card-body"><div class="menu-tags"><span class="menu-tag ${kind.toLowerCase()}">${esc(kindLabel(kind))}</span><span class="menu-tag">${esc(item.category)}</span>${inactive ? '<span class="menu-tag off">Oculto</span>' : ''}</div>${stock}</div>
        <div class="menu-card-actions"><button class="rv2-btn" type="button" data-edit-menu="${esc(item.id)}">Editar</button><button class="rv2-btn" type="button" data-toggle-menu="${esc(item.id)}">${inactive ? 'Mostrar' : 'Ocultar'}</button></div>
      </article>`;
    }).join('');
    $$('[data-edit-menu]', grid).forEach((button) => button.addEventListener('click', () => openEdit(button.dataset.editMenu)));
    $$('[data-toggle-menu]', grid).forEach((button) => button.addEventListener('click', () => toggleItem(button.dataset.toggleMenu)));
  }

  function render() {
    renderSummary();
    refreshCategoryFilter();
    renderMenu();
  }

  function generateSku(name) {
    const slug = String(name || 'PLATO').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 46) || 'PLATO';
    return `CARTA-${slug}-${Date.now().toString(36).slice(-5).toUpperCase()}`.slice(0, 80);
  }

  async function createPrepared(event) {
    event.preventDefault();
    setError('#preparedError');
    let product = null;
    try {
      const name = $('#preparedName').value.trim();
      const price = Number($('#preparedPrice').value || 0);
      const commercial = $('#preparedCommercialCategory').value.trim() || $('#preparedCategory').selectedOptions[0]?.textContent || 'Carta';
      product = await R.api('/api/v1/inventario/productos', {
        method: 'POST',
        body: JSON.stringify({
          tipo: 'PRODUCTO', sku: $('#preparedSku').value.trim() || generateSku(name), nombre: name,
          descripcion: `${PREFIX}${commercial}`, unidadMedida: 'UND', controlaInventario: false,
          costoPromedio: 0, stockActual: 0, precio1: price, ivaPct: 0, impoconsumoPct: 0, activo: true
        })
      });
      await R.api('/api/v1/restaurante/menu', {
        method: 'POST',
        body: JSON.stringify({
          productId: product.id, category: $('#preparedCategory').value, station: $('#preparedStation').value,
          requiresRecipe: false, active: true, sortOrder: state.menu.length
        })
      });
      $('#preparedDialog').close();
      $('#preparedForm').reset();
      $('#preparedCategory').value = 'FUERTES'; $('#preparedStation').value = 'COCINA';
      await loadData();
    } catch (error) {
      if (product?.id) R.api(`/api/v1/inventario/productos/${product.id}`, { method: 'DELETE' }).catch(() => {});
      setError('#preparedError', error.message);
    }
  }

  function inventoryAvailable() {
    const used = new Set(state.menu.map((row) => row.productId));
    const q = String($('#inventorySearch').value || '').trim().toLowerCase();
    return state.products.filter((product) => {
      if (used.has(product.id)) return false;
      const text = `${product.sku || ''} ${product.nombre || ''} ${product.codigoBarras || ''}`.toLowerCase();
      return !q || text.includes(q);
    });
  }

  function renderInventoryCandidates() {
    const rows = inventoryAvailable().slice(0, 100);
    const box = $('#inventoryCandidates');
    box.innerHTML = rows.length ? rows.map((product) => `<button type="button" class="inventory-option ${state.selectedInventory?.id === product.id ? 'active' : ''}" data-inventory-product="${esc(product.id)}"><span><b>${esc(product.sku)} · ${esc(product.nombre)}</b><small>${product.controlaInventario ? `Stock ${number(product.stockActual, 4)} ${esc(product.unidadMedida || '')}` : 'Sin control de inventario'}</small></span><strong>${money(product.precio1)}</strong></button>`).join('') : '<div class="menu-empty" style="padding:20px">No hay productos disponibles para agregar.</div>';
    $$('[data-inventory-product]', box).forEach((button) => button.addEventListener('click', () => {
      state.selectedInventory = state.products.find((row) => row.id === button.dataset.inventoryProduct) || null;
      $('#inventoryProductId').value = state.selectedInventory?.id || '';
      $('#inventorySelected').innerHTML = state.selectedInventory
        ? `<b>${esc(state.selectedInventory.nombre)}</b><span>${state.selectedInventory.controlaInventario ? `Se descontará su stock real. Existencia actual: ${number(state.selectedInventory.stockActual, 4)} ${esc(state.selectedInventory.unidadMedida || '')}.` : 'Este producto no controla stock actualmente.'}</span>`
        : '<span>Selecciona un producto existente del inventario.</span>';
      renderInventoryCandidates();
    }));
  }

  function openInventoryDialog() {
    state.selectedInventory = null;
    $('#inventoryForm').reset();
    $('#inventoryCategory').value = 'BEBIDAS'; $('#inventoryStation').value = 'BARRA';
    $('#inventoryProductId').value = '';
    $('#inventorySelected').innerHTML = '<span>Selecciona un producto existente del inventario.</span>';
    setError('#inventoryError');
    renderInventoryCandidates();
    $('#inventoryDialog').showModal();
  }

  async function addInventoryProduct(event) {
    event.preventDefault();
    setError('#inventoryError');
    try {
      const product = state.selectedInventory;
      if (!product) throw new Error('Selecciona un producto del inventario.');
      const categoryText = $('#inventoryCommercialCategory').value.trim();
      if (categoryText && (!product.descripcion || String(product.descripcion).startsWith(PREFIX))) {
        await R.api(`/api/v1/inventario/productos/${product.id}`, { method:'PATCH', body:JSON.stringify({ descripcion:`${PREFIX}${categoryText}` }) });
      }
      await R.api('/api/v1/restaurante/menu', {
        method: 'POST',
        body: JSON.stringify({
          productId: product.id, category: $('#inventoryCategory').value, station: $('#inventoryStation').value,
          requiresRecipe: false, active: true, sortOrder: state.menu.length
        })
      });
      $('#inventoryDialog').close();
      await loadData();
    } catch (error) { setError('#inventoryError', error.message); }
  }

  async function toggleItem(id) {
    const item = state.menu.find((row) => row.id === id);
    if (!item) return;
    try {
      await R.api(`/api/v1/restaurante/menu/${id}`, { method:'PUT', body:JSON.stringify(menuPayload(item, { active: item.active === false })) });
      await loadData();
    } catch (error) { showNotice(error.message, true); }
  }

  function openEdit(id) {
    const item = state.menu.find((row) => row.id === id);
    if (!item) return;
    state.editItem = item;
    $('#editMenuId').value = item.id;
    $('#editProductId').value = item.productId;
    $('#editTitle').textContent = item.product?.nombre || 'Editar producto';
    $('#editName').value = item.product?.nombre || '';
    $('#editPrice').value = Number(item.product?.precio1 || 0);
    $('#editCommercialCategory').value = commercialCategory(item);
    $('#editCategory').value = item.category;
    $('#editStation').value = item.station;
    $('#editKind').value = kindOf(item);
    $('#editActive').checked = item.active !== false;
    const recipe = recipeByProduct().get(item.productId);
    $('#recipeBox').innerHTML = recipe
      ? `<b>Receta disponible: ${esc(recipe.name)}</b><span>${Array.isArray(recipe.items) ? recipe.items.length : 0} insumo(s). ${item.requiresRecipe ? 'Está activa para descontar ingredientes.' : 'Está guardada, pero no es obligatoria para vender.'}</span>`
      : '<b>Sin receta.</b><span>El producto puede venderse normalmente. Configurar una receta es opcional.</span>';
    setError('#editError');
    $('#editDialog').showModal();
  }

  async function saveEdit(event) {
    event.preventDefault();
    setError('#editError');
    const item = state.editItem;
    if (!item) return;
    try {
      const mode = $('#editKind').value;
      const recipe = recipeByProduct().get(item.productId);
      if (mode === 'RECIPE' && !recipe) throw new Error('Primero configura la receta. La Carta no bloqueará este producto hasta que exista.');
      const commercial = $('#editCommercialCategory').value.trim() || $('#editCategory').selectedOptions[0]?.textContent || 'Carta';
      const currentDescription = String(item.product?.descripcion || '');
      const description = !currentDescription || currentDescription.startsWith(PREFIX) ? `${PREFIX}${commercial}` : currentDescription;
      await R.api(`/api/v1/inventario/productos/${item.productId}`, {
        method:'PATCH',
        body:JSON.stringify({
          nombre:$('#editName').value.trim(), precio1:Number($('#editPrice').value || 0), descripcion,
          controlaInventario:mode === 'DIRECT'
        })
      });
      await R.api(`/api/v1/restaurante/menu/${item.id}`, {
        method:'PUT',
        body:JSON.stringify(menuPayload(item, {
          category:$('#editCategory').value, station:$('#editStation').value,
          requiresRecipe:mode === 'RECIPE', active:$('#editActive').checked
        }))
      });
      $('#editDialog').close();
      state.editItem = null;
      await loadData();
    } catch (error) { setError('#editError', error.message); }
  }

  function ingredientOptions(selected = '') {
    const outputId = state.editItem?.productId;
    return state.products
      .filter((product) => product.id !== outputId && product.activo !== false && product.controlaInventario === true)
      .map((product) => `<option value="${esc(product.id)}" ${product.id === selected ? 'selected' : ''}>${esc(product.sku)} · ${esc(product.nombre)} · stock ${number(product.stockActual, 4)} ${esc(product.unidadMedida || '')}</option>`)
      .join('');
  }

  function recipeRow(seed = {}) {
    const id = ++state.recipeRows;
    return `<div class="recipe-row" data-recipe-row="${id}"><label>Insumo<select class="menu-select" data-ingredient required><option value="">Selecciona…</option>${ingredientOptions(seed.ingredientProductId || '')}</select></label><label>Cantidad<input class="menu-input" data-qty type="number" min="0.000001" step="0.000001" value="${esc(seed.quantity || '')}" required></label><label>Unidad<input class="menu-input" data-unit maxlength="30" value="${esc(seed.unitLabel || '')}" placeholder="g, ml, und"></label><button class="recipe-remove" type="button" data-remove-recipe aria-label="Quitar">×</button></div>`;
  }

  function bindRecipeRemove() {
    $$('[data-remove-recipe]', $('#recipeRows')).forEach((button) => button.onclick = () => {
      if ($$('[data-recipe-row]', $('#recipeRows')).length <= 1) return;
      button.closest('[data-recipe-row]')?.remove();
    });
  }

  function openRecipeDialog() {
    const item = state.editItem;
    if (!item) return;
    const stockProducts = state.products.filter((product) => product.id !== item.productId && product.controlaInventario === true && product.activo !== false);
    if (!stockProducts.length) {
      setError('#editError', 'No hay insumos con control de inventario. Primero ingrésalos mediante Compras/Inventario.');
      return;
    }
    const recipe = recipeByProduct().get(item.productId);
    $('#recipeTitle').textContent = `Receta · ${item.product?.nombre || 'Producto'}`;
    state.recipeRows = 0;
    const seeds = Array.isArray(recipe?.items) && recipe.items.length ? recipe.items : [{}];
    $('#recipeRows').innerHTML = seeds.map(recipeRow).join('');
    bindRecipeRemove();
    setError('#recipeError');
    $('#recipeDialog').showModal();
  }

  async function saveRecipe(event) {
    event.preventDefault();
    setError('#recipeError');
    const item = state.editItem;
    if (!item) return;
    try {
      const items = $$('[data-recipe-row]', $('#recipeRows')).map((row) => ({
        ingredientProductId: row.querySelector('[data-ingredient]').value,
        quantity: Number(row.querySelector('[data-qty]').value || 0),
        unitLabel: row.querySelector('[data-unit]').value.trim() || null
      })).filter((row) => row.ingredientProductId && row.quantity > 0);
      if (!items.length) throw new Error('Agrega al menos un insumo válido.');
      const existing = recipeByProduct().get(item.productId);
      if (existing) {
        await R.api(`/api/v1/consumo/recetas/${existing.id}`, { method:'PATCH', body:JSON.stringify({ items, outputProductId:item.productId, active:true }) });
      } else {
        const base = String(item.product?.sku || item.productId).replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 48);
        await R.api('/api/v1/consumo/recetas', {
          method:'POST',
          body:JSON.stringify({ code:`REC-${base}`.slice(0, 60), name:`Receta ${item.product?.nombre || 'producto'}`.slice(0,160), outputProductId:item.productId, active:true, items })
        });
      }
      await R.api(`/api/v1/restaurante/menu/${item.id}`, { method:'PUT', body:JSON.stringify(menuPayload(item, { requiresRecipe:true })) });
      $('#recipeDialog').close();
      $('#editDialog').close();
      state.editItem = null;
      await loadData();
    } catch (error) { setError('#recipeError', error.message); }
  }

  async function loadCanonicalOcr() {
    try {
      const response = await fetch('/app/restaurant-menu-import-ui.js?v=restaurant-v2-menu-v1', { cache:'no-store' });
      if (!response.ok) throw new Error(`OCR UI ${response.status}`);
      const original = await response.text();
      if (!original.includes(OCR_GUARD)) throw new Error('Contrato OCR canónico no reconocido');
      const source = original.replace(OCR_GUARD, OCR_CARTA_GUARD);
      const script = document.createElement('script');
      script.textContent = `${source}\n//# sourceURL=restaurant-menu-import-ui-v2-carta.js`;
      document.head.appendChild(script);
      script.remove();
    } catch (error) {
      console.error('RESTAURANT_V2_MENU_OCR_LOAD_ERROR', error);
      showNotice(`Carta disponible. El importador OCR no pudo cargarse: ${error.message}`, true);
    }
  }

  function bind() {
    $('#refresh').addEventListener('click', loadData);
    $('#newPrepared').addEventListener('click', () => { $('#preparedForm').reset(); $('#preparedCategory').value='FUERTES'; $('#preparedStation').value='COCINA'; setError('#preparedError'); $('#preparedDialog').showModal(); });
    $('#addInventory').addEventListener('click', openInventoryDialog);
    $('#preparedForm').addEventListener('submit', createPrepared);
    $('#inventoryForm').addEventListener('submit', addInventoryProduct);
    $('#editForm').addEventListener('submit', saveEdit);
    $('#configureRecipe').addEventListener('click', openRecipeDialog);
    $('#recipeForm').addEventListener('submit', saveRecipe);
    $('#addRecipeRow').addEventListener('click', () => { $('#recipeRows').insertAdjacentHTML('beforeend', recipeRow()); bindRecipeRemove(); });
    $('#inventorySearch').addEventListener('input', renderInventoryCandidates);
    ['search','categoryFilter','stationFilter','kindFilter','showInactive'].forEach((id) => $(`#${id}`).addEventListener(id === 'search' ? 'input' : 'change', renderMenu));
    $$('[data-close]').forEach((button) => button.addEventListener('click', () => document.getElementById(button.dataset.close)?.close()));
    document.addEventListener('click', (event) => {
      if (event.target.closest?.('#ccOcrDone')) setTimeout(loadData, 120);
    }, true);
  }

  async function boot() {
    $('#restaurantName').textContent = session.tenant?.nombreEmpresa || session.subdomain || 'Carta';
    $('#tenantLine').textContent = `${session.subdomain} · Carta conectada al producto maestro del Super Core`;
    bind();
    await loadData();
    await loadCanonicalOcr();
    window.VantixGCRestaurantV2MenuV1 = Object.freeze({
      marker:'VANTIX_RESTAURANT_V2_MENU_V1', version:'1.0.0',
      preparedWithoutRecipeByDefault:true, directInventoryUsesMasterProduct:true,
      canonicalOcrReused:true, refresh:loadData
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
