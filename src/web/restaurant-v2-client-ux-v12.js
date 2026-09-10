/* VANTIX_RESTAURANT_V2_CLIENT_UX_V12 */
(() => {
  'use strict';

  const MARKER = 'VANTIX_RESTAURANT_V2_CLIENT_UX_V12';
  document.documentElement.dataset.restaurantV2ClientUx = MARKER;

  const norm = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  function installSearch() {
    const spotlight = document.getElementById('spotlight');
    const categories = document.getElementById('categoryNav');
    const list = document.getElementById('menuList');
    if (!categories || !list || document.getElementById('p7SearchWrap')) return;

    const wrap = document.createElement('section');
    wrap.id = 'p7SearchWrap';
    wrap.className = 'p7-search-wrap';
    wrap.innerHTML = `<button id="p7SearchToggle" class="p7-search-toggle" type="button" aria-expanded="false">⌕ Buscar producto</button>
      <div id="p7SearchBox" class="p7-search-box" hidden>
        <input id="p7MenuSearch" type="search" inputmode="search" autocomplete="off" placeholder="Buscar producto o categoría…" aria-label="Buscar producto en la carta">
        <button id="p7SearchClear" type="button" aria-label="Limpiar búsqueda">×</button>
      </div>`;
    categories.parentNode.insertBefore(wrap, categories);

    const empty = document.createElement('div');
    empty.id = 'p7SearchEmpty';
    empty.className = 'p7-empty p7-search-empty';
    empty.hidden = true;
    empty.innerHTML = '<b>No encontramos ese producto.</b><span>Prueba con otra palabra o categoría.</span>';
    list.insertAdjacentElement('afterend', empty);

    const toggle = document.getElementById('p7SearchToggle');
    const box = document.getElementById('p7SearchBox');
    const input = document.getElementById('p7MenuSearch');
    const clear = document.getElementById('p7SearchClear');
    const title = document.getElementById('categoryTitle');

    function applyFilter() {
      const query = norm(input.value);
      const rows = [...list.querySelectorAll('.p7-row')];
      if (!query) {
        rows.forEach((row) => { row.hidden = false; });
        empty.hidden = true;
        return;
      }
      const todo = document.querySelector('[data-category="TODO"]');
      if (todo && todo.getAttribute('aria-selected') !== 'true') {
        todo.click();
        return;
      }
      let visible = 0;
      rows.forEach((row) => {
        const match = norm(row.textContent).includes(query);
        row.hidden = !match;
        if (match) visible += 1;
      });
      empty.hidden = visible > 0;
      if (title) title.textContent = `Resultados · ${visible}`;
    }

    toggle.addEventListener('click', () => {
      const opening = box.hidden;
      box.hidden = !opening;
      toggle.setAttribute('aria-expanded', opening ? 'true' : 'false');
      toggle.textContent = opening ? '× Cerrar búsqueda' : '⌕ Buscar producto';
      if (opening) setTimeout(() => input.focus({ preventScroll:true }), 0);
      else {
        input.value = '';
        applyFilter();
        const todo = document.querySelector('[data-category="TODO"]');
        if (todo) todo.click();
      }
    });

    input.addEventListener('input', applyFilter);
    clear.addEventListener('click', () => {
      input.value = '';
      applyFilter();
      input.focus({ preventScroll:true });
    });

    new MutationObserver(() => {
      if (input.value.trim()) requestAnimationFrame(applyFilter);
    }).observe(list, { childList:true, subtree:true });

    if (spotlight) {
      new MutationObserver(() => spotlight.classList.toggle('p7-spotlight-hero', !spotlight.hidden))
        .observe(spotlight, { attributes:true, childList:true, subtree:true, attributeFilter:['hidden'] });
      spotlight.classList.toggle('p7-spotlight-hero', !spotlight.hidden);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installSearch, { once:true });
  else installSearch();
})();
