const crypto = require('node:crypto');
const QRCode = require('qrcode');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const liveTables = require('./restaurant-live-tables.service');

function normalizeBaseUrl(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return null;
  let parsed;
  try { parsed = new URL(raw); } catch { throw new AppError(500, 'RESTAURANT_PUBLIC_BASE_URL inválida', 'RESTAURANT_PUBLIC_BASE_URL_INVALID'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new AppError(500, 'RESTAURANT_PUBLIC_BASE_URL debe usar HTTP o HTTPS', 'RESTAURANT_PUBLIC_BASE_URL_INVALID');
  return raw;
}

function publicBaseUrl() {
  const configured = normalizeBaseUrl(process.env.RESTAURANT_PUBLIC_BASE_URL);
  if (configured) return configured;
  const tenantBaseDomain = String(process.env.TENANT_BASE_DOMAIN || '').trim().replace(/^\.+|\.+$/g, '');
  if (!tenantBaseDomain) throw new AppError(500, 'Configure RESTAURANT_PUBLIC_BASE_URL o TENANT_BASE_DOMAIN para generar QR públicos', 'RESTAURANT_PUBLIC_BASE_URL_REQUIRED');
  return `https://core.${tenantBaseDomain}`;
}

function buildPublicTableUrl(qrToken) {
  if (!qrToken) throw new AppError(500, 'La mesa no tiene token QR', 'RESTAURANT_QR_TOKEN_REQUIRED');
  return `${publicBaseUrl()}/r/${encodeURIComponent(qrToken)}`;
}

async function svgForUrl(url) {
  return QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 512,
    color: { dark: '#111827', light: '#FFFFFF' }
  });
}

async function zoneNames(tenantId, zoneIds) {
  const ids = [...new Set(zoneIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await prisma.restaurantZone.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, name: true } });
  return new Map(rows.map((row) => [row.id, row.name]));
}

async function materialize(table, zoneName = null) {
  const url = buildPublicTableUrl(table.qrToken);
  return {
    tableId: table.id,
    tableCode: table.code,
    tableName: table.name,
    zoneId: table.zoneId || null,
    zoneName: zoneName || 'Sin zona',
    url,
    svg: await svgForUrl(url)
  };
}

async function visibleMaterials(tenantId, user, filters = {}) {
  let tables = await liveTables.listTablesLive(tenantId, user);
  if (filters.tableId) tables = tables.filter((table) => table.id === filters.tableId);
  if (filters.zoneId) tables = tables.filter((table) => table.zoneId === filters.zoneId);
  if (!tables.length) return [];
  const zones = await zoneNames(tenantId, tables.map((table) => table.zoneId));
  return Promise.all(tables.map((table) => materialize(table, zones.get(table.zoneId) || null)));
}

async function tableMaterial(tenantId, user, tableId) {
  const rows = await visibleMaterials(tenantId, user, { tableId });
  if (!rows.length) throw new AppError(404, 'Mesa no encontrada o no visible para este usuario', 'RESTAURANT_TABLE_NOT_FOUND');
  return rows[0];
}

async function regenerateTableQr(tenantId, tableId) {
  const updated = await prisma.$transaction(async (tx) => {
    const table = await tx.restaurantTable.findFirst({ where: { id: tableId, tenantId, active: true } });
    if (!table) throw new AppError(404, 'Mesa no encontrada', 'RESTAURANT_TABLE_NOT_FOUND');
    const row = await tx.restaurantTable.update({ where: { id: table.id }, data: { qrToken: crypto.randomUUID() } });
    await tx.auditoriaContable.create({
      data: {
        tenantId,
        userId: null,
        entidad: 'RESTAURANT_TABLE_QR',
        entidadId: table.id,
        accion: 'REGENERATE',
        metadata: { tableCode: table.code, tableName: table.name, regeneratedAt: new Date().toISOString() }
      }
    });
    return row;
  });
  const zones = await zoneNames(tenantId, [updated.zoneId]);
  return materialize(updated, zones.get(updated.zoneId) || null);
}

module.exports = {
  publicBaseUrl,
  buildPublicTableUrl,
  tableMaterial,
  visibleMaterials,
  regenerateTableQr
};
