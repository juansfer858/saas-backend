'use strict';

const express = require('express');
const sync = require('./restaurant-menu-surface-sync.service');

sync.install();

const router = express.Router();
const MARKER = 'VANTIX_RESTAURANT_MENU_SURFACES_V10';

function patchDesktopRuntime(source) {
  let out = String(source);
  if (out.includes(`${MARKER}_DESKTOP`)) return out;
  const loadMenuNeedle = "async function loadMenu() { S.menu = await api('/api/v1/restaurante/menu'); return S.menu; }";
  const loadMenuReplacement = `${loadMenuNeedle}\n  const ${MARKER}_DESKTOP = true;\n  function waiterDisplayCategory(item) { return String(item?.displayCategory || item?.category || '').trim() || 'Menú'; }\n  function waiterMenuCategories() { const seen=new Set(), rows=[]; for (const item of S.menu || []) { const label=waiterDisplayCategory(item); if (!seen.has(label)) { seen.add(label); rows.push(label); } } return rows; }`;
  const categoryNeedle = `const category = S.waiterCategory || 'ENTRADAS';\n    const visibleMenu = S.menu.filter((item) => item.category === category && (!search || String(item.product?.nombre || '').toLocaleLowerCase('es').includes(search)));`;
  const categoryReplacement = `const menuCategories = waiterMenuCategories();\n    if (!S.waiterCategory || !menuCategories.includes(S.waiterCategory)) S.waiterCategory = menuCategories[0] || null;\n    const category = S.waiterCategory || '';\n    const visibleMenu = S.menu.filter((item) => waiterDisplayCategory(item) === category && (!search || String(item.product?.nombre || '').toLocaleLowerCase('es').includes(search)));`;
  const tabsNeedle = "${['ENTRADAS','FUERTES','BEBIDAS','POSTRES'].map((cat) => `<button type=\"button\" class=\"${cat === category ? 'active' : ''}\" data-waiter-category=\"${cat}\">${cat}</button>`).join('')}";
  const tabsReplacement = "${menuCategories.map((cat) => `<button type=\"button\" class=\"${cat === category ? 'active' : ''}\" data-waiter-category=\"${esc(cat)}\">${esc(cat)}</button>`).join('')}";
  for (const needle of [loadMenuNeedle, categoryNeedle, tabsNeedle]) {
    if (!out.includes(needle)) throw new Error('RESTAURANT_MENU_SURFACE_DESKTOP_PATCH_TARGET_NOT_FOUND');
  }
  out = out
    .replace("waiterCategory: 'ENTRADAS',", 'waiterCategory: null,')
    .replace(loadMenuNeedle, loadMenuReplacement)
    .replace(categoryNeedle, categoryReplacement)
    .replace(tabsNeedle, tabsReplacement);
  return out;
}

function patchWaiterTabletRuntime(source) {
  let out = String(source);
  if (out.includes(`${MARKER}_TABLET`)) return out;
  const categoriesNeedle = "const CATEGORIES = ['ENTRADAS','FUERTES','BEBIDAS','POSTRES'];";
  const categoriesReplacement = `const ${MARKER}_TABLET = true;\n  function menuDisplayCategory(item) { return String(item?.displayCategory || item?.category || '').trim() || 'Menú'; }\n  function menuCategories() { const seen=new Set(), rows=[]; for (const item of S.menu || []) { const label=menuDisplayCategory(item); if (!seen.has(label)) { seen.add(label); rows.push(label); } } return rows; }`;
  const tabsNeedle = `root.innerHTML = CATEGORIES.map((category) => \`<button type="button" class="wv-btn wv-tab \${category === S.category ? 'active' : ''}" data-category="\${category}">\${category}</button>\`).join('');`;
  const tabsReplacement = `const categories = menuCategories();\n    if (!S.category || !categories.includes(S.category)) S.category = categories[0] || null;\n    root.innerHTML = categories.map((category) => \`<button type="button" class="wv-btn wv-tab \${category === S.category ? 'active' : ''}" data-category="\${esc(category)}">\${esc(category)}</button>\`).join('');`;
  const visibleNeedle = `return S.menu.filter((item) => item.category === S.category && (!needle || String(item.product?.nombre || '').toLocaleLowerCase('es').includes(needle)));`;
  const visibleReplacement = `return S.menu.filter((item) => menuDisplayCategory(item) === S.category && (!needle || String(item.product?.nombre || '').toLocaleLowerCase('es').includes(needle)));`;
  for (const needle of [categoriesNeedle, tabsNeedle, visibleNeedle]) {
    if (!out.includes(needle)) throw new Error('RESTAURANT_MENU_SURFACE_TABLET_PATCH_TARGET_NOT_FOUND');
  }
  return out
    .replace(categoriesNeedle, categoriesReplacement)
    .replace("category:'ENTRADAS',", 'category:null,')
    .replace(tabsNeedle, tabsReplacement)
    .replace(visibleNeedle, visibleReplacement);
}

function patchQrRuntime(source) {
  let out = String(source);
  if (out.includes(`${MARKER}_QR`)) return out;
  const filtersNeedle = `const FILTERS = [\n    { id:'FEATURED', label:'★ MÁS PEDIDOS' },\n    { id:'ENTRADAS', label:'ENTRADAS' },\n    { id:'FUERTES', label:'FUERTES' },\n    { id:'BEBIDAS', label:'BEBIDAS' },\n    { id:'POSTRES', label:'POSTRES' }\n  ];`;
  const filtersReplacement = `const ${MARKER}_QR = true;\n  const FEATURED_FILTER = { id:'FEATURED', label:'★ MÁS PEDIDOS' };\n  function menuDisplayCategory(item) { return String(item?.displayCategory || item?.category || '').trim() || 'Menú'; }\n  function categoryFilters() { const seen=new Set(), rows=[FEATURED_FILTER]; for (const item of products()) { const label=menuDisplayCategory(item); if (!seen.has(label)) { seen.add(label); rows.push({ id:label, label }); } } return rows; }`;
  const visibleNeedle = `return rows.filter((item) => item.category === S.filter);`;
  const titleNeedle = `const filter = FILTERS.find((row) => row.id === S.filter);`;
  const navNeedle = `nav.innerHTML = FILTERS.map((filter) => \`<button class="qrv3-filter" type="button" data-filter="\${filter.id}" aria-selected="\${filter.id === S.filter ? 'true' : 'false'}">\${filter.label}</button>\`).join('');`;
  for (const needle of [filtersNeedle, visibleNeedle, titleNeedle, navNeedle]) {
    if (!out.includes(needle)) throw new Error('RESTAURANT_MENU_SURFACE_QR_PATCH_TARGET_NOT_FOUND');
  }
  return out
    .replace(filtersNeedle, filtersReplacement)
    .replace(visibleNeedle, `return rows.filter((item) => menuDisplayCategory(item) === S.filter);`)
    .replace(titleNeedle, `const filter = categoryFilters().find((row) => row.id === S.filter);`)
    .replace(navNeedle, `nav.innerHTML = categoryFilters().map((filter) => \`<button class="qrv3-filter" type="button" data-filter="\${esc(filter.id)}" aria-selected="\${filter.id === S.filter ? 'true' : 'false'}">\${esc(filter.label)}</button>\`).join('');`);
}

function installMenuSurfaceSyncRuntime(req, res, next) {
  const paths = ['/app/restaurant-ui.js', '/app/restaurant-waiter-runtime-v7.js', '/app/restaurant-qr-ui.js'];
  if (req.method !== 'GET' || !paths.includes(req.path)) return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source) {
      let patched;
      let surface;
      if (req.path === '/app/restaurant-ui.js') { patched = patchDesktopRuntime(source); surface = 'desktop-v10'; }
      else if (req.path === '/app/restaurant-waiter-runtime-v7.js') { patched = patchWaiterTabletRuntime(source); surface = 'tablet-v10'; }
      else { patched = patchQrRuntime(source); surface = 'qr-v10'; }
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
      res.set('X-VantixGC-Menu-Surface-Sync', surface);
    }
    return originalSend(body);
  };
  return next();
}

router.get('/api/public/restaurante/menu-surface-readiness', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok:true, data:{ marker:MARKER, displayCategory:'PRODUCT_DESCRIPTION_CATEGORY', operationalCategoryPreserved:true, tableOrder:'NATURAL_NUMERIC', surfaces:['DESKTOP_WAITER','WAITER_TABLET','CLIENT_QR'] } });
});

module.exports = { MARKER, restaurantMenuSurfaceSyncPublicRouter:router, installMenuSurfaceSyncRuntime, patchDesktopRuntime, patchWaiterTabletRuntime, patchQrRuntime };
