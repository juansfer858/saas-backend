const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { money, qty } = require('../../utils/decimal');
const accountingService = require('../accounting/accounting.service');
const supportService = require('../accounting/accounting-supports.service');
const inventoryService = require('../inventory/inventory.service');
const treasuryService = require('../treasury/treasury.service');
const {
  ensureRuntimeTables,
  getIntegrationConfig,
  updateIntegrationConfig,
  getThirdPartyOperation,
  updateThirdPartyOperation
} = require('./core-integration.runtime');
const { ACCOUNTING_INTEGRATION_MAPPINGS, MAPPING_BY_KEY } = require('./core-integration.mappings');

function source(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9).toUpperCase()}`;
}

async function ensureIntegrationDefaults(tenantId, client = prisma) {
  await ensureRuntimeTables(client);
  await getIntegrationConfig(tenantId, client);
  const existing = await client.mapeoContable.findMany({ where: { tenantId }, select: { clave: true } });
  const present = new Set(existing.map((x) => x.clave));
  for (const item of ACCOUNTING_INTEGRATION_MAPPINGS) {
    if (present.has(item.clave)) continue;
    const account = await client.cuentaPUC.findFirst({
      where: { tenantId, codigo: item.defaultCode, activa: true, permiteMovimiento: true }
    });
    if (!account) continue;
    await client.mapeoContable.upsert({
      where: { tenantId_clave: { tenantId, clave: item.clave } },
      create: { tenantId, clave: item.clave, cuentaId: account.id },
      update: {}
    });
  }
}

async function requireMapped(client, tenantId, key) {
  const mapping = await client.mapeoContable.findUnique({
    where: { tenantId_clave: { tenantId, clave: key } },
    include: { cuenta: true }
  });
  const def = MAPPING_BY_KEY.get(key);
  if (!mapping?.cuenta?.activa || !mapping.cuenta.permiteMovimiento) {
    throw new AppError(
      409,
      `Configure la cuenta contable de ${def?.label || key} antes de continuar.`,
      'ACCOUNTING_MAPPING_REQUIRED',
      { clave: key, label: def?.label || key }
    );
  }
  return mapping.cuenta;
}

async function getParametrization(tenantId) {
  await ensureIntegrationDefaults(tenantId);
  const [mappings, accounts, cashBanks, config] = await Promise.all([
    prisma.mapeoContable.findMany({ where: { tenantId }, include: { cuenta: true } }),
    prisma.cuentaPUC.findMany({
      where: { tenantId, activa: true, permiteMovimiento: true },
      select: { id: true, codigo: true, nombre: true, naturaleza: true },
      orderBy: { codigo: 'asc' }
    }),
    prisma.cajaBanco.findMany({
      where: { tenantId, activo: true },
      include: { cuentaContable: { select: { id: true, codigo: true, nombre: true } } },
      orderBy: [{ tipo: 'asc' }, { nombre: 'asc' }]
    }),
    getIntegrationConfig(tenantId)
  ]);
  const byKey = new Map(mappings.map((x) => [x.clave, x]));
  return {
    config,
    parametros: ACCOUNTING_INTEGRATION_MAPPINGS.map((def) => ({
      ...def,
      cuentaId: byKey.get(def.clave)?.cuentaId || null,
      cuenta: byKey.get(def.clave)?.cuenta || null,
      configurado: Boolean(byKey.get(def.clave)?.cuenta?.activa && byKey.get(def.clave)?.cuenta?.permiteMovimiento)
    })),
    cuentas: accounts,
    cajasBancos: cashBanks
  };
}

async function updateParametrization(tenantId, input) {
  return prisma.$transaction(async (tx) => {
    await ensureIntegrationDefaults(tenantId, tx);
    if (input.mappings) {
      for (const [key, accountId] of Object.entries(input.mappings)) {
        if (!MAPPING_BY_KEY.has(key)) throw new AppError(400, `Parámetro contable desconocido: ${key}`, 'ACCOUNTING_MAPPING_KEY_INVALID');
        const account = await tx.cuentaPUC.findFirst({ where: { id: accountId, tenantId, activa: true, permiteMovimiento: true } });
        if (!account) throw new AppError(400, `Cuenta inválida para ${key}`, 'ACCOUNTING_MAPPING_ACCOUNT_INVALID');
        await tx.mapeoContable.upsert({
          where: { tenantId_clave: { tenantId, clave: key } },
          create: { tenantId, clave: key, cuentaId: account.id },
          update: { cuentaId: account.id }
        });
      }
    }
    for (const item of input.cajasBancos || []) {
      const [cash, account] = await Promise.all([
        tx.cajaBanco.findFirst({ where: { id: item.cajaBancoId, tenantId, activo: true } }),
        tx.cuentaPUC.findFirst({ where: { id: item.cuentaContableId, tenantId, activa: true, permiteMovimiento: true } })
      ]);
      if (!cash || !account) throw new AppError(400, 'Caja/Banco o cuenta contable inválida', 'TREASURY_ACCOUNT_INVALID');
      await tx.cajaBanco.update({ where: { id: cash.id }, data: { cuentaContableId: account.id } });
    }
    if (input.config) await updateIntegrationConfig(tenantId, input.config, tx);
    return true;
  }).then(() => getParametrization(tenantId));
}

async function closedPeriod(tenantId, date, client = prisma) {
  const d = new Date(date || Date.now());
  return client.periodoContable.findUnique({
    where: { tenantId_anio_mes: { tenantId, anio: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 } }
  });
}

async function preflightCommercialInput(tenantId, type, input, client = prisma) {
  await ensureIntegrationDefaults(tenantId, client);
  const config = await getIntegrationConfig(tenantId, client);
  if (input.estado === 'BORRADOR') return { config, required: [] };
  const period = await closedPeriod(tenantId, input.fecha || new Date(), client);
  if (period?.estado === 'CERRADO') throw new AppError(409, 'El periodo contable está cerrado para la fecha del documento', 'ACCOUNTING_PERIOD_CLOSED');

  if (type === 'FACTURA_VENTA' && config.exigirTerceroVentas && !input.terceroId) {
    throw new AppError(400, 'La venta requiere seleccionar un cliente/tercero.', 'SALE_THIRD_PARTY_REQUIRED');
  }
  if (type === 'COMPRA' && config.exigirTerceroCompras && !input.terceroId) {
    throw new AppError(400, 'La compra requiere seleccionar un proveedor/tercero.', 'PURCHASE_SUPPLIER_REQUIRED');
  }

  const productIds = [...new Set((input.detalles || []).map((x) => x.productoId).filter(Boolean))];
  const products = productIds.length ? await client.producto.findMany({ where: { tenantId, id: { in: productIds }, activo: true } }) : [];
  const inventory = products.some((x) => x.tipo === 'PRODUCTO' && x.controlaInventario);
  const expense = type === 'COMPRA' && (products.some((x) => x.tipo === 'SERVICIO' || !x.controlaInventario) || (input.detalles || []).some((x) => !x.productoId));
  const hasIva = (input.detalles || []).some((x) => Number(x.ivaPct || 0) > 0);
  const required = [];
  if (type === 'FACTURA_VENTA') required.push('VENTAS');
  if (type === 'COMPRA' && inventory) required.push('INVENTARIO');
  if (type === 'COMPRA' && expense) required.push('GASTO_COMPRA');
  if (type === 'FACTURA_VENTA' && inventory) required.push('INVENTARIO', 'COSTO_VENTAS');
  if (hasIva) required.push(type === 'FACTURA_VENTA' ? 'IMPUESTO_VENTA' : 'IMPUESTO_COMPRA');
  if (input.formaPago === 'CREDITO') required.push(type === 'FACTURA_VENTA' ? 'CLIENTES' : 'PROVEEDORES');
  else if (!input.cajaBancoId) throw new AppError(400, 'Seleccione la Caja/Banco para una operación de contado.', 'PAYMENT_ACCOUNT_REQUIRED');
  else {
    const cash = await client.cajaBanco.findFirst({ where: { id: input.cajaBancoId, tenantId, activo: true } });
    if (!cash) throw new AppError(400, 'Caja/Banco inválida', 'CASH_BANK_NOT_FOUND');
    if (!cash.cuentaContableId) required.push(cash.tipo === 'BANCO' ? 'BANCO_GENERAL' : 'CAJA_GENERAL');
  }
  for (const key of [...new Set(required)]) await requireMapped(client, tenantId, key);
  return { config, required };
}

async function preflightExistingDocument(tenantId, documentId) {
  const document = await prisma.comprobanteComercial.findFirst({
    where: { id: documentId, tenantId },
    include: { detalles: true }
  });
  if (!document) throw new AppError(404, 'Documento no encontrado', 'COMMERCIAL_DOCUMENT_NOT_FOUND');
  return preflightCommercialInput(tenantId, document.tipo, {
    estado: 'EMITIDO',
    terceroId: document.terceroId,
    fecha: document.fecha,
    formaPago: document.formaPago,
    cajaBancoId: document.cajaBancoId,
    detalles: document.detalles
  });
}

async function resolveCashAccount(tx, tenantId, cajaBancoId) {
  const cash = await treasuryService.getCajaBanco(tenantId, cajaBancoId, tx);
  if (cash.cuentaContableId) {
    const account = await tx.cuentaPUC.findFirst({ where: { id: cash.cuentaContableId, tenantId, activa: true, permiteMovimiento: true } });
    if (account) return { cash, account };
  }
  return { cash, account: await requireMapped(tx, tenantId, cash.tipo === 'BANCO' ? 'BANCO_GENERAL' : 'CAJA_GENERAL') };
}

async function createInventoryAdjustment(tenantId, userId, input) {
  if (['FALTANTE', 'MERMA'].includes(input.tipo) && !input.soporte) {
    throw new AppError(400, 'El faltante o merma exige adjuntar soporte.', 'INVENTORY_ADJUSTMENT_SUPPORT_REQUIRED');
  }
  return prisma.$transaction(async (tx) => {
    await ensureIntegrationDefaults(tenantId, tx);
    const product = await inventoryService.getProduct(tenantId, input.productoId, tx);
    if (!product.controlaInventario || product.tipo !== 'PRODUCTO') throw new AppError(409, 'El producto no controla inventario', 'INVENTORY_PRODUCT_NOT_CONTROLLED');
    const reference = source('AJINV');
    const movementType = input.tipo === 'SOBRANTE' ? 'AJUSTE_ENTRADA' : input.tipo === 'MERMA' ? 'MERMA' : 'AJUSTE_SALIDA';
    const result = await inventoryService.applyMovement(tx, {
      tenantId,
      productoId: product.id,
      tipo: movementType,
      cantidad: input.cantidad,
      costoUnitario: input.tipo === 'SOBRANTE' ? (input.costoUnitario ?? product.costoPromedio) : undefined,
      referencia: reference
    });
    const value = money(result.costOfMovement);
    const inventoryAccount = await requireMapped(tx, tenantId, 'INVENTARIO');
    const counterpart = await requireMapped(tx, tenantId, input.tipo === 'SOBRANTE' ? 'INGRESO_SOBRANTE_INVENTARIO' : 'GASTO_FALTANTE_INVENTARIO');
    const details = input.tipo === 'SOBRANTE'
      ? [
          { cuentaId: inventoryAccount.id, debito: value, credito: 0, concepto: `${input.tipo}: ${input.justificacion}` },
          { cuentaId: counterpart.id, debito: 0, credito: value, concepto: `${input.tipo}: ${input.justificacion}` }
        ]
      : [
          { cuentaId: counterpart.id, debito: value, credito: 0, concepto: `${input.tipo}: ${input.justificacion}` },
          { cuentaId: inventoryAccount.id, debito: 0, credito: value, concepto: `${input.tipo}: ${input.justificacion}` }
        ];
    const journal = await accountingService.createJournalInTx(tx, {
      tenantId, userId, sourceId: `ACC-${reference}`, fecha: input.fecha || new Date(),
      concepto: `Ajuste de inventario ${input.tipo} · ${product.nombre}`, referencia: reference, detalles
    });
    let support = null;
    if (input.soporte) support = await supportService.addSupportInTx(tx, tenantId, userId, journal.id, input.soporte);
    return { referencia: reference, movimiento: result.movement, producto: result.product, asiento: journal, soporte: support, metodoCosteo: result.metodoCosteo };
  });
}

async function transferOwnFunds(tenantId, userId, input) {
  if (input.origenId === input.destinoId) throw new AppError(400, 'Origen y destino deben ser distintos', 'TREASURY_TRANSFER_SAME_ACCOUNT');
  return prisma.$transaction(async (tx) => {
    await ensureIntegrationDefaults(tenantId, tx);
    const amount = money(input.monto);
    const reference = input.referencia || source('TRF');
    const [origin, destination] = await Promise.all([
      resolveCashAccount(tx, tenantId, input.origenId),
      resolveCashAccount(tx, tenantId, input.destinoId)
    ]);
    await treasuryService.recordTreasuryMovementInTx(tx, { tenantId, userId, cajaBancoId: origin.cash.id, tipo: 'TRASLADO_SALIDA', monto: amount, sign: -1, referencia: reference, concepto: input.concepto || 'Transferencia entre cuentas propias' });
    await treasuryService.recordTreasuryMovementInTx(tx, { tenantId, userId, cajaBancoId: destination.cash.id, tipo: 'TRASLADO_ENTRADA', monto: amount, sign: 1, referencia: reference, concepto: input.concepto || 'Transferencia entre cuentas propias' });
    const journal = await accountingService.createJournalInTx(tx, {
      tenantId, userId, sourceId: `ACC-${reference}`, fecha: input.fecha || new Date(), referencia: reference,
      concepto: input.concepto || 'Transferencia entre cuentas propias',
      detalles: [
        { cuentaId: destination.account.id, debito: amount, credito: 0, concepto: reference },
        { cuentaId: origin.account.id, debito: 0, credito: amount, concepto: reference }
      ]
    });
    return { referencia: reference, asiento: journal };
  });
}

async function directExpense(tenantId, userId, input) {
  return prisma.$transaction(async (tx) => {
    await ensureIntegrationDefaults(tenantId, tx);
    const period = await closedPeriod(tenantId, input.fecha || new Date(), tx);
    if (period?.estado === 'CERRADO') throw new AppError(409, 'El periodo contable está cerrado para la fecha del gasto', 'ACCOUNTING_PERIOD_CLOSED');
    const expense = await tx.cuentaPUC.findFirst({ where: { id: input.cuentaGastoId, tenantId, activa: true, permiteMovimiento: true } });
    if (!expense) throw new AppError(400, 'Cuenta de gasto inválida', 'TREASURY_EXPENSE_ACCOUNT_INVALID');
    if (expense.requiereTercero && !input.terceroId) throw new AppError(400, 'La cuenta de gasto exige tercero', 'ACCOUNTING_THIRD_PARTY_REQUIRED');
    if (input.terceroId) {
      const third = await tx.tercero.findFirst({ where: { id: input.terceroId, tenantId, activo: true } });
      if (!third) throw new AppError(400, 'Tercero inválido', 'ACCOUNTING_THIRD_PARTY_INVALID');
    }
    const cash = await resolveCashAccount(tx, tenantId, input.cajaBancoId);
    const amount = money(input.monto), reference = input.referencia || source('GTO');
    await treasuryService.recordTreasuryMovementInTx(tx, {
      tenantId, userId, cajaBancoId: cash.cash.id, tipo: 'EGRESO', monto: amount, sign: -1,
      referencia: reference, concepto: input.concepto
    });
    const journal = await accountingService.createJournalInTx(tx, {
      tenantId, userId, sourceId: `ACC-${reference}`, fecha: input.fecha || new Date(), referencia: reference, concepto: input.concepto,
      detalles: [
        { cuentaId: expense.id, terceroId: input.terceroId || null, debito: amount, credito: 0, concepto: input.concepto },
        { cuentaId: cash.account.id, debito: 0, credito: amount, concepto: input.concepto }
      ]
    });
    return { referencia: reference, asiento: journal };
  });
}

async function applyMultiplePayments(tenantId, userId, input) {
  return prisma.$transaction(async (tx) => {
    await ensureIntegrationDefaults(tenantId, tx);
    if (!input.aplicaciones?.length) throw new AppError(400, 'Debe indicar al menos una factura', 'PAYMENT_APPLICATIONS_REQUIRED');
    const cash = await resolveCashAccount(tx, tenantId, input.cajaBancoId);
    let expectedThird = null;
    const results = [];
    for (let i = 0; i < input.aplicaciones.length; i += 1) {
      const application = input.aplicaciones[i];
      const document = await tx.comprobanteComercial.findFirst({
        where: { id: application.documentoId, tenantId, tipo: input.tipo === 'CXC' ? 'FACTURA_VENTA' : 'COMPRA', estado: { in: ['EMITIDO', 'PAGADO_PARCIAL', 'CONFIRMADO'] } }
      });
      if (!document || document.formaPago !== 'CREDITO' || !document.terceroId) throw new AppError(404, 'Documento de cartera inválido', 'PAYMENT_DOCUMENT_NOT_FOUND');
      if (expectedThird && expectedThird !== document.terceroId) throw new AppError(409, 'Una aplicación múltiple solo puede cruzar facturas del mismo tercero', 'PAYMENT_MULTIPLE_THIRD_PARTY_MISMATCH');
      expectedThird = document.terceroId;
      const cartera = await tx.cartera.findFirst({ where: { tenantId, comprobanteId: document.id, tipo: input.tipo, estado: { in: ['PENDIENTE', 'PARCIAL'] } } });
      if (!cartera) throw new AppError(404, 'Cartera pendiente no encontrada', 'PAYMENT_RECEIVABLE_NOT_FOUND');
      const amount = money(application.monto);
      if (amount.lte(0) || amount.gt(money(cartera.saldo))) throw new AppError(400, 'Monto de aplicación inválido', 'PAYMENT_AMOUNT_INVALID', { documentoId: document.id, saldo: money(cartera.saldo).toString() });
      const isSale = input.tipo === 'CXC', receiptType = isSale ? 'RECIBO_CAJA' : 'COMPROBANTE_EGRESO';
      const receiptNumber = source(isSale ? 'RC' : 'CE');
      const receipt = await tx.comprobanteComercial.create({
        data: {
          tenantId, tipo: receiptType, numero: receiptNumber, estado: 'EMITIDO', documentoOrigenId: document.id,
          terceroId: document.terceroId, cajaBancoId: cash.cash.id, creadoPorId: userId,
          formaPago: input.metodoPago === 'EFECTIVO' ? 'EFECTIVO' : 'BANCO', fecha: input.fecha || new Date(), emitidoEn: new Date(),
          observaciones: input.referencia || `Aplicación a ${document.numero}`, subtotal: amount, total: amount, saldo: 0
        }
      });
      await treasuryService.recordTreasuryMovementInTx(tx, {
        tenantId, userId, cajaBancoId: cash.cash.id, comprobanteId: receipt.id,
        tipo: isSale ? 'INGRESO' : 'EGRESO', monto: amount, sign: isSale ? 1 : -1,
        referencia: receipt.numero, concepto: `Pago ${document.numero}`
      });
      const previous = money(cartera.saldo), next = money(previous.minus(amount));
      await tx.cartera.update({ where: { id: cartera.id }, data: { saldo: next, estado: next.eq(0) ? 'PAGADA' : 'PARCIAL' } });
      await tx.movimientoCartera.create({
        data: { tenantId, carteraId: cartera.id, comprobanteId: receipt.id, tipo: 'ABONO', valor: amount, saldoAnterior: previous, saldoNuevo: next, referencia: receipt.numero, concepto: `Abono ${document.numero}` }
      });
      await tx.comprobanteComercial.update({ where: { id: document.id }, data: { saldo: next, estado: next.eq(0) ? 'PAGADO_TOTAL' : 'PAGADO_PARCIAL' } });
      const thirdAccount = await requireMapped(tx, tenantId, isSale ? 'CLIENTES' : 'PROVEEDORES');
      const details = isSale
        ? [
            { cuentaId: cash.account.id, debito: amount, credito: 0, concepto: receipt.numero },
            { cuentaId: thirdAccount.id, terceroId: document.terceroId, debito: 0, credito: amount, concepto: receipt.numero }
          ]
        : [
            { cuentaId: thirdAccount.id, terceroId: document.terceroId, debito: amount, credito: 0, concepto: receipt.numero },
            { cuentaId: cash.account.id, debito: 0, credito: amount, concepto: receipt.numero }
          ];
      const journal = await accountingService.createJournalInTx(tx, { tenantId, userId, comprobanteId: receipt.id, sourceId: `PAYMULT-${receipt.id}`, fecha: receipt.fecha, concepto: `${receiptType} ${receipt.numero}`, referencia: receipt.numero, detalles });
      const payment = await tx.pago.create({
        data: { tenantId, documentoId: document.id, carteraId: cartera.id, comprobanteTesoreriaId: receipt.id, cajaBancoId: cash.cash.id, userId, sourceId: `MULT-${receipt.id}`, metodoPago: input.metodoPago, monto: amount, referencia: input.referencia || null }
      });
      results.push({ documentoId: document.id, numero: document.numero, monto: amount, saldoNuevo: next, pagoId: payment.id, comprobante: receipt.numero, asiento: journal.numeroComprobante });
    }
    return { terceroId: expectedThird, tipo: input.tipo, aplicaciones: results };
  });
}

function agingBucket(item, today) {
  if (!item.fechaVencimiento) return 'CORRIENTE';
  const days = Math.floor((today.getTime() - new Date(item.fechaVencimiento).getTime()) / 86400000);
  if (days <= 0) return 'CORRIENTE';
  if (days <= 30) return '1_30';
  if (days <= 60) return '31_60';
  if (days <= 90) return '61_90';
  return 'MAS_90';
}

async function getCarteraSummary(tenantId, filters = {}) {
  const where = { tenantId, estado: { in: ['PENDIENTE', 'PARCIAL'] } };
  if (filters.tipo) where.tipo = filters.tipo;
  if (filters.terceroId) where.terceroId = filters.terceroId;
  const rows = await prisma.cartera.findMany({
    where,
    include: { tercero: true, comprobante: { select: { id: true, numero: true, tipo: true, fecha: true, estado: true } } },
    orderBy: [{ terceroId: 'asc' }, { fechaVencimiento: 'asc' }]
  });
  const today = new Date();
  const buckets = { CORRIENTE: 0, '1_30': 0, '31_60': 0, '61_90': 0, MAS_90: 0 };
  const byThird = new Map();
  for (const row of rows) {
    const bucket = agingBucket(row, today), balance = Number(row.saldo || 0);
    buckets[bucket] += balance;
    const group = byThird.get(row.terceroId) || { tercero: row.tercero, CXC: 0, CXP: 0, total: 0, documentos: [] };
    group[row.tipo] += balance;
    group.total += balance;
    group.documentos.push({ ...row, antiguedad: bucket });
    byThird.set(row.terceroId, group);
  }
  return { buckets, total: rows.reduce((a, x) => a + Number(x.saldo || 0), 0), terceros: [...byThird.values()] };
}

async function getThirdPartyAccountingDetail(tenantId, terceroId, tipo = 'CXC') {
  await ensureIntegrationDefaults(tenantId);
  const third = await prisma.tercero.findFirst({ where: { id: terceroId, tenantId } });
  if (!third) throw new AppError(404, 'Tercero no encontrado', 'THIRD_PARTY_NOT_FOUND');
  const account = await requireMapped(prisma, tenantId, tipo === 'CXC' ? 'CLIENTES' : 'PROVEEDORES');
  const details = await prisma.detalleAsiento.findMany({
    where: { tenantId, terceroId, cuentaId: account.id, asiento: { estado: { in: ['CONTABILIZADO', 'ANULADO'] } } },
    include: { asiento: { select: { id: true, numeroComprobante: true, referencia: true, fecha: true, concepto: true, estado: true, origen: true } } },
    orderBy: [{ asiento: { fecha: 'asc' } }, { creadoEn: 'asc' }]
  });
  let running = 0;
  const movements = details.map((line) => {
    const delta = account.naturaleza === 'DEBITO' ? Number(line.debito) - Number(line.credito) : Number(line.credito) - Number(line.debito);
    running += delta;
    return { ...line, saldoAcumulado: running };
  });
  return { tercero: third, cuenta: account, saldoAuxiliar: running, movimientos };
}

async function getThirdPartyExtended(tenantId, terceroId) {
  const [third, operation] = await Promise.all([
    prisma.tercero.findFirst({ where: { id: terceroId, tenantId } }),
    getThirdPartyOperation(tenantId, terceroId)
  ]);
  if (!third) throw new AppError(404, 'Tercero no encontrado', 'THIRD_PARTY_NOT_FOUND');
  return { ...third, operacion: operation };
}

async function updateThirdPartyExtended(tenantId, terceroId, input) {
  const data = {};
  for (const key of ['cupoCredito', 'diasPlazo']) if (input[key] !== undefined) data[key] = input[key];
  if (Object.keys(data).length) await prisma.tercero.update({ where: { id: terceroId }, data });
  const operation = await updateThirdPartyOperation(tenantId, terceroId, input.operacion || {});
  if (!operation) throw new AppError(400, 'Configuración operacional del tercero inválida', 'THIRD_PARTY_OPERATION_INVALID');
  return getThirdPartyExtended(tenantId, terceroId);
}

module.exports = {
  ensureIntegrationDefaults,
  requireMapped,
  getParametrization,
  updateParametrization,
  preflightCommercialInput,
  preflightExistingDocument,
  createInventoryAdjustment,
  transferOwnFunds,
  directExpense,
  applyMultiplePayments,
  getCarteraSummary,
  getThirdPartyAccountingDetail,
  getThirdPartyExtended,
  updateThirdPartyExtended
};
