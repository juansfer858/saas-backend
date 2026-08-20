const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { decimal, money } = require('../../utils/decimal');
const commercial = require('./commercial.service');
const inventory = require('../inventory/inventory.service');
const treasury = require('../treasury/treasury.service');
const accounting = require('../accounting/accounting.service');
const tax = require('../accounting/accounting-tax.service');
const consumption = require('../consumption/consumption.service');
const dian = require('../platform/dian/dian.service');

const META_KIND = 'SALE_META_V1';

function packMeta({ documentType, notes }) {
  return JSON.stringify({
    kind: META_KIND,
    documentType: documentType || 'DOCUMENTO_EQUIVALENTE_POS',
    notes: notes || null
  });
}

function unpackMeta(raw) {
  if (!raw) return { documentType: 'DOCUMENTO_EQUIVALENTE_POS', notes: null };
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.kind === META_KIND) return { documentType: parsed.documentType || 'DOCUMENTO_EQUIVALENTE_POS', notes: parsed.notes || null };
  } catch {}
  return { documentType: 'DOCUMENTO_EQUIVALENTE_POS', notes: raw };
}

function lineInput(detail) {
  return {
    productoId: detail.productoId,
    descripcion: detail.descripcion,
    cantidad: Number(detail.cantidad),
    precioUnitario: Number(detail.precioUnitario),
    descuentoPct: Number(detail.descuentoPct || 0),
    ivaPct: Number(detail.ivaPct || 0),
    impoconsumoPct: Number(detail.impoconsumoPct || 0)
  };
}

async function settlementAccount(tx, tenantId, formaPago, cajaBancoId) {
  if (formaPago === 'CREDITO') return accounting.getMappedAccount(tx, tenantId, 'CLIENTES');
  if (!cajaBancoId) throw new AppError(400, 'Venta de contado requiere Caja/Banco', 'PAYMENT_ACCOUNT_REQUIRED');
  const caja = await treasury.getCajaBanco(tenantId, cajaBancoId, tx);
  if (caja.cuentaContableId) {
    const account = await tx.cuentaPUC.findFirst({ where: { id: caja.cuentaContableId, tenantId, activa: true, permiteMovimiento: true } });
    if (account) return account;
  }
  return accounting.getMappedAccount(tx, tenantId, caja.tipo === 'BANCO' ? 'BANCO_GENERAL' : 'CAJA_GENERAL');
}

function addLine(lines, cuentaId, debito, credito, terceroId, concepto, extra = {}) {
  const d = money(debito || 0);
  const c = money(credito || 0);
  if (d.eq(0) && c.eq(0)) return;
  lines.push({ cuentaId, terceroId: terceroId || null, concepto, debito: d, credito: c, ...extra });
}

async function loadSale(tx, tenantId, id) {
  const sale = await tx.comprobanteComercial.findFirst({
    where: { id, tenantId, tipo: 'FACTURA_VENTA' },
    include: {
      tercero: true,
      cajaBanco: true,
      detalles: { include: { producto: true } },
      movimientosInventario: true,
      cartera: true,
      pagosRecibidos: true,
      asiento: { include: { tipoComprobante: true, detalles: { include: { cuenta: true } } } }
    }
  });
  if (!sale) throw new AppError(404, 'Venta no encontrada', 'SALE_NOT_FOUND');
  return sale;
}

async function hydrateSale(tx, tenantId, id) {
  const sale = await loadSale(tx, tenantId, id);
  const [dianDocument, consumptionRun] = await Promise.all([
    tx.dianDocument.findFirst({ where: { tenantId, originType: 'COMPROBANTE_COMERCIAL', originId: id }, include: { attempts: { orderBy: { attempt: 'desc' }, take: 3 } } }),
    tx.consumptionRun.findFirst({ where: { tenantId, sourceType: 'SALE', sourceId: id }, include: { items: true } })
  ]);
  const meta = unpackMeta(sale.observaciones);
  return { ...sale, documentType: meta.documentType, notesSale: meta.notes, dianDocument, consumptionRun };
}

async function emitSaleInTx(tx, tenantId, userId, id, explicitDocumentType = null) {
  const sale = await loadSale(tx, tenantId, id);
  if (sale.estado !== 'BORRADOR') throw new AppError(409, 'Solo una venta en borrador puede emitirse', 'SALE_NOT_DRAFT');
  if (!sale.formaPago) throw new AppError(400, 'Seleccione forma de pago', 'SALE_PAYMENT_METHOD_REQUIRED');
  if (!sale.detalles.length || sale.detalles.some((line) => !line.productoId || Number(line.cantidad) <= 0 || Number(line.precioUnitario) < 0)) {
    throw new AppError(400, 'Todas las líneas requieren producto, cantidad mayor que cero y precio válido', 'SALE_LINES_INVALID');
  }

  const meta = unpackMeta(sale.observaciones);
  const documentType = explicitDocumentType || meta.documentType || 'DOCUMENTO_EQUIVALENTE_POS';

  const recipeConsumption = await consumption.consumeForSaleInTx(tx, {
    tenantId,
    userId,
    comprobante: sale,
    saleDetails: sale.detalles
  });

  let directCost = money(0);
  for (const line of sale.detalles) {
    const product = line.producto;
    if (!product || product.tipo !== 'PRODUCTO' || !product.controlaInventario) continue;
    if (recipeConsumption.recipeOutputProductIds.has(product.id)) continue;
    const result = await inventory.applyMovement(tx, {
      tenantId,
      productoId: product.id,
      comprobanteId: sale.id,
      tipo: 'VENTA',
      cantidad: line.cantidad,
      referencia: sale.numero
    });
    directCost = money(directCost.plus(result.costOfMovement));
  }
  const totalCost = money(directCost.plus(recipeConsumption.totalCost || 0));

  const subtotal = money(sale.subtotal);
  const ivaTotal = money(sale.ivaTotal);
  const impoconsumoTotal = money(sale.impoconsumoTotal);
  const total = money(sale.total);
  const fiscal = await tax.calculateCommercialRetentionsInTx(tx, tenantId, {
    tercero: sale.tercero,
    tipoOperacion: 'VENTA',
    subtotal,
    ivaTotal,
    total
  });

  await treasury.applyCommercialSettlement(tx, {
    tenantId,
    userId,
    comprobante: { ...sale, total: fiscal.neto },
    terceroId: sale.terceroId,
    formaPago: sale.formaPago,
    cajaBancoId: sale.cajaBancoId
  });

  const lines = [];
  const settlement = await settlementAccount(tx, tenantId, sale.formaPago, sale.cajaBancoId);
  const sales = await accounting.getMappedAccount(tx, tenantId, 'VENTAS');
  addLine(lines, settlement.id, fiscal.neto, 0, sale.terceroId, `Cobro/cliente neto ${sale.numero}`);
  for (const retention of fiscal.retenciones || []) {
    addLine(lines, retention.cuentaId, retention.debito, retention.credito, sale.terceroId, `${retention.codigo} ${retention.porcentaje}% ${sale.numero}`, { conceptoRetencionId: retention.conceptoId });
  }
  addLine(lines, sales.id, 0, subtotal, sale.terceroId, `Venta ${sale.numero}`);
  if (ivaTotal.gt(0)) {
    const vat = await accounting.getMappedAccount(tx, tenantId, 'IMPUESTO_VENTA');
    addLine(lines, vat.id, 0, ivaTotal, sale.terceroId, `IVA ${sale.numero}`);
  }
  if (impoconsumoTotal.gt(0)) {
    const consumptionTax = await accounting.getMappedAccount(tx, tenantId, 'IMPOCONSUMO_VENTA');
    addLine(lines, consumptionTax.id, 0, impoconsumoTotal, sale.terceroId, `Impoconsumo ${sale.numero}`);
  }
  if (totalCost.gt(0)) {
    const cogs = await accounting.getMappedAccount(tx, tenantId, 'COSTO_VENTAS');
    const inventoryAccount = await accounting.getMappedAccount(tx, tenantId, 'INVENTARIO');
    addLine(lines, cogs.id, totalCost, 0, sale.terceroId, `Costo de venta ${sale.numero}`);
    addLine(lines, inventoryAccount.id, 0, totalCost, sale.terceroId, `Salida inventario/recetas ${sale.numero}`);
  }

  await accounting.createJournalInTx(tx, {
    tenantId,
    userId,
    comprobanteId: sale.id,
    sourceId: sale.sourceId ? `ACC-${sale.sourceId}` : `ACC-SALE-${sale.id}`,
    fecha: sale.fecha,
    concepto: `FACTURA_VENTA ${sale.numero}`,
    referencia: sale.numero,
    detalles: lines
  });

  await tx.comprobanteComercial.update({
    where: { id: sale.id },
    data: { estado: 'EMITIDO', emitidoEn: new Date(), saldo: sale.formaPago === 'CREDITO' ? fiscal.neto : 0 }
  });

  const updatedSale = await tx.comprobanteComercial.findUnique({ where: { id: sale.id } });
  await dian.enqueueCommercialInTx(tx, {
    tenantId,
    comprobante: updatedSale,
    subtotal,
    ivaTotal,
    total,
    documentType
  });

  return hydrateSale(tx, tenantId, sale.id);
}

async function create(tenantId, userId, input) {
  return prisma.$transaction(async (tx) => {
    const created = await commercial.createDocumentInTx(tx, tenantId, userId, {
      tipo: 'FACTURA_VENTA',
      estado: 'BORRADOR',
      sourceId: input.sourceId || null,
      terceroId: input.terceroId || null,
      cajaBancoId: input.cajaBancoId || null,
      formaPago: input.formaPago || null,
      fecha: input.fecha || new Date(),
      fechaVencimiento: input.fechaVencimiento || null,
      observaciones: packMeta({ documentType: input.documentType, notes: input.notas }),
      detalles: input.detalles
    });
    if (input.estado === 'EMITIDO') return emitSaleInTx(tx, tenantId, userId, created.id, input.documentType);
    return hydrateSale(tx, tenantId, created.id);
  });
}

async function updateDraft(tenantId, userId, id, input) {
  const current = await commercial.getDocument(tenantId, id);
  if (current.tipo !== 'FACTURA_VENTA') throw new AppError(404, 'Venta no encontrada', 'SALE_NOT_FOUND');
  if (current.estado !== 'BORRADOR') throw new AppError(409, 'Una venta emitida no puede editarse', 'SALE_IMMUTABLE');
  if (!input || Object.keys(input).length === 0) throw new AppError(400, 'Debe enviar al menos un cambio', 'VALIDATION_ERROR');
  const meta = unpackMeta(current.observaciones);
  const updated = await commercial.updateDraftDocument(tenantId, userId, id, {
    tipo: 'FACTURA_VENTA',
    terceroId: Object.prototype.hasOwnProperty.call(input, 'terceroId') ? input.terceroId : current.terceroId,
    cajaBancoId: Object.prototype.hasOwnProperty.call(input, 'cajaBancoId') ? input.cajaBancoId : current.cajaBancoId,
    formaPago: Object.prototype.hasOwnProperty.call(input, 'formaPago') ? input.formaPago : current.formaPago,
    fecha: input.fecha || current.fecha,
    fechaVencimiento: Object.prototype.hasOwnProperty.call(input, 'fechaVencimiento') ? input.fechaVencimiento : current.fechaVencimiento,
    observaciones: packMeta({ documentType: input.documentType || meta.documentType, notes: Object.prototype.hasOwnProperty.call(input, 'notas') ? input.notas : meta.notes }),
    detalles: input.detalles || current.detalles.map(lineInput)
  });
  return prisma.$transaction((tx) => hydrateSale(tx, tenantId, updated.id));
}

async function emit(tenantId, userId, id) {
  try {
    return await prisma.$transaction((tx) => emitSaleInTx(tx, tenantId, userId, id));
  } catch (error) {
    if (error?.code === 'ACCOUNTING_PERIOD_CLOSED') throw new AppError(409, 'El periodo contable de esta fecha está cerrado.', 'ACCOUNTING_PERIOD_CLOSED', error.details);
    throw error;
  }
}

async function cancel(tenantId, userId, id, motivo) {
  const acceptedFiscal = await prisma.dianDocument.findFirst({ where: { tenantId, originType: 'COMPROBANTE_COMERCIAL', originId: id, state: 'ACEPTADO' } });
  if (acceptedFiscal) {
    throw new AppError(409, 'La venta ya fue aceptada fiscalmente. Debe generarse el documento electrónico de ajuste correspondiente antes de anularla.', 'SALE_DIAN_ADJUSTMENT_REQUIRED');
  }
  const result = await commercial.cancelDocument(tenantId, userId, id, motivo);
  await prisma.$transaction(async (tx) => {
    await tx.consumptionRun.updateMany({
      where: { tenantId, sourceType: 'SALE', sourceId: id, state: 'COMPLETED' },
      data: { state: 'REVERSED', reversedAt: new Date() }
    });
    await tx.dianDocument.updateMany({
      where: {
        tenantId,
        originType: 'COMPROBANTE_COMERCIAL',
        originId: id,
        state: { in: ['GENERADO', 'PENDIENTE_ENVIO', 'CONTINGENCIA', 'RECHAZADO'] }
      },
      data: {
        state: 'CANCELADO',
        nextRetryAt: null,
        lastError: 'Documento comercial anulado antes de transmisión fiscal',
        contingencyReason: null
      }
    });
  });
  return result;
}

async function get(tenantId, id) {
  return prisma.$transaction((tx) => hydrateSale(tx, tenantId, id));
}

async function list(tenantId, filters = {}) {
  const where = { tenantId, tipo: 'FACTURA_VENTA' };
  if (filters.terceroId) where.terceroId = filters.terceroId;
  if (filters.estado) where.estado = filters.estado;
  if (filters.desde || filters.hasta) {
    where.fecha = {};
    if (filters.desde) where.fecha.gte = new Date(`${filters.desde}T00:00:00.000Z`);
    if (filters.hasta) where.fecha.lte = new Date(`${filters.hasta}T23:59:59.999Z`);
  }
  const docs = await prisma.comprobanteComercial.findMany({
    where,
    include: { tercero: true, asiento: { select: { id: true, numeroComprobante: true, estado: true } }, pagosRecibidos: { select: { id: true, monto: true } } },
    orderBy: [{ fecha: 'desc' }, { creadoEn: 'desc' }],
    take: Math.min(Number(filters.limit) || 200, 500)
  });
  const ids = docs.map((d) => d.id);
  const dianDocs = ids.length ? await prisma.dianDocument.findMany({ where: { tenantId, originType: 'COMPROBANTE_COMERCIAL', originId: { in: ids } } }) : [];
  const fiscalByOrigin = new Map(dianDocs.map((d) => [d.originId, d]));
  return docs.map((doc) => ({ ...doc, ...unpackMeta(doc.observaciones), dianDocument: fiscalByOrigin.get(doc.id) || null }));
}

module.exports = { META_KIND, packMeta, unpackMeta, create, updateDraft, emit, cancel, get, list, emitSaleInTx };
