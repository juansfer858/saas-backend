'use strict';

const { prisma } = require('../../config/prisma');

const STORAGE_KEY = 'restaurantDocumentPrintTemplates';
const VERSION = 'RESTAURANT_DOCUMENT_PRINT_TEMPLATES_V1';

const DEFAULT_INVOICE_TEMPLATE = Object.freeze({
  version: VERSION,
  title: null,
  showCompanyName: true,
  showNit: true,
  showAddress: true,
  showCity: true,
  showPhone: true,
  showEmail: true,
  showSaleNumber: true,
  showTable: true,
  showDate: true,
  showCustomerName: true,
  showCustomerDocument: true,
  showCustomerAddress: true,
  showCustomerPhone: true,
  showCustomerEmail: true,
  showUnitPrice: true,
  showSubtotal: true,
  showDiscount: true,
  showTaxes: true,
  showTip: true,
  showPayment: true,
  showReference: true,
  thankYouText: 'Gracias por su compra',
  footerText: ''
});

const DEFAULT_CASH_CLOSE_TEMPLATE = Object.freeze({
  version: VERSION,
  title: 'CIERRE DE TURNO / CAJA',
  showDetailHint: true,
  showInternalNote: true,
  footerText: 'VantixGC · Cierre de caja'
});

function storedData(config) {
  const value = config?.themeData;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function bool(value, fallback = true) {
  return value === undefined ? fallback : Boolean(value);
}

function text(value, maxLength, fallback = '') {
  const cleaned = String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, maxLength) : fallback;
}

function nullableText(value, maxLength) {
  const cleaned = text(value, maxLength, '');
  return cleaned || null;
}

function normalizeInvoiceTemplate(input = {}) {
  return {
    version: VERSION,
    title: nullableText(input.title, 80),
    showCompanyName: bool(input.showCompanyName, true),
    showNit: bool(input.showNit, true),
    showAddress: bool(input.showAddress, true),
    showCity: bool(input.showCity, true),
    showPhone: bool(input.showPhone, true),
    showEmail: bool(input.showEmail, true),
    showSaleNumber: bool(input.showSaleNumber, true),
    showTable: bool(input.showTable, true),
    showDate: bool(input.showDate, true),
    showCustomerName: bool(input.showCustomerName, true),
    showCustomerDocument: bool(input.showCustomerDocument, true),
    showCustomerAddress: bool(input.showCustomerAddress, true),
    showCustomerPhone: bool(input.showCustomerPhone, true),
    showCustomerEmail: bool(input.showCustomerEmail, true),
    showUnitPrice: bool(input.showUnitPrice, true),
    showSubtotal: bool(input.showSubtotal, true),
    showDiscount: bool(input.showDiscount, true),
    showTaxes: bool(input.showTaxes, true),
    showTip: bool(input.showTip, true),
    showPayment: bool(input.showPayment, true),
    showReference: bool(input.showReference, true),
    thankYouText: text(input.thankYouText, 80, DEFAULT_INVOICE_TEMPLATE.thankYouText),
    footerText: text(input.footerText, 96, '')
  };
}

function normalizeCashCloseTemplate(input = {}) {
  return {
    version: VERSION,
    title: text(input.title, 80, DEFAULT_CASH_CLOSE_TEMPLATE.title),
    showDetailHint: bool(input.showDetailHint, true),
    showInternalNote: bool(input.showInternalNote, true),
    footerText: text(input.footerText, 96, DEFAULT_CASH_CLOSE_TEMPLATE.footerText)
  };
}

async function configForTenant(tenantId, client = prisma) {
  return client.restaurantConfig.upsert({
    where: { tenantId },
    create: { tenantId },
    update: {},
    select: { themeData: true }
  });
}

async function getDocumentPrintTemplates(tenantId, client = prisma) {
  const config = await configForTenant(tenantId, client);
  const root = storedData(config);
  const saved = root[STORAGE_KEY] && typeof root[STORAGE_KEY] === 'object' ? root[STORAGE_KEY] : {};
  const hasInvoice = Boolean(saved.invoice && typeof saved.invoice === 'object');
  const hasCashClose = Boolean(saved.cashClose && typeof saved.cashClose === 'object');
  return {
    version: VERSION,
    invoice: {
      ...normalizeInvoiceTemplate(hasInvoice ? saved.invoice : DEFAULT_INVOICE_TEMPLATE),
      source: hasInvoice ? 'TENANT_OVERRIDE' : 'RECOMMENDED_DEFAULT'
    },
    cashClose: {
      ...normalizeCashCloseTemplate(hasCashClose ? saved.cashClose : DEFAULT_CASH_CLOSE_TEMPLATE),
      source: hasCashClose ? 'TENANT_OVERRIDE' : 'RECOMMENDED_DEFAULT'
    }
  };
}

async function audit(tenantId, userId, action, target, before, after, client = prisma) {
  if (!userId || !client.auditoriaContable?.create) return;
  await client.auditoriaContable.create({
    data: {
      tenantId,
      userId,
      entidad: 'RESTAURANT_DOCUMENT_PRINT_TEMPLATE',
      entidadId: tenantId,
      accion: action,
      metadata: { target, before, after, version: VERSION }
    }
  });
}

async function saveTarget(tenantId, userId, target, input, client = prisma) {
  const config = await configForTenant(tenantId, client);
  const root = storedData(config);
  const saved = root[STORAGE_KEY] && typeof root[STORAGE_KEY] === 'object' ? root[STORAGE_KEY] : {};
  const normalize = target === 'invoice' ? normalizeInvoiceTemplate : normalizeCashCloseTemplate;
  const defaults = target === 'invoice' ? DEFAULT_INVOICE_TEMPLATE : DEFAULT_CASH_CLOSE_TEMPLATE;
  const before = normalize(saved[target] || defaults);
  const after = normalize({ ...before, ...(input || {}) });
  const nextTemplates = { ...saved, version: VERSION, [target]: after };
  await client.restaurantConfig.update({
    where: { tenantId },
    data: { themeData: { ...root, [STORAGE_KEY]: nextTemplates } }
  });
  await audit(tenantId, userId, 'UPDATE', target, before, after, client);
  return { ...after, source: 'TENANT_OVERRIDE' };
}

async function resetTarget(tenantId, userId, target, client = prisma) {
  const config = await configForTenant(tenantId, client);
  const root = storedData(config);
  const saved = root[STORAGE_KEY] && typeof root[STORAGE_KEY] === 'object' ? root[STORAGE_KEY] : {};
  const normalize = target === 'invoice' ? normalizeInvoiceTemplate : normalizeCashCloseTemplate;
  const defaults = target === 'invoice' ? DEFAULT_INVOICE_TEMPLATE : DEFAULT_CASH_CLOSE_TEMPLATE;
  const before = normalize(saved[target] || defaults);
  const nextTemplates = { ...saved };
  delete nextTemplates[target];
  const nextRoot = { ...root };
  if (Object.keys(nextTemplates).filter((key) => key !== 'version').length) {
    nextRoot[STORAGE_KEY] = { ...nextTemplates, version: VERSION };
  } else {
    delete nextRoot[STORAGE_KEY];
  }
  await client.restaurantConfig.update({ where: { tenantId }, data: { themeData: nextRoot } });
  const after = normalize(defaults);
  await audit(tenantId, userId, 'RESET', target, before, after, client);
  return { ...after, source: 'RECOMMENDED_DEFAULT' };
}

module.exports = {
  STORAGE_KEY,
  VERSION,
  DEFAULT_INVOICE_TEMPLATE,
  DEFAULT_CASH_CLOSE_TEMPLATE,
  normalizeInvoiceTemplate,
  normalizeCashCloseTemplate,
  getDocumentPrintTemplates,
  saveInvoiceTemplate:(tenantId,userId,input,client=prisma)=>saveTarget(tenantId,userId,'invoice',input,client),
  resetInvoiceTemplate:(tenantId,userId,client=prisma)=>resetTarget(tenantId,userId,'invoice',client),
  saveCashCloseTemplate:(tenantId,userId,input,client=prisma)=>saveTarget(tenantId,userId,'cashClose',input,client),
  resetCashCloseTemplate:(tenantId,userId,client=prisma)=>resetTarget(tenantId,userId,'cashClose',client)
};
