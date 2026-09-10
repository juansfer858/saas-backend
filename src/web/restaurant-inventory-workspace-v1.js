(() => {
  'use strict';

  const MARKER = 'VANTIX_RESTAURANT_INVENTORY_WORKSPACE_V1';
  const SESSION_KEY = 'vantixgc_core_session_v1';
  const INVENTORY_PATH = '/app/inventario';
  const ADMIN_ROLES = new Set(['ADMIN', 'SUPER_ADMIN']);
  let restaurantAccess = null;
  let mountedRoot = null;
  let activeTab = 'products';
  let loadSequence = 0;
  let cache = { products: [], recipes: [], movements: [], menu: [] };
  let scheduled = false;

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  }

  function onInventoryPage() {
    return String(location.pathname || '').replace(/\/$/, '') === INVENTORY_PATH;
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[char]));
  }

  function money(value) {
    const session = readSession();
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: session?.tenant?.moneda || 'COP',
      maximumFractionDigits: 0
    }).format(Number(value || 0));
  }

  function number(value, digits = 2) {
    return new Intl.NumberFormat('es-CO', { maximumFractionDigits: digits }).format(Number(value || 0));
  }

  function dateTime(value) {
    if (!value) return '—';
    try {
      return new Intl.DateTimeFormat('es-CO', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
    } catch { return '—'; }
  }

  function sessionHeaders(body = false) {
    const session = readSession();
    if (!session?.token || !session?.subdomain) throw new Error('Sesión no disponible');
    return {
      Authorization: `Bearer ${session.token}`,
      'x-tenant-subdomain': session.subdomain,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    };
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      cache: 'no-store',
      headers: { ...sessionHeaders(Boolean(options.body)), ...(options.headers || {}) }
    });
    let body = {};
    try { body = await response.json(); } catch {}
    if (!response.ok) throw new Error(body?.error?.message || body?.message || `HTTP ${response.status}`);
    return body?.data;
  }

  async function hasRestaurantAccess() {
    if (restaurantAccess !== null) return restaurantAccess;
    const session = readSession();
    if (!session?.token || !session?.subdomain || !ADMIN_ROLES.has(String(session.user?.rol || '').toUpperCase())) {
      restaurantAccess = false;
      return false;
    }
    try {
      const response = await fetch('/api/v1/restaurante/ui-context', {
        cache: 'no-store',
        headers: sessionHeaders(false)
      });
      restaurantAccess = response.ok;
    } catch {
      restaurantAccess = false;
    }
    return restaurantAccess;
  }

  function ensureStyles() {
    if (document.querySelector('#restaurantInventoryWorkspaceV1Styles')) return;
    const style = document.createElement('style');
    style.id = 'restaurantInventoryWorkspaceV1Styles';
    style.textContent = `
      .riw-tabs{display:flex;gap:6px;flex-wrap:wrap;padding:12px 18px;border-bottom:1px solid var(--border)}
      .riw-tab{border:0;background:transparent;padding:8px 12px;border-radius:8px;cursor:pointer;color:#667085;font-weight:750}
      .riw-tab.active{background:var(--soft);color:var(--green)}
      .riw-summary{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
      .riw-chip{display:inline-flex;align-items:center;padding:5px 8px;border-radius:999px;background:#f2f4f7;color:#475467;font-size:12px;font-weight:750}
      .riw-chip.menu{background:#ecfdf3;color:#027a48}.riw-chip.recipe{background:#eff8ff;color:#175cd3}.riw-chip.ingredient{background:#fff7ed;color:#b54708}
      .riw-search{min-width:240px}
      .riw-muted{color:var(--muted);font-size:12px}
      .riw-recipe-items{display:grid;gap:8px}
      .riw-recipe-row{display:grid;grid-template-columns:minmax(0,1fr) 120px 110px 42px;gap:8px;align-items:end}
      .riw-menu-bridge{display:contents}.riw-menu-bridge>.cc-view-actions{display:contents}.riw-menu-bridge>h1{display:none!important}
      #ccCustomView[data-inventory-menu-bridge] [data-menu-ocr-import]{font:inherit}
      @media(max-width:760px){.riw-search{min-width:0;width:100%}.riw-recipe-row{grid-template-columns:1fr 1fr}.riw-recipe-row>div:first-child{grid-column:span 2}}
    `;
    document.head.appendChild(style);
  }

  function productMaps() {
    const products = Array.isArray(cache.products) ? cache.products : [];
    const recipes = Array.isArray(cache.recipes) ? cache.recipes : [];
    const menu = Array.isArray(cache.menu) ? cache.menu : [];
    const byId = new Map(products.map((product) => [product.id, product]));
    const menuIds = new Set(menu.map((row) => row.productId).filter(Boolean));
    const recipeByOutput = new Map(recipes.filter((row) => row.outputProductId).map((row) => [row.outputProductId, row]));
    const ingredientUsage = new Map();
    for (const recipe of recipes) {
      for (const item of Array.isArray(recipe.items) ? recipe.items : []) {
        const list = ingredientUsage.get(item.ingredientProductId) || [];
        list.push(recipe);
        ingredientUsage.set(item.ingredientProductId, list);
      }
    }
    return { byId, menuIds, recipeByOutput, ingredientUsage };
  }

  function useBadge(product, maps) {
    const badges = [];
    if (maps.menuIds.has(product.id)) badges.push('<span class="riw-chip menu">Carta</span>');
    if (maps.recipeByOutput.has(product.id)) badges.push('<span class="riw-chip recipe">Receta</span>');
    if (maps.ingredientUsage.has(product.id)) badges.push('<span class="riw-chip ingredient">Insumo</span>');
    if (!badges.length) badges.push(`<span class="riw-chip">${product.tipo === 'SERVICIO' ? 'Servicio' : product.controlaInventario ? 'Inventario' : 'Producto'}</span>`);
    return badges.join(' ');
  }

  function statusBadge(active) {
    return active === false ? '<span class="badge b-cancel">Inactivo</span>' : '<span class="badge b-paid">Activo</span>';
  }

  function productsView(filter = '') {
    const maps = productMaps();
    const q = filter.trim().toLowerCase();
    const rows = cache.products.filter((product) => !q || `${product.sku} ${product.nombre} ${product.tipo}`.toLowerCase().includes(q));
    if (!rows.length) return '<div class="empty">No hay productos que coincidan con la búsqueda.</div>';
    return `<div class="table-wrap"><table class="table"><thead><tr><th>SKU</th><th>Producto</th><th>Uso</th><th class="money">Stock</th><th class="money">Costo prom.</th><th class="money">Precio</th><th>Estado</th></tr></thead><tbody>${rows.map((product) => `<tr><td>${esc(product.sku)}</td><td><strong>${esc(product.nombre)}</strong><div class="riw-muted">${esc(product.unidadMedida || 'UND')}${product.controlaInventario ? ' · controla inventario' : ' · sin descuento directo de stock'}</div></td><td><div class="riw-summary">${useBadge(product, maps)}</div></td><td class="money">${product.controlaInventario ? number(product.stockActual, 4) : '—'}</td><td class="money">${product.controlaInventario ? money(product.costoPromedio) : '—'}</td><td class="money"><strong>${money(product.precio1)}</strong></td><td>${statusBadge(product.activo)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function ingredientsView(filter = '') {
    const maps = productMaps();
    const q = filter.trim().toLowerCase();
    const rows = cache.products.filter((product) => maps.ingredientUsage.has(product.id) && (!q || `${product.sku} ${product.nombre}`.toLowerCase().includes(q)));
    if (!rows.length) return '<div class="empty">Aún no hay insumos vinculados a recetas. Crea una receta para relacionar sus ingredientes con el Kardex.</div>';
    return `<div class="table-wrap"><table class="table"><thead><tr><th>SKU</th><th>Insumo</th><th>Usado en</th><th class="money">Stock</th><th class="money">Costo prom.</th><th>Control</th></tr></thead><tbody>${rows.map((product) => {
      const recipes = maps.ingredientUsage.get(product.id) || [];
      return `<tr><td>${esc(product.sku)}</td><td><strong>${esc(product.nombre)}</strong><div class="riw-muted">${esc(product.unidadMedida || 'UND')}</div></td><td>${recipes.slice(0, 3).map((recipe) => esc(recipe.name)).join(', ')}${recipes.length > 3 ? ` +${recipes.length - 3}` : ''}</td><td class="money">${number(product.stockActual, 4)}</td><td class="money">${money(product.costoPromedio)}</td><td>${product.controlaInventario ? '<span class="badge b-paid">Kardex</span>' : '<span class="badge b-cancel">Sin control</span>'}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function recipesView(filter = '') {
    const maps = productMaps();
    const q = filter.trim().toLowerCase();
    const rows = cache.recipes.filter((recipe) => !q || `${recipe.code} ${recipe.name} ${maps.byId.get(recipe.outputProductId)?.nombre || ''}`.toLowerCase().includes(q));
    return `<div class="panel-head"><h2>Recetas</h2><div class="toolbar"><span class="muted">Cada receta descuenta sus insumos reales al vender el producto.</span><button class="btn small primary" type="button" id="riwNewRecipe">+ Nueva receta</button></div></div>${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Código</th><th>Receta</th><th>Producto de salida</th><th>Insumos</th><th>Estado</th></tr></thead><tbody>${rows.map((recipe) => `<tr><td>${esc(recipe.code)}</td><td><strong>${esc(recipe.name)}</strong><div class="riw-muted">Versión ${number(recipe.version || 1, 0)}</div></td><td>${esc(maps.byId.get(recipe.outputProductId)?.nombre || 'Sin producto vinculado')}</td><td>${Array.isArray(recipe.items) ? recipe.items.length : 0}</td><td>${statusBadge(recipe.active)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Aún no hay recetas. Puedes crear una y vincularla a un plato de la carta.</div>'}`;
  }

  function kardexView(filter = '') {
    const q = filter.trim().toLowerCase();
    const rows = cache.movements.filter((movement) => !q || `${movement.producto?.sku || ''} ${movement.producto?.nombre || ''} ${movement.tipo || ''} ${movement.referencia || ''}`.toLowerCase().includes(q));
    if (!rows.length) return '<div class="empty">No hay movimientos de Kardex que coincidan con la búsqueda.</div>';
    return `<div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Producto</th><th>Movimiento</th><th class="money">Cantidad</th><th class="money">Stock</th><th class="money">Costo unit.</th><th class="money">Costo total</th><th>Referencia</th></tr></thead><tbody>${rows.map((movement) => `<tr><td>${esc(dateTime(movement.creadoEn))}</td><td><strong>${esc(movement.producto?.nombre || 'Producto')}</strong><div class="riw-muted">${esc(movement.producto?.sku || '')}</div></td><td>${esc(movement.tipo)}</td><td class="money">${number(movement.cantidad, 4)}</td><td class="money">${number(movement.stockAnterior, 4)} → ${number(movement.stockNuevo, 4)}</td><td class="money">${money(movement.costoUnitario)}</td><td class="money">${money(movement.costoTotal)}</td><td>${esc(movement.referencia || '—')}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function activeView(filter = '') {
    if (activeTab === 'ingredients') return ingredientsView(filter);
    if (activeTab === 'recipes') return recipesView(filter);
    if (activeTab === 'kardex') return kardexView(filter);
    return productsView(filter);
  }

  function normalizeImportButton() {
    const button = document.querySelector('#ccCustomView[data-inventory-menu-bridge] [data-menu-ocr-import]');
    if (!button) return;
    button.classList.remove('cc-ocr-button');
    button.classList.add('btn');
    button.textContent = 'Importar carta';
    button.title = 'Importar carta desde una foto o PDF';
  }

  function renderWorkspace() {
    if (!mountedRoot?.isConnected || !onInventoryPage()) return;
    const products = cache.products.length;
    const maps = productMaps();
    mountedRoot.innerHTML = `
      <div class="pagehead">
        <div><h1>Inventarios / Kardex</h1><p>Productos, insumos, recetas, existencias y movimientos del restaurante.</p></div>
        <div class="actions" id="riwActions">
          <button class="btn primary" type="button" id="inventoryAddProductButton">+ Agregar producto</button>
          <div id="ccCustomView" class="riw-menu-bridge" data-inventory-menu-bridge="v1"><h1>Carta y productos</h1><div class="cc-view-actions"></div></div>
          <button class="btn" type="button" id="riwAdjustment">Ajuste de inventario</button>
        </div>
      </div>
      <div class="cards" style="grid-template-columns:repeat(4,minmax(0,1fr))">
        <div class="card metric"><div class="label">Productos</div><div class="value">${products}</div><div class="hint">catálogo administrativo</div></div>
        <div class="card metric"><div class="label">En carta</div><div class="value">${maps.menuIds.size}</div><div class="hint">visibles para venta</div></div>
        <div class="card metric"><div class="label">Recetas</div><div class="value">${cache.recipes.length}</div><div class="hint">consumo de insumos</div></div>
        <div class="card metric"><div class="label">Insumos</div><div class="value">${maps.ingredientUsage.size}</div><div class="hint">vinculados a recetas</div></div>
      </div>
      <div class="panel" id="riwPanel">
        <div class="riw-tabs">
          <button class="riw-tab ${activeTab === 'products' ? 'active' : ''}" data-riw-tab="products" type="button">Productos</button>
          <button class="riw-tab ${activeTab === 'ingredients' ? 'active' : ''}" data-riw-tab="ingredients" type="button">Insumos</button>
          <button class="riw-tab ${activeTab === 'recipes' ? 'active' : ''}" data-riw-tab="recipes" type="button">Recetas</button>
          <button class="riw-tab ${activeTab === 'kardex' ? 'active' : ''}" data-riw-tab="kardex" type="button">Kardex</button>
        </div>
        ${activeTab === 'recipes' ? '' : `<div class="panel-head"><h2>${activeTab === 'ingredients' ? 'Insumos de recetas' : activeTab === 'kardex' ? 'Movimientos de Kardex' : 'Productos'}</h2><div class="toolbar"><input class="input riw-search" id="riwFilter" placeholder="Buscar en esta vista"><button class="btn small" type="button" id="riwRefresh">Actualizar</button></div></div>`}
        <div id="riwBody">${activeView('')}</div>
      </div>`;

    mountedRoot.querySelector('#inventoryAddProductButton')?.addEventListener('click', () => window.openInventoryProductFormV70?.());
    mountedRoot.querySelector('#riwAdjustment')?.addEventListener('click', () => window.openInventoryAdjustment?.());
    mountedRoot.querySelectorAll('[data-riw-tab]').forEach((button) => button.addEventListener('click', () => {
      activeTab = button.dataset.riwTab || 'products';
      renderWorkspace();
    }));
    mountedRoot.querySelector('#riwRefresh')?.addEventListener('click', () => refresh());
    mountedRoot.querySelector('#riwFilter')?.addEventListener('input', (event) => {
      const body = mountedRoot?.querySelector('#riwBody');
      if (body) body.innerHTML = activeView(event.target.value || '');
    });
    mountedRoot.querySelector('#riwNewRecipe')?.addEventListener('click', openRecipeModal);
    requestAnimationFrame(normalizeImportButton);
  }

  function recipeIngredientRow(index, products) {
    const options = products.map((product) => `<option value="${esc(product.id)}">${esc(product.sku)} · ${esc(product.nombre)} · stock ${number(product.stockActual, 4)} ${esc(product.unidadMedida || '')}</option>`).join('');
    return `<div class="riw-recipe-row" data-recipe-row="${index}"><div class="field"><label>Insumo</label><select class="select" data-recipe-ingredient required><option value="">Selecciona…</option>${options}</select></div><div class="field"><label>Cantidad</label><input class="input" data-recipe-qty type="number" min="0.000001" step="0.000001" required></div><div class="field"><label>Unidad</label><input class="input" data-recipe-unit maxlength="30" placeholder="g, ml, und"></div><button class="btn" type="button" data-recipe-remove title="Quitar">×</button></div>`;
  }

  function openRecipeModal() {
    const stockProducts = cache.products.filter((product) => product.activo !== false && product.tipo !== 'SERVICIO' && product.controlaInventario === true);
    const outputProducts = cache.products.filter((product) => product.activo !== false);
    if (!stockProducts.length) {
      alert('Primero crea al menos un insumo con control de inventario.');
      return;
    }
    document.querySelector('#riwRecipeModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-back" id="riwRecipeModal"><form class="modal" id="riwRecipeForm" style="width:min(780px,100%);max-height:92vh;overflow:auto"><h2>Nueva receta</h2><div class="grid2"><div class="field"><label>Código</label><input class="input" id="riwRecipeCode" maxlength="60" required placeholder="REC-HAMB-001"></div><div class="field"><label>Nombre</label><input class="input" id="riwRecipeName" maxlength="160" required placeholder="Hamburguesa especial"></div></div><div class="field"><label>Producto de la carta / salida</label><select class="select" id="riwRecipeOutput"><option value="">Sin vincular todavía</option>${outputProducts.map((product) => `<option value="${esc(product.id)}">${esc(product.sku)} · ${esc(product.nombre)}</option>`).join('')}</select><div class="riw-muted" style="margin-top:5px">Al vincularlo, una venta de ese producto consumirá los insumos definidos en la receta.</div></div><div class="panel" style="margin-top:12px"><div class="panel-head"><h2>Insumos</h2><button class="btn small" type="button" id="riwAddIngredient">+ Agregar insumo</button></div><div class="audit-body riw-recipe-items" id="riwRecipeItems">${recipeIngredientRow(0, stockProducts)}</div></div><div id="riwRecipeError"></div><div class="actions" style="justify-content:flex-end"><button class="btn" type="button" id="riwRecipeCancel">Cancelar</button><button class="btn primary" type="submit">Guardar receta</button></div></form></div>`);

    let rowIndex = 1;
    const items = document.querySelector('#riwRecipeItems');
    const bindRemove = () => items?.querySelectorAll('[data-recipe-remove]').forEach((button) => {
      button.onclick = () => {
        if ((items?.querySelectorAll('[data-recipe-row]').length || 0) <= 1) return;
        button.closest('[data-recipe-row]')?.remove();
      };
    });
    bindRemove();
    document.querySelector('#riwAddIngredient')?.addEventListener('click', () => {
      items?.insertAdjacentHTML('beforeend', recipeIngredientRow(rowIndex++, stockProducts));
      bindRemove();
    });
    document.querySelector('#riwRecipeCancel')?.addEventListener('click', () => document.querySelector('#riwRecipeModal')?.remove());
    document.querySelector('#riwRecipeForm').onsubmit = async (event) => {
      event.preventDefault();
      const errorBox = document.querySelector('#riwRecipeError');
      if (errorBox) errorBox.innerHTML = '';
      const ingredientRows = [...document.querySelectorAll('#riwRecipeItems [data-recipe-row]')];
      const recipeItems = ingredientRows.map((row) => ({
        ingredientProductId: row.querySelector('[data-recipe-ingredient]').value,
        quantity: Number(row.querySelector('[data-recipe-qty]').value || 0),
        unitLabel: row.querySelector('[data-recipe-unit]').value.trim() || null
      })).filter((item) => item.ingredientProductId && item.quantity > 0);
      try {
        if (!recipeItems.length) throw new Error('Agrega al menos un insumo válido.');
        const outputProductId = document.querySelector('#riwRecipeOutput').value || null;
        await api('/api/v1/consumo/recetas', {
          method: 'POST',
          body: JSON.stringify({
            code: document.querySelector('#riwRecipeCode').value.trim(),
            name: document.querySelector('#riwRecipeName').value.trim(),
            outputProductId,
            active: true,
            items: recipeItems
          })
        });
        document.querySelector('#riwRecipeModal')?.remove();
        activeTab = 'recipes';
        await refresh();
      } catch (error) {
        if (errorBox) errorBox.innerHTML = `<div class="error">${esc(error.message)}</div>`;
      }
    };
  }

  async function loadAll() {
    const seq = ++loadSequence;
    const [products, recipes, movements, menu] = await Promise.all([
      api('/api/v1/inventario/productos?limit=500'),
      api('/api/v1/consumo/recetas?limit=500'),
      api('/api/v1/inventario/kardex?limit=500'),
      api('/api/v1/restaurante/carta-importacion/lista')
    ]);
    if (seq !== loadSequence) return false;
    cache = {
      products: Array.isArray(products) ? products : [],
      recipes: Array.isArray(recipes) ? recipes : [],
      movements: Array.isArray(movements) ? movements : [],
      menu: Array.isArray(menu) ? menu : []
    };
    return true;
  }

  async function refresh() {
    if (!onInventoryPage() || !mountedRoot?.isConnected) return;
    const body = mountedRoot.querySelector('#riwBody');
    if (body) body.innerHTML = '<div class="loading">Actualizando…</div>';
    try {
      await loadAll();
      renderWorkspace();
    } catch (error) {
      if (mountedRoot?.isConnected) mountedRoot.innerHTML = `<div class="pagehead"><div><h1>Inventarios / Kardex</h1><p>Productos, insumos, recetas, existencias y movimientos del restaurante.</p></div></div><div class="error">${esc(error.message)}</div>`;
    }
  }

  async function mount() {
    if (!onInventoryPage()) return;
    if (!(await hasRestaurantAccess())) return;
    ensureStyles();
    const root = document.querySelector('.content');
    if (!root) return;
    if (root.dataset.restaurantInventoryWorkspace === 'v1' && root === mountedRoot) {
      normalizeImportButton();
      return;
    }
    mountedRoot = root;
    root.dataset.restaurantInventoryWorkspace = 'v1';
    root.innerHTML = '<div class="loading">Cargando Inventarios / Kardex…</div>';
    await refresh();
  }

  function scheduleMount() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(async () => {
      scheduled = false;
      if (!onInventoryPage()) return;
      const root = document.querySelector('.content');
      if (!root) return;
      if (root !== mountedRoot || root.dataset.restaurantInventoryWorkspace !== 'v1') await mount();
      normalizeImportButton();
    });
  }

  const observer = new MutationObserver(scheduleMount);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', scheduleMount);
  document.addEventListener('click', (event) => {
    const nav = event.target.closest?.('[data-nav]');
    if (nav) setTimeout(scheduleMount, 0);
  });

  window.VantixGCRestaurantInventoryWorkspaceV1 = Object.freeze({
    marker: MARKER,
    version: '1.0.0',
    refresh: () => refresh(),
    tabs: Object.freeze(['products', 'ingredients', 'recipes', 'kardex'])
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleMount, { once: true });
  else scheduleMount();
})();
