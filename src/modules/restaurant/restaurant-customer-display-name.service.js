'use strict';

const { prisma } = require('../../config/prisma');

const CUSTOMER_NAME_TAG = '[RESTAURANTE_CLIENTE]';
const DEFAULT_CUSTOMER_NAME = 'Cliente genérico';

function normalizeCustomerName(value) {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
  return clean || DEFAULT_CUSTOMER_NAME;
}

function stripCustomerNameTag(value) {
  return String(value ?? '')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith(CUSTOMER_NAME_TAG))
    .join('\n')
    .trim();
}

function mergeCustomerNameObservation(value, customerName) {
  const base = stripCustomerNameTag(value);
  const name = normalizeCustomerName(customerName);
  if (name === DEFAULT_CUSTOMER_NAME) return base || null;
  return [base, `${CUSTOMER_NAME_TAG} ${name}`].filter(Boolean).join('\n');
}

function customerNameFromObservations(value) {
  const line = String(value ?? '')
    .split(/\r?\n/)
    .find((row) => row.trim().startsWith(CUSTOMER_NAME_TAG));
  if (!line) return DEFAULT_CUSTOMER_NAME;
  return normalizeCustomerName(line.trim().slice(CUSTOMER_NAME_TAG.length));
}

async function stageCustomerNameForTable(tenantId, tableId, customerName) {
  const session = await prisma.restaurantTableSession.findFirst({
    where: { tenantId, tableId, state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } },
    select: { id: true, saleId: true },
    orderBy: { openedAt: 'desc' }
  });
  if (!session) return null;

  const sale = await prisma.comprobanteComercial.findFirst({
    where: { id: session.saleId, tenantId, tipo: 'FACTURA_VENTA' },
    select: { id: true, estado: true, observaciones: true }
  });
  if (!sale || sale.estado !== 'BORRADOR') return null;

  const nextObservations = mergeCustomerNameObservation(sale.observaciones, customerName);
  if (nextObservations !== sale.observaciones) {
    await prisma.comprobanteComercial.update({
      where: { id: sale.id },
      data: { observaciones: nextObservations }
    });
  }

  return {
    saleId: sale.id,
    previousObservations: sale.observaciones,
    stagedObservations: nextObservations,
    customerName: normalizeCustomerName(customerName)
  };
}

async function restoreCustomerNameIfDraft(stage) {
  if (!stage?.saleId) return false;
  const current = await prisma.comprobanteComercial.findUnique({
    where: { id: stage.saleId },
    select: { estado: true, observaciones: true }
  });
  if (!current || current.estado !== 'BORRADOR' || current.observaciones !== stage.stagedObservations) return false;
  await prisma.comprobanteComercial.update({
    where: { id: stage.saleId },
    data: { observaciones: stage.previousObservations }
  });
  return true;
}

module.exports = {
  CUSTOMER_NAME_TAG,
  DEFAULT_CUSTOMER_NAME,
  normalizeCustomerName,
  stripCustomerNameTag,
  mergeCustomerNameObservation,
  customerNameFromObservations,
  stageCustomerNameForTable,
  restoreCustomerNameIfDraft
};
