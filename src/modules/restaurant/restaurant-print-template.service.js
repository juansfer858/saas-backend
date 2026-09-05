'use strict';

const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');

const STORAGE_KEY = 'restaurantCommandTemplate';
const VERSION = 'RESTAURANT_COMMAND_TEMPLATE_V3';

const DEFAULT_COMMAND_TEMPLATE = Object.freeze({
  version: VERSION,
  itemAlign: 'CENTER',
  noteAlign: 'CENTER',
  seatAlign: 'CENTER',
  headerSize: 'DOUBLE',
  itemSize: 'TALL',
  noteSize: 'TALL',
  showTopTime: false,
  showBottomDateTime: true,
  showTrace: true,
  showSeat: true,
  separatorStyle: 'DOUBLE',
  blankLinesBetweenItems: 1
});

const ALIGNS = new Set(['LEFT', 'CENTER']);
const SIZES = new Set(['NORMAL', 'TALL', 'DOUBLE']);
const HEADER_SIZES = new Set(['NORMAL', 'DOUBLE']);
const SEPARATORS = new Set(['DOUBLE', 'SINGLE', 'NONE']);

function cloneDefault() {
  return { ...DEFAULT_COMMAND_TEMPLATE };
}

function enumValue(value, allowed, fallback) {
  const normalized = String(value || '').trim().toUpperCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function normalizePrintTemplate(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    version: VERSION,
    itemAlign: enumValue(input.itemAlign, ALIGNS, DEFAULT_COMMAND_TEMPLATE.itemAlign),
    noteAlign: enumValue(input.noteAlign, ALIGNS, DEFAULT_COMMAND_TEMPLATE.noteAlign),
    seatAlign: enumValue(input.seatAlign, ALIGNS, DEFAULT_COMMAND_TEMPLATE.seatAlign),
    headerSize: enumValue(input.headerSize, HEADER_SIZES, DEFAULT_COMMAND_TEMPLATE.headerSize),
    itemSize: enumValue(input.itemSize, SIZES, DEFAULT_COMMAND_TEMPLATE.itemSize),
    noteSize: enumValue(input.noteSize, SIZES, DEFAULT_COMMAND_TEMPLATE.noteSize),
    showTopTime: input.showTopTime === undefined ? DEFAULT_COMMAND_TEMPLATE.showTopTime : Boolean(input.showTopTime),
    showBottomDateTime: input.showBottomDateTime === undefined ? DEFAULT_COMMAND_TEMPLATE.showBottomDateTime : Boolean(input.showBottomDateTime),
    showTrace: input.showTrace === undefined ? DEFAULT_COMMAND_TEMPLATE.showTrace : Boolean(input.showTrace),
    showSeat: input.showSeat === undefined ? DEFAULT_COMMAND_TEMPLATE.showSeat : Boolean(input.showSeat),
    separatorStyle: enumValue(input.separatorStyle, SEPARATORS, DEFAULT_COMMAND_TEMPLATE.separatorStyle),
    blankLinesBetweenItems: Math.max(0, Math.min(2, Number.isFinite(Number(input.blankLinesBetweenItems)) ? Math.trunc(Number(input.blankLinesBetweenItems)) : DEFAULT_COMMAND_TEMPLATE.blankLinesBetweenItems))
  };
}

function storedData(config) {
  return config?.themeData && typeof config.themeData === 'object' && !Array.isArray(config.themeData) ? config.themeData : {};
}

async function getPrintTemplate(tenantId, client = prisma) {
  const config = await client.restaurantConfig.upsert({ where: { tenantId }, create: { tenantId }, update: {} });
  const stored = storedData(config);
  const hasOverride = Boolean(stored[STORAGE_KEY] && typeof stored[STORAGE_KEY] === 'object');
  return {
    ...normalizePrintTemplate(hasOverride ? stored[STORAGE_KEY] : DEFAULT_COMMAND_TEMPLATE),
    editable: true,
    source: hasOverride ? 'TENANT_OVERRIDE' : 'RECOMMENDED_DEFAULT'
  };
}

async function auditChange(tenantId, userId, action, before, after) {
  if (!userId) return;
  await prisma.auditoriaContable.create({
    data: {
      tenantId,
      userId,
      entidad: 'RESTAURANT_PRINT_TEMPLATE',
      entidadId: tenantId,
      accion: action,
      metadata: { before, after }
    }
  });
}

async function savePrintTemplate(tenantId, userId, input) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!tenant) throw new AppError(404, 'Tenant no encontrado', 'RESTAURANT_PRINT_TEMPLATE_TENANT_NOT_FOUND');
  const config = await prisma.restaurantConfig.upsert({ where: { tenantId }, create: { tenantId }, update: {} });
  const stored = storedData(config);
  const before = normalizePrintTemplate(stored[STORAGE_KEY] || DEFAULT_COMMAND_TEMPLATE);
  const after = normalizePrintTemplate({ ...before, ...(input || {}) });
  await prisma.restaurantConfig.update({
    where: { tenantId },
    data: { themeData: { ...stored, [STORAGE_KEY]: after } }
  });
  await auditChange(tenantId, userId, 'UPDATE', before, after);
  return { ...after, editable: true, source: 'TENANT_OVERRIDE' };
}

async function resetPrintTemplate(tenantId, userId) {
  const config = await prisma.restaurantConfig.upsert({ where: { tenantId }, create: { tenantId }, update: {} });
  const stored = storedData(config);
  const before = normalizePrintTemplate(stored[STORAGE_KEY] || DEFAULT_COMMAND_TEMPLATE);
  const nextData = { ...stored };
  delete nextData[STORAGE_KEY];
  await prisma.restaurantConfig.update({ where: { tenantId }, data: { themeData: nextData } });
  const after = cloneDefault();
  await auditChange(tenantId, userId, 'RESET', before, after);
  return { ...after, editable: true, source: 'RECOMMENDED_DEFAULT' };
}

module.exports = {
  STORAGE_KEY,
  VERSION,
  DEFAULT_COMMAND_TEMPLATE,
  normalizePrintTemplate,
  getPrintTemplate,
  savePrintTemplate,
  resetPrintTemplate
};