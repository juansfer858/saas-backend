'use strict';

const service = require('./restaurant.service');
const menuImport = require('./restaurant-menu-import.service');

const PATCH_FLAG = Symbol.for('vantixgc.restaurant.menu-surface-sync.v10');
const MARKER = 'VANTIX_RESTAURANT_MENU_SURFACE_SYNC_V10';
const natural = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

function tableNaturalCompare(a, b) {
  return natural.compare(String(a?.name || a?.code || ''), String(b?.name || b?.code || ''))
    || natural.compare(String(a?.code || ''), String(b?.code || ''))
    || String(a?.id || '').localeCompare(String(b?.id || ''));
}

function menuRowCompare(a, b) {
  const sortA = Number.isFinite(Number(a?.sortOrder)) ? Number(a.sortOrder) : Number.MAX_SAFE_INTEGER;
  const sortB = Number.isFinite(Number(b?.sortOrder)) ? Number(b.sortOrder) : Number.MAX_SAFE_INTEGER;
  return sortA - sortB
    || new Date(a?.creadoEn || 0).getTime() - new Date(b?.creadoEn || 0).getTime()
    || String(a?.id || '').localeCompare(String(b?.id || ''));
}

function displayCategoryFor(row) {
  const fallback = String(row?.category || '').trim() || 'Menú';
  return menuImport.publicCategoryFromDescription(row?.product?.descripcion, fallback) || fallback;
}

function decorateMenuRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({ ...row, displayCategory: displayCategoryFor(row) }))
    .sort(menuRowCompare);
}

function install() {
  if (service[PATCH_FLAG]) return service[PATCH_FLAG];

  const originalListTables = service.listTables.bind(service);
  const originalListMenu = service.listMenu.bind(service);
  const originalGetQrContext = service.getQrContext.bind(service);

  service.listTables = async function listTablesNatural(tenantId, user = null) {
    const rows = await originalListTables(tenantId, user);
    return (Array.isArray(rows) ? rows : []).sort(tableNaturalCompare);
  };

  service.listMenu = async function listMenuWithDisplayCategory(tenantId, filters = {}) {
    return decorateMenuRows(await originalListMenu(tenantId, filters));
  };

  service.getQrContext = async function getQrContextWithDisplayCategory(qrToken) {
    const context = await originalGetQrContext(qrToken);
    const detailed = await service.listMenu(context.tenantId, { active: true });
    const byId = new Map(detailed.map((row, index) => [row.id, { displayCategory: row.displayCategory, index }]));
    const menu = (Array.isArray(context.menu) ? context.menu : []).map((row) => ({
      ...row,
      displayCategory: byId.get(row.id)?.displayCategory || row.category
    })).sort((a, b) => (byId.get(a.id)?.index ?? Number.MAX_SAFE_INTEGER) - (byId.get(b.id)?.index ?? Number.MAX_SAFE_INTEGER));
    return { ...context, menu };
  };

  const state = { marker: MARKER, tableNaturalCompare, displayCategoryFor, decorateMenuRows };
  Object.defineProperty(service, PATCH_FLAG, { value: state, enumerable: false, configurable: false });
  return state;
}

module.exports = { MARKER, tableNaturalCompare, menuRowCompare, displayCategoryFor, decorateMenuRows, install };
