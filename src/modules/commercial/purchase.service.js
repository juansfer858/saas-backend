const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const commercial = require('./commercial.service');
const accountingService = require('../accounting/accounting.service');
const inventoryService = require('../inventory/inventory.service');
const treasuryService = require('../treasury/treasury.service');
const treasuryReversalService = require('../treasury/treasury-reversal.service');

const META_KIND = 'PURCHASE_META_V1';

function packMeta({ referenciaExterna, condicionPagoDias, notas }) {
  return JSON.stringify({
    kind: META_KIND,
    referenciaExterna: String(referenciaExterna || '').trim(),
    condicionPagoDias: Number(condicionPagoDias || 0),
    notas: notas || null
  });
}

function unpackMeta(raw) {
  if (!raw) return { referenciaExterna: '', condicionPagoDias: 0, notas: null };
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.kind === META_KIND) {
      return {
        referenciaExterna: String(parsed.referenciaExterna || ''),
        condicionPagoDias: Number(parsed.condicionPagoDias || 0),
        notas: parsed.notas || null
      };
    }
  } catch {}
  return { referenciaExterna: '', condicionPagoDias: 0, notas: raw };
}

function dueDate(fecha, dias) {
  const d = new Date(fecha);
  d.setUTCDate(d.getUTCDate() + Number(dias || 0));
  return d;
}

function toCommercialLines(detalles) {
  return detalles.map((line) => ({
    productoId: line.productoId,
    cantidad: line.cantidad,
    precioUnitario: line.costoUnitario,
    ivaPct: line.ivaPct,
    descuentoPct: 0,
    impoconsumoPct: 0
  }));
}

function fromStoredLines(detalles) {
  return (detalles || []).map((line) => ({
    productoId: line.productoId,
    cantidad: Number(line.cantidad),
    costoUnitario: Number(line.precioUnitario),
    ivaPct: Number(line.ivaPct)
  }));
}

function viewModel(document) {
  const meta = unpackMeta(document.observaciones);
  const pagos = document.pagosRecibidos || [];
  return {
    ...document,
    referenciaExterna: meta.referenciaExterna,
    condicionPagoDias: meta.condicionPagoDias,
    notasCompra: meta.notas,
    pagosAplicados: pagos.length,
    totalPagado: pagos.reduce((sum, p) => sum + Number(p.monto || 0), 0),
    puedeEditar: document.estado === 'BORRADOR',
    puedeAnular: document.estado === 'EMITIDO' && pagos.length === 0,
    indicadorPago: document.estado === 'PAGADO_TOTAL'
      ? 'PAGADA'
      : document.estado === 'PAGADO_PARCIAL'
        ? 'PARCIAL'
        : null
  };
}

async function getSupplier(tenantId, proveedorId, client = prisma) {
  const supplier = await client.tercero.findFirst({
    where: {
      id: proveedorId,
      tenantId,
      activo: true,
      tipo: { in: ['PROVEEDOR', 'CLIENTE_PROVEEDOR'] }
    }
  });
  if (!supplier) throw new AppError(400, 'Seleccione un proveedor válido', 'PURCHASE_SUPPLIER_REQUIRED');
  return supplier;
}

async function createDraft(tenantId, userId, input) {
  const supplier = await getSupplier(tenantId, input.proveedorId);
  const days = input.condicionPagoDias ?? Number(supplier.diasPlazo || 0);
  const doc = await commercial.createDocument(tenantId, userId, {
    tipo: 'COMPRA',
    estado: 'BORRADOR',
    terceroId: supplier.id,
    formaPago: 'CREDITO',
    fecha: input.fecha,
    fechaVencimiento: dueDate(input.fecha, days),
    observaciones: packMeta({ referenciaExterna: input.referenciaExterna, condicionPagoDias: days, notas: input.notas }),
    detalles: toCommercialLines(input.detalles)
  });
  return viewModel(doc);
}

async function updateDraft(tenantId, userId, id, input) {
  const current = await commercial.getDocument(tenantId, id);
  if (current.tipo !== 'COMPRA') throw new AppError(404, 'Compra no encontrada', 'PURCHASE_NOT_FOUND');
  if (current.estado !== 'BORRADOR') throw new AppError(409, 'Una compra emitida no se puede editar', 'PURCHASE_IMMUTABLE');

  const currentMeta = unpackMeta(current.observaciones);
  const proveedorId = input.proveedorId ?? current.terceroId;
  const supplier = await getSupplier(tenantId, proveedorId);
  const fecha = input.fecha ?? current.fecha;
  const days = input.condicionPagoDias ?? currentMeta.condicionPagoDias ?? Number(supplier.diasPlazo || 0);
  const referenciaExterna = input.referenciaExterna ?? currentMeta.referenciaExterna;
  if (!String(referenciaExterna || '').trim()) {
    throw new AppError(400, 'El número de factura del proveedor es obligatorio', 'PURCHASE_EXTERNAL_REFERENCE_REQUIRED');
  }

  const details = input.detalles ? toCommercialLines(input.detalles) : fromStoredLines(current.detalles).map((line) => ({
    productoId: line.productoId,
    cantidad: line.cantidad,
    precioUnitario: line.costoUnitario,
    ivaPct: line.ivaPct,
    descuentoPct: 0,
    impoconsumoPct: 0
  }));

  const updated = await commercial.updateDraftDocument(tenantId, userId, id, {
    tipo: 'COMPRA',
    terceroId: supplier.id,
    formaPago: 'CREDITO',
    fecha,
    fechaVencimiento: dueDate(fecha, days),
    observaciones: packMeta({ referenciaExterna, condicionPagoDias: days, notas: input.notas ?? currentMeta.notas }),
    detalles: details
  });
  return viewModel(updated);
}

async function emit(tenantId, userId, id) {
  const current = await commercial.getDocument(tenantId, id);
  if (current.tipo !== 'COMPRA') throw new AppError(404, 'Compra no encontrada', 'PURCHASE_NOT_FOUND');
  const meta = unpackMeta(current.observaciones);
  if (!meta.referenciaExterna) throw new AppError(400, 'El número de factura del proveedor es obligatorio', 'PURCHASE_EXTERNAL_REFERENCE_REQUIRED');
  await getSupplier(tenantId, current.terceroId);
  if (!current.detalles?.length || current.detalles.some((line) => !line.productoId || Number(line.cantidad) <= 0 || Number(line.precioUnitario) <= 0)) {
    throw new AppError(400, 'Todas las líneas deben tener producto, cantidad y costo mayores que cero', 'PURCHASE_LINES_INVALID');
  }
  try {
    const emitted = await commercial.emitDocument(tenantId, userId, id);
    return viewModel(emitted);
  } catch (error) {
    if (error?.code === 'ACCOUNTING_PERIOD_CLOSED') {
      throw new AppError(409, 'El periodo contable de esta fecha está cerrado.', 'ACCOUNTING_PERIOD_CLOSED', error.details);
    }
    throw error;
  }
}

async function createCancellationNoteInTx(tx, tenantId, userId, original, motivo) {
  const numero = `ND-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const note = await tx.comprobanteComercial.create({
    data: {
      tenantId,
      tipo: 'NOTA_DEBITO',
      numero,
      estado: 'EMITIDO',
      documentoOrigenId: original.id,
      terceroId: original.terceroId,
      creadoPorId: userId,
      fecha: new Date(),
      emitidoEn: new Date(),
      observaciones: motivo,
      subtotal: original.subtotal,
      descuentoTotal: original.descuentoTotal,
      ivaTotal: original.ivaTotal,
      impoconsumoTotal: original.impoconsumoTotal,
      total: original.total,
      saldo: 0
    }
  });
  if (original.detalles.length) {
    await tx.detalleComprobante.createMany({
      data: original.detalles.map((line) => ({
        tenantId,
        comprobanteId: note.id,
        productoId: line.productoId,
        descripcion: `Reverso: ${line.descripcion}`,
        cantidad: line.cantidad,
        precioUnitario: line.precioUnitario,
        descuentoPct: line.descuentoPct,
        ivaPct: line.ivaPct,
        impoconsumoPct: line.impoconsumoPct,
        subtotalLinea: line.subtotalLinea,
        ivaValor: line.ivaValor,
        impoconsumoValor: line.impoconsumoValor,
        totalLinea: line.totalLinea,
        costoUnitario: line.costoUnitario
      }))
    });
  }
  return note;
}

async function cancel(tenantId, userId, id, motivo) {
  return prisma.$transaction(async (tx) => {
    const original = await tx.comprobanteComercial.findFirst({
      where: { id, tenantId, tipo: 'COMPRA' },
      include: {
        detalles: true,
        asiento: { include: { detalles: true } },
        pagosRecibidos: true,
        cartera: true
      }
    });
    if (!original) throw new AppError(404, 'Compra no encontrada', 'PURCHASE_NOT_FOUND');
    if (original.estado === 'ANULADO') return { documento: viewModel(original), yaAnulada: true };
    if (original.estado === 'BORRADOR') {
      const cancelled = await tx.comprobanteComercial.update({ where: { id }, data: { estado: 'ANULADO', anuladoEn: new Date(), motivoAnulacion: motivo } });
      return { documento: viewModel(cancelled), ajuste: null };
    }
    if (original.estado !== 'EMITIDO') {
      throw new AppError(409, 'Solo una compra emitida y sin pagos puede anularse', 'PURCHASE_CANCEL_STATE_INVALID');
    }
    if (original.pagosRecibidos.length > 0) {
      throw new AppError(409, 'No se puede anular una compra con pagos aplicados. Reverse los pagos desde Tesorería primero.', 'PURCHASE_HAS_PAYMENTS');
    }

    const note = await createCancellationNoteInTx(tx, tenantId, userId, original, motivo);
    await treasuryReversalService.reverseDirectDocumentSettlementInTx(tx, {
      tenantId,
      userId,
      documentoId: original.id,
      reversalDocumentId: note.id,
      referencia: note.numero,
      motivo
    });
    await treasuryService.cancelCarteraForDocumentInTx(tx, {
      tenantId,
      documentoId: original.id,
      reversalDocumentId: note.id,
      referencia: note.numero,
      motivo
    });
    await inventoryService.reverseDocumentMovementsInTx(tx, {
      tenantId,
      comprobanteId: original.id,
      reversalDocumentId: note.id,
      referencia: note.numero
    });
    if (original.asiento) {
      await accountingService.reverseJournalInTx(tx, {
        tenantId,
        userId,
        asiento: original.asiento,
        comprobanteId: note.id,
        sourceId: `REV-PUR-${original.id}`,
        referencia: note.numero,
        concepto: `Anulación compra ${original.numero}`,
        motivo
      });
    }
    await tx.comprobanteComercial.update({
      where: { id: original.id },
      data: { estado: 'ANULADO', saldo: 0, anuladoEn: new Date(), motivoAnulacion: motivo }
    });
    return {
      documento: viewModel(await commercial.getDocument(tenantId, original.id)),
      ajuste: await commercial.getDocument(tenantId, note.id)
    };
  });
}

async function get(tenantId, id) {
  const doc = await commercial.getDocument(tenantId, id);
  if (doc.tipo !== 'COMPRA') throw new AppError(404, 'Compra no encontrada', 'PURCHASE_NOT_FOUND');
  return viewModel(doc);
}

async function list(tenantId, filters = {}) {
  const where = { tenantId, tipo: 'COMPRA' };
  if (filters.proveedorId) where.terceroId = filters.proveedorId;
  if (filters.estado) {
    if (filters.estado === 'EMITIDA') where.estado = { in: ['EMITIDO', 'PAGADO_PARCIAL'] };
    else if (filters.estado === 'PAGADA') where.estado = 'PAGADO_TOTAL';
    else if (filters.estado === 'ANULADA') where.estado = 'ANULADO';
    else if (filters.estado === 'BORRADOR') where.estado = 'BORRADOR';
    else where.estado = filters.estado;
  }
  if (filters.desde || filters.hasta) {
    where.fecha = {};
    if (filters.desde) where.fecha.gte = new Date(`${filters.desde}T00:00:00.000Z`);
    if (filters.hasta) where.fecha.lte = new Date(`${filters.hasta}T23:59:59.999Z`);
  }
  const page = Math.max(Number(filters.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(filters.pageSize) || 50, 1), 200);
  const [items, total] = await Promise.all([
    prisma.comprobanteComercial.findMany({
      where,
      include: {
        tercero: true,
        asiento: { select: { id: true, numeroComprobante: true, estado: true } },
        pagosRecibidos: { select: { id: true, monto: true } }
      },
      orderBy: [{ fecha: 'desc' }, { creadoEn: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.comprobanteComercial.count({ where })
  ]);
  return { items: items.map(viewModel), meta: { page, pageSize, total, pages: Math.max(Math.ceil(total / pageSize), 1) } };
}

module.exports = {
  META_KIND,
  packMeta,
  unpackMeta,
  viewModel,
  createDraft,
  updateDraft,
  emit,
  cancel,
  get,
  list
};
