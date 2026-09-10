/* VANTIX_RESTAURANT_V2_MENU_VISIBLE_CATEGORY_SELECTOR_V14 */
(() => {
  'use strict';

  const R = window.RestaurantV2;
  if (!R) return;

  const DEFAULT_CATEGORIES = Object.freeze(['Entradas', 'Fuertes', 'Bebidas', 'Postres']);
  const select = () => document.getElementById('preparedCommercialCategory');

  function uniqueLabels(values) {
    const seen = new Set();
    const result = [];
    for (const value of values) {
      const label = String(value || '').trim();
      if (!label) continue;
      const key = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(label);
    }
    return result;
  }

  function fallbackFromFilter() {
    const filter = document.getElementById('categoryFilter');
    if (!filter) return [];
    return uniqueLabels([...filter.options].map((option) => option.value).filter(Boolean));
  }

  function render(categories, source) {
    const target = select();
    if (!target) return;
    const current = String(target.value || '').trim();
    const labels = uniqueLabels(categories);
    const finalLabels = labels.length ? labels : DEFAULT_CATEGORIES;
    target.innerHTML = finalLabels
      .map((label) => `<option value="${R.esc(label)}">${R.esc(label)}</option>`)
      .join('');
    if (finalLabels.includes(current)) target.value = current;
    else target.value = finalLabels[0] || 'Fuertes';
    target.dataset.categorySource = source || (labels.length ? 'carta' : 'default');
    target.title = labels.length
      ? 'Categorías visibles existentes en la Carta'
      : 'Categorías base del sistema';
  }

  async function refresh() {
    try {
      const rows = await R.api('/api/v1/restaurante/carta-importacion/lista');
      const categories = uniqueLabels((Array.isArray(rows) ? rows : []).map((row) => row?.category));
      if (categories.length) {
        render(categories, 'carta');
        return categories;
      }
      const filterCategories = fallbackFromFilter();
      render(filterCategories.length ? filterCategories : DEFAULT_CATEGORIES, filterCategories.length ? 'carta' : 'default');
      return filterCategories.length ? filterCategories : [...DEFAULT_CATEGORIES];
    } catch (error) {
      const filterCategories = fallbackFromFilter();
      render(filterCategories.length ? filterCategories : DEFAULT_CATEGORIES, filterCategories.length ? 'carta' : 'default');
      console.warn('RESTAURANT_V2_MENU_CATEGORY_SELECTOR_V14_FALLBACK', error?.message || error);
      return filterCategories.length ? filterCategories : [...DEFAULT_CATEGORIES];
    }
  }

  function bind() {
    document.getElementById('refresh')?.addEventListener('click', () => setTimeout(refresh, 250));
    document.getElementById('newPrepared')?.addEventListener('click', () => refresh());
    document.addEventListener('click', (event) => {
      if (event.target.closest?.('#ccOcrDone')) setTimeout(refresh, 300);
    }, true);
  }

  async function boot() {
    bind();
    await refresh();
    window.VantixGCRestaurantV2MenuCategorySelectorV14 = Object.freeze({
      marker: 'VANTIX_RESTAURANT_V2_MENU_VISIBLE_CATEGORY_SELECTOR_V14',
      importedCategoriesFirst: true,
      defaultCategories: [...DEFAULT_CATEGORIES],
      refresh
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
