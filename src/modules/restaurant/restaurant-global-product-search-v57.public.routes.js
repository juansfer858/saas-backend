'use strict';

const MARKER = 'VANTIX_RESTAURANT_GLOBAL_PRODUCT_SEARCH_V57';
const HEADER_VALUE = 'v57-all-menu';

function requiredReplace(source, needle, replacement, label) {
  if (!source.includes(needle)) throw new Error(`${MARKER}_${label}_TARGET_NOT_FOUND`);
  // String.replace interpreta `$$` dentro de un replacement string como un solo `$`.
  // Usar callback conserva el replacement literalmente; esto es crítico porque el
  // helper de selección múltiple del Centro es `$$`, mientras `$` devuelve un solo nodo.
  return source.replace(needle, () => replacement);
}

function replaceRange(source, startNeedle, endNeedle, replacement, label) {
  const start = source.indexOf(startNeedle);
  if (start < 0) throw new Error(`${MARKER}_${label}_START_NOT_FOUND`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  if (end < 0) throw new Error(`${MARKER}_${label}_END_NOT_FOUND`);
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
}

function patchQrSource(source) {
  let out = String(source || '');
  if (!out || out.includes(MARKER)) return out;

  out = requiredReplace(
    out,
    "  const S = { ctx:null, cart:new Map(), filter:'FEATURED', sending:false };",
    "  const S = { ctx:null, cart:new Map(), filter:'FEATURED', search:'', sending:false };",
    'QR_STATE'
  );

  const newVisible = `  function normalizeGlobalMenuSearch(value) {\n    return String(value ?? '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLocaleLowerCase('es').trim();\n  }\n\n  function globalMenuSearchTokens(value) {\n    return normalizeGlobalMenuSearch(value).split(/\\s+/).filter(Boolean);\n  }\n\n  function globalMenuHaystack(item) {\n    return normalizeGlobalMenuSearch([item?.product?.name, item?.product?.nombre, item?.product?.descripcion, item?.category, item?.displayCategory, item?.station].filter(Boolean).join(' '));\n  }\n\n  function ensureGlobalProductSearch() {\n    if (document.getElementById('qrGlobalProductSearch')) return;\n    const anchor = $('#app');\n    if (!anchor?.parentNode) return;\n    const style = document.createElement('style');\n    style.id = 'restaurantGlobalProductSearchV57Styles';\n    style.textContent = '.qrv57-search{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px;align-items:center;margin:14px 0;padding:12px;border:1px solid #d7ddd9;border-radius:16px;background:#fff}.qrv57-search input{min-width:0;width:100%;min-height:48px;padding:0 14px;border:1px solid #c7cfca;border-radius:12px;font:inherit}.qrv57-search button{min-height:48px;padding:0 14px;border-radius:12px;border:1px solid #176b45;background:#176b45;color:#fff;font-weight:900}.qrv57-search button[data-clear]{border-color:#c7cfca;background:#fff;color:#46514b}.qrv57-search small{grid-column:1/-1;color:#657069;font-weight:750}@media(max-width:560px){.qrv57-search{grid-template-columns:1fr 1fr}.qrv57-search input{grid-column:1/-1}}';\n    document.head.appendChild(style);\n    const box = document.createElement('section');\n    box.id = 'qrGlobalProductSearch';\n    box.className = 'qrv57-search';\n    box.innerHTML = '<input id="qrGlobalProductSearchInput" type="search" autocomplete="off" enterkeyhint="search" placeholder="Buscar en toda la carta…"><button type="button" data-search>BUSCAR</button><button type="button" data-clear>LIMPIAR</button><small>Busca en todas las categorías. Ejemplo: café.</small>';\n    anchor.parentNode.insertBefore(box, anchor);\n    const input = box.querySelector('input');\n    const apply = () => { S.search = input?.value || ''; renderProducts(); };\n    box.querySelector('[data-search]')?.addEventListener('click', apply);\n    box.querySelector('[data-clear]')?.addEventListener('click', () => { if (input) input.value = ''; S.search = ''; renderProducts(); });\n    input?.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); apply(); } });\n  }\n\n  function visibleProducts() {\n    const rows = products();\n    const tokens = globalMenuSearchTokens(S.search);\n    if (tokens.length) return rows.filter((item) => item.available !== false && tokens.every((token) => globalMenuHaystack(item).includes(token)));\n    if (S.filter === 'FEATURED') {\n      const available = rows.filter((item) => item.available);\n      const spotlightId = clientSpotlight()?.item?.id;\n      const withoutSpotlight = (available.length ? available : rows).filter((item) => item.id !== spotlightId);\n      return withoutSpotlight.slice(0, 6);\n    }\n    return rows.filter((item) => (typeof menuDisplayCategory === 'function' ? menuDisplayCategory(item) : item.category) === S.filter);\n  }\n\n`;
  out = replaceRange(out, '  function visibleProducts() {', '  function titleForFilter() {', newVisible, 'QR_VISIBLE_PRODUCTS');

  out = requiredReplace(
    out,
    "  function titleForFilter() {\n    if (S.filter === 'FEATURED') return { title:'Más pedidos', subtitle:'Una selección rápida de la carta.' };",
    "  function titleForFilter() {\n    if (globalMenuSearchTokens(S.search).length) return { title:`Resultados para “${String(S.search || '').trim()}”`, subtitle:'Buscando en toda la carta, sin importar categoría.' };\n    if (S.filter === 'FEATURED') return { title:'Más pedidos', subtitle:'Una selección rápida de la carta.' };",
    'QR_TITLE'
  );

  out = requiredReplace(
    out,
    "      S.filter = button.dataset.filter;\n      renderNav();",
    "      S.filter = button.dataset.filter;\n      S.search = '';\n      const globalSearchInput = $('#qrGlobalProductSearchInput');\n      if (globalSearchInput) globalSearchInput.value = '';\n      renderNav();",
    'QR_CATEGORY_CLEAR'
  );

  out = requiredReplace(
    out,
    "    const featured = S.filter === 'FEATURED' && index < 2;",
    "    const featured = !globalMenuSearchTokens(S.search).length && S.filter === 'FEATURED' && index < 2;",
    'QR_FEATURED'
  );

  out = requiredReplace(
    out,
    "  function spotlightMarkup() {\n    const spotlight = clientSpotlight();",
    "  function spotlightMarkup() {\n    if (globalMenuSearchTokens(S.search).length) return '';\n    const spotlight = clientSpotlight();",
    'QR_SPOTLIGHT'
  );

  out = requiredReplace(
    out,
    "  function renderProducts() {\n    const app = $('#app');\n    if (!app || !S.ctx) return;",
    "  function renderProducts() {\n    const app = $('#app');\n    if (!app || !S.ctx) return;\n    ensureGlobalProductSearch();",
    'QR_RENDER_SEARCH'
  );

  return `/* ${MARKER} · QR · búsqueda global de carta */\n${out}`;
}

function patchOperatorSource(source) {
  let out = String(source || '');
  if (!out || out.includes(MARKER)) return out;

  out = requiredReplace(
    out,
    "  const number = (v) => Number(v || 0);",
    "  const number = (v) => Number(v || 0);\n  const normalizeGlobalMenuSearch = (value) => String(value ?? '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLocaleLowerCase('es').trim();\n  const globalMenuSearchTokens = (value) => normalizeGlobalMenuSearch(value).split(/\\s+/).filter(Boolean);\n  const globalMenuSearchMatches = (item, tokens) => { const haystack = normalizeGlobalMenuSearch([item?.product?.nombre, item?.product?.descripcion, item?.product?.codigo, item?.category, item?.displayCategory, item?.station].filter(Boolean).join(' ')); return tokens.every((token) => haystack.includes(token)); };",
    'OP_HELPERS'
  );

  const searchBlock = `    const searchTokens = globalMenuSearchTokens(S.waiterSearch);\n    const menuCategories = typeof waiterMenuCategories === 'function' ? waiterMenuCategories() : [...new Set((S.menu || []).map((item) => String(item?.displayCategory || item?.category || '').trim()).filter(Boolean))];\n    if (!S.waiterCategory || !menuCategories.includes(S.waiterCategory)) S.waiterCategory = menuCategories[0] || null;\n    const category = S.waiterCategory || '';\n    const visibleMenu = S.menu.filter((item) => {\n      if (searchTokens.length) return globalMenuSearchMatches(item, searchTokens);\n      const displayCategory = typeof waiterDisplayCategory === 'function' ? waiterDisplayCategory(item) : String(item?.displayCategory || item?.category || '').trim();\n      return displayCategory === category;\n    });\n`;
  out = replaceRange(
    out,
    "    const search = String(S.waiterSearch || '').trim().toLocaleLowerCase('es');",
    '    const canEditService =',
    searchBlock,
    'OP_VISIBLE_MENU'
  );

  out = requiredReplace(
    out,
    '<div class="waiter-search-row"><input id="waiterSearch" class="ri-input" placeholder="Buscar producto…" value="${esc(S.waiterSearch || \'\')}"><span class="ri-muted">',
    '<div class="waiter-search-row"><input id="waiterSearch" class="ri-input" placeholder="Buscar en toda la carta…" value="${esc(S.waiterSearch || \'\')}"><button type="button" class="ri-btn primary" id="waiterGlobalSearch">BUSCAR</button><button type="button" class="ri-btn" id="waiterGlobalSearchClear">LIMPIAR</button><span class="ri-muted">',
    'OP_SEARCH_CONTROLS'
  );

  out = requiredReplace(
    out,
    "    $$('[data-waiter-category]').forEach((button) => button.addEventListener('click', () => { S.waiterCategory=button.dataset.waiterCategory; renderWaiter().catch((error)=>message(error.message,true)); }));",
    "    $$('[data-waiter-category]').forEach((button) => button.addEventListener('click', () => { S.waiterCategory=button.dataset.waiterCategory; S.waiterSearch=''; renderWaiter().catch((error)=>message(error.message,true)); }));",
    'OP_CATEGORY_CLEAR'
  );

  const oldInput = `    $('#waiterSearch')?.addEventListener('input', (event) => {\n      S.waiterSearch=event.target.value;\n      const needle=String(S.waiterSearch||'').trim().toLocaleLowerCase('es');\n      $$('[data-waiter-product]').forEach((card)=>{card.hidden=Boolean(needle)&&!String(card.dataset.waiterProduct||'').includes(needle);});\n    });`;
  const newInput = `    const runGlobalWaiterSearch = () => {\n      const input = $('#waiterSearch');\n      S.waiterSearch = input?.value || '';\n      renderWaiter().then(() => { const node = $('#waiterSearch'); if (node) { node.focus(); node.setSelectionRange?.(node.value.length, node.value.length); } }).catch((error)=>message(error.message,true));\n    };\n    $('#waiterSearch')?.addEventListener('input', (event) => { S.waiterSearch=event.target.value; });\n    $('#waiterSearch')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); runGlobalWaiterSearch(); } });\n    $('#waiterGlobalSearch')?.addEventListener('click', runGlobalWaiterSearch);\n    $('#waiterGlobalSearchClear')?.addEventListener('click', () => { S.waiterSearch=''; renderWaiter().catch((error)=>message(error.message,true)); });`;
  out = requiredReplace(out, oldInput, newInput, 'OP_SEARCH_EVENTS');

  return `/* ${MARKER} · Centro/Mesero · búsqueda global de carta */\n${out}`;
}

function patchDedicatedWaiterSource(source) {
  let out = String(source || '');
  if (!out || out.includes(MARKER)) return out;

  out = requiredReplace(
    out,
    "  const touch = () => { S.lastInteraction = Date.now(); };",
    "  const touch = () => { S.lastInteraction = Date.now(); };\n  const normalizeGlobalMenuSearch = (value) => String(value ?? '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLocaleLowerCase('es').trim();\n  const globalMenuSearchTokens = (value) => normalizeGlobalMenuSearch(value).split(/\\s+/).filter(Boolean);\n  const globalMenuSearchMatches = (item, tokens) => { const haystack = normalizeGlobalMenuSearch([item?.product?.nombre, item?.product?.descripcion, item?.product?.codigo, item?.category, item?.displayCategory, item?.station].filter(Boolean).join(' ')); return tokens.every((token) => haystack.includes(token)); };",
    'WAITER_HELPERS'
  );

  const visibleFunction = `  function visibleMenuRows() {\n    const tokens = globalMenuSearchTokens(S.search);\n    return S.menu.filter((item) => {\n      if (tokens.length) return globalMenuSearchMatches(item, tokens);\n      const displayCategory = typeof menuDisplayCategory === 'function' ? menuDisplayCategory(item) : String(item?.displayCategory || item?.category || '').trim();\n      return displayCategory === S.category;\n    });\n  }\n\n`;
  out = replaceRange(out, '  function visibleMenuRows() {', '  function renderMenuGrid() {', visibleFunction, 'WAITER_VISIBLE_MENU');

  out = requiredReplace(
    out,
    'placeholder="Buscar producto…"',
    'placeholder="Buscar en toda la carta…"',
    'WAITER_PLACEHOLDER'
  );

  out = requiredReplace(
    out,
    "    if (meta) meta.textContent = `${rows.length} producto${rows.length === 1 ? '' : 's'}`;",
    "    if (meta) meta.textContent = `${rows.length} producto${rows.length === 1 ? '' : 's'}${globalMenuSearchTokens(S.search).length ? ' · toda la carta' : ''}`;",
    'WAITER_META'
  );

  out = requiredReplace(
    out,
    "    if (target.dataset.category) {\n      S.category = target.dataset.category;\n      S.menuLimit = MENU_PAGE;",
    "    if (target.dataset.category) {\n      S.category = target.dataset.category;\n      S.search = '';\n      const globalSearch = document.querySelector('#wvSearch');\n      if (globalSearch) globalSearch.value = '';\n      S.menuLimit = MENU_PAGE;",
    'WAITER_CATEGORY_CLEAR'
  );

  return `/* ${MARKER} · Tablet Mesero · búsqueda global de carta */\n${out}`;
}

function patchAsset(pathname, source) {
  if (pathname === '/app/restaurant-qr-ui.js') return patchQrSource(source);
  if (pathname === '/app/restaurant-ui.js') return patchOperatorSource(source);
  if (pathname === '/app/restaurant-waiter-runtime-v7.js') return patchDedicatedWaiterSource(source);
  return source;
}

function installRestaurantGlobalProductSearchV57(req, res, next) {
  if (req.method !== 'GET' || !['/app/restaurant-qr-ui.js', '/app/restaurant-ui.js', '/app/restaurant-waiter-runtime-v7.js'].includes(req.path)) return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source) {
      const patched = patchAsset(req.path, source);
      if (patched !== source) body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
      res.set('X-VantixGC-Global-Product-Search', HEADER_VALUE);
    }
    return originalSend(body);
  };
  return next();
}

module.exports = {
  MARKER,
  HEADER_VALUE,
  patchQrSource,
  patchOperatorSource,
  patchDedicatedWaiterSource,
  patchAsset,
  installRestaurantGlobalProductSearchV57
};