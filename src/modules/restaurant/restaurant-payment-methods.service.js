'use strict';

const crypto = require('node:crypto');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const identity = require('./restaurant-identity.service');

const KINDS = Object.freeze(['EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'CREDITO']);

function normalizeMethods(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row) => row && typeof row === 'object')
    .map((row, index) => ({
      id: String(row.id || '').trim() || crypto.randomUUID(),
      name: String(row.name || '').trim().slice(0, 80),
      kind: String(row.kind || '').toUpperCase(),
      cajaBancoId: row.cajaBancoId ? String(row.cajaBancoId) : null,
      active: row.active !== false,
      sortOrder: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : (index + 1) * 10
    }))
    .filter((row) => row.name && KINDS.includes(row.kind));
}

async function validateAccount(tenantId, kind, cajaBancoId, client = prisma) {
  if (kind === 'CREDITO') return null;
  const id = String(cajaBancoId || '').trim();
  if (!id) throw new AppError(400, kind === 'EFECTIVO' ? 'Seleccione la caja que recibe el efectivo' : 'Seleccione la cuenta bancaria que recibe el pago', 'RESTAURANT_PAYMENT_ACCOUNT_REQUIRED');
  const row = await client.cajaBanco.findFirst({ where: { id, tenantId, activo: true } });
  if (!row) throw new AppError(400, 'Caja o banco no disponible', 'RESTAURANT_PAYMENT_ACCOUNT_INVALID');
  if (kind === 'EFECTIVO' && row.tipo !== 'CAJA') throw new AppError(400, 'Efectivo debe apuntar a una Caja', 'RESTAURANT_PAYMENT_CASH_ACCOUNT_REQUIRED');
  if (['TRANSFERENCIA', 'TARJETA'].includes(kind) && row.tipo !== 'BANCO') throw new AppError(400, 'Transferencia y tarjeta deben apuntar a una cuenta Banco', 'RESTAURANT_PAYMENT_BANK_ACCOUNT_REQUIRED');
  return row;
}

async function defaultMethods(tenantId, client = prisma) {
  const accounts = await client.cajaBanco.findMany({ where: { tenantId, activo: true }, orderBy: [{ tipo: 'asc' }, { nombre: 'asc' }] });
  const cash = accounts.find((row) => row.tipo === 'CAJA') || null;
  const banks = accounts.filter((row) => row.tipo === 'BANCO');
  const rows = [];
  if (cash) rows.push({ id: crypto.randomUUID(), name: 'Efectivo', kind: 'EFECTIVO', cajaBancoId: cash.id, active: true, sortOrder: 10 });
  banks.forEach((bank, index) => rows.push({ id: crypto.randomUUID(), name: bank.nombre, kind: 'TRANSFERENCIA', cajaBancoId: bank.id, active: true, sortOrder: 20 + index * 10 }));
  // Crédito necesita tercero/cartera; se deja disponible para configurar, pero nunca activo por defecto.
  rows.push({ id: crypto.randomUUID(), name: 'Crédito', kind: 'CREDITO', cajaBancoId: null, active: false, sortOrder: 900 });
  return rows;
}

async function listMethods(tenantId, client = prisma) {
  const config = await client.restaurantConfig.upsert({ where: { tenantId }, create: { tenantId }, update: {} });
  let rows = normalizeMethods(config.paymentMethods);
  if (!rows.length) {
    rows = await defaultMethods(tenantId, client);
    await client.restaurantConfig.update({ where: { tenantId }, data: { paymentMethods: rows } });
  }
  const accountIds = [...new Set(rows.map((row) => row.cajaBancoId).filter(Boolean))];
  const accounts = accountIds.length ? await client.cajaBanco.findMany({ where: { tenantId, id: { in: accountIds } }, select: { id: true, tipo: true, nombre: true, banco: true, numeroCuenta: true, activo: true } }) : [];
  const byId = new Map(accounts.map((row) => [row.id, row]));
  return rows.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'es')).map((row) => ({ ...row, account: row.cajaBancoId ? byId.get(row.cajaBancoId) || null : null }));
}

async function saveMethod(tenantId, methodId, input) {
  const kind = String(input.kind || '').toUpperCase();
  if (!KINDS.includes(kind)) throw new AppError(400, 'Tipo de método de pago inválido', 'RESTAURANT_PAYMENT_KIND_INVALID');
  const name = String(input.name || '').trim();
  if (name.length < 2 || name.length > 80) throw new AppError(400, 'Nombre del método de pago inválido', 'RESTAURANT_PAYMENT_NAME_INVALID');
  const account = await validateAccount(tenantId, kind, input.cajaBancoId || null);
  const config = await prisma.restaurantConfig.upsert({ where: { tenantId }, create: { tenantId }, update: {} });
  const rows = normalizeMethods(config.paymentMethods);
  const id = methodId || crypto.randomUUID();
  const duplicate = rows.find((row) => row.id !== id && row.name.toLocaleLowerCase('es') === name.toLocaleLowerCase('es'));
  if (duplicate) throw new AppError(409, 'Ya existe un método de pago con ese nombre', 'RESTAURANT_PAYMENT_METHOD_DUPLICATE');
  const next = {
    id,
    name,
    kind,
    cajaBancoId: account?.id || null,
    active: input.active !== false,
    sortOrder: Number.isFinite(Number(input.sortOrder)) ? Math.max(0, Math.min(Number(input.sortOrder), 10000)) : 100
  };
  const index = rows.findIndex((row) => row.id === id);
  if (methodId && index < 0) throw new AppError(404, 'Método de pago no encontrado', 'RESTAURANT_PAYMENT_METHOD_NOT_FOUND');
  if (index >= 0) rows[index] = next; else rows.push(next);
  await prisma.restaurantConfig.update({ where: { tenantId }, data: { paymentMethods: rows } });
  return (await listMethods(tenantId)).find((row) => row.id === id);
}

async function deactivateMethod(tenantId, methodId) {
  const config = await prisma.restaurantConfig.upsert({ where: { tenantId }, create: { tenantId }, update: {} });
  const rows = normalizeMethods(config.paymentMethods);
  const index = rows.findIndex((row) => row.id === methodId);
  if (index < 0) throw new AppError(404, 'Método de pago no encontrado', 'RESTAURANT_PAYMENT_METHOD_NOT_FOUND');
  rows[index] = { ...rows[index], active: false };
  await prisma.restaurantConfig.update({ where: { tenantId }, data: { paymentMethods: rows } });
  return { ...rows[index] };
}

function formaPagoForKind(kind) {
  if (kind === 'EFECTIVO') return 'EFECTIVO';
  if (kind === 'CREDITO') return 'CREDITO';
  return 'BANCO';
}

async function closeTableWithMethod(tenantId, user, tableId, input) {
  const methods = await listMethods(tenantId);
  const method = methods.find((row) => row.id === input.paymentMethodId && row.active);
  if (!method) throw new AppError(400, 'Seleccione un método de pago activo', 'RESTAURANT_PAYMENT_METHOD_REQUIRED');
  if (method.kind === 'CREDITO') throw new AppError(409, 'El crédito requiere identificar al cliente y generar cartera. Actívalo desde el flujo de crédito cuando esté configurado.', 'RESTAURANT_CREDIT_CUSTOMER_REQUIRED');
  await validateAccount(tenantId, method.kind, method.cajaBancoId || null);

  const session = await prisma.restaurantTableSession.findFirst({
    where: { tenantId, tableId, state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } },
    orderBy: { openedAt: 'desc' }
  });
  if (!session) throw new AppError(404, 'No hay cuenta abierta para esta mesa', 'RESTAURANT_SESSION_NOT_FOUND');

  const openShift = await prisma.aperturaCierreCaja.findFirst({
    where: { tenantId, userId: user.id, estado: 'ABIERTA' },
    orderBy: { abiertoEn: 'desc' }
  });
  if (!openShift) throw new AppError(409, 'Abra el turno de Caja antes de registrar cobros', 'RESTAURANT_CASH_SHIFT_REQUIRED');

  const reference = String(input.reference || '').trim().slice(0, 160) || null;
  const previous = {
    paymentMethodId: session.paymentMethodId,
    paymentMethodLabel: session.paymentMethodLabel,
    paymentMethodKind: session.paymentMethodKind,
    paymentAccountId: session.paymentAccountId,
    paymentReference: session.paymentReference
  };

  await prisma.restaurantTableSession.update({
    where: { id: session.id },
    data: {
      paymentMethodId: method.id,
      paymentMethodLabel: method.name,
      paymentMethodKind: method.kind,
      paymentAccountId: method.cajaBancoId || null,
      paymentReference: reference
    }
  });

  try {
    const result = await identity.closeTableGuarded(tenantId, user, tableId, {
      formaPago: formaPagoForKind(method.kind),
      cajaBancoId: method.cajaBancoId || null,
      tipAmount: Number(input.tipAmount || 0),
      split: input.split || { mode: 'NONE' }
    });
    const refreshed = await prisma.restaurantTableSession.update({
      where: { id: result.session.id },
      data: {
        cashShiftId: result.session.cashShiftId || openShift.id,
        paymentMethodId: method.id,
        paymentMethodLabel: method.name,
        paymentMethodKind: method.kind,
        paymentAccountId: method.cajaBancoId || null,
        paymentReference: reference
      }
    });
    return { ...result, session: refreshed, paymentMethod: method };
  } catch (error) {
    await prisma.restaurantTableSession.updateMany({
      where: { id: session.id, tenantId, state: { in: ['ABIERTA', 'CUENTA_PEDIDA'] } },
      data: previous
    }).catch(() => {});
    throw error;
  }
}

module.exports = {
  KINDS,
  listMethods,
  saveMethod,
  deactivateMethod,
  closeTableWithMethod,
  formaPagoForKind
};
