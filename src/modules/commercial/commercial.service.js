const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { decimal, money, qty, pct } = require('../../utils/decimal');
const inventoryService = require('../inventory/inventory.service');
const treasuryService = require('../treasury/treasury.service');
const treasuryReversalService = require('../treasury/treasury-reversal.service');
const accountingService = require('../accounting/accounting.service');
const accountingTaxService = require('../accounting/accounting-tax.service');

const PREFIX = {
  COTIZACION: 'COT',
  FACTURA_VENTA: 'FV',
  COMPRA: 'CP',
  RECIBO_CAJA: 'RC',
  COMPROBANTE_EGRESO: 'CE',
  NOTA_CREDITO: 'NC',
  NOTA_DEBITO: 'ND'
};

const TRANSACTIONAL_TYPES = new Set(['FACTURA_VENTA', 'COMPRA']);
const ISSUED_STATES = new Set(['EMITIDO', 'PAGADO_PARCIAL', 'PAGADO_TOTAL', 'CONFIRMADO']);

function generateNumber(type) {
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${PREFIX[type] || 'DOC'}-${Date.now()}-${suffix}`;
}

function requestedState(input) {
  if (input.estado) return input.estado;
  return input.tipo === 'COTIZACION' ? 'BORRADOR' : 'EMITIDO';
}

async function resolveThirdParty(tx, tenantId, type, terceroId) {
  if (terceroId) {
    const tercero = await tx.tercero.findFirst({ where: { id: terceroId, tenantId, activo: true } });
    if (!tercero) throw new AppError(400, 'Tercero inválido para esta empresa', 'COMMERCIAL_THIRD_PARTY_INVALID');

    if (type === 'COMPRA' && !['PROVEEDOR', 'CLIENTE_PROVEEDOR'].includes(tercero.tipo)) {
      throw new AppError(400, 'La compra requiere un tercero proveedor', 'PURCHASE_SUPPLIER_INVALID');
    }
    return tercero;
  }

  if (type === 'FACTURA_VENTA') {
    const generic = await tx.tercero.findFirst({
      where: { tenantId, identificacion: '222222222222', activo: true }
    });
    if (!generic) throw new AppError(500, 'Cliente genérico no configurado', 'GENERIC_CUSTOMER_MISSING');
    return generic;
  }

  if (type === 'COMPRA') {
    throw new AppError(400, 'Una compra requiere proveedor', 'PURCHASE_SUPPLIER_REQUIRED');
  }

  return null;
}

async function buildLines(tx, tenantId, type, inputDetails) {
  const productIds = [...new Set(inputDetails.map((line) => line.productoId).filter(Boolean))];
  const products = productIds.length
    ? await tx.producto.findMany({ where: { tenantId, id: { in: productIds }, activo: true } })
    : [];
  const byId = new Map(products.map((product) => [product.id, product]));

  if (products.length !== productIds.length) {
    throw new AppError(400, 'Uno o más productos no pertenecen al tenant', 'COMMERCIAL_PRODUCT_INVALID');
  }

  return inputDetails.map((input) => {
    const product = input.productoId ? byId.get(input.productoId) : null;
    const quantity = qty(input.cantidad);
    const price = money(input.precioUnitario);
    const discountPct = pct(input.descuentoPct || 0);
    const ivaPct = pct(input.ivaPct ?? product?.ivaPct ?? 0);
    const impoconsumoPct = pct(input.impoconsumoPct ?? product?.impoconsumoPct ?? 0);

    const gross = money(quantity.mul(price));
    const discount = money(gross.mul(discountPct).div(100));
    const subtotal = money(gross.minus(discount));
    const iva = money(subtotal.mul(ivaPct).div(100));
    const impoconsumo = money(subtotal.mul(impoconsumoPct).div(100));
    const total = money(subtotal.plus(iva).plus(impoconsumo));
    const purchaseNetUnit = quantity.gt(0) ? decimal(subtotal).div(quantity).toDecimalPlaces(4) : decimal(0);
    const snapshotCost = product
      ? (type === 'COMPRA' ? purchaseNetUnit : decimal(product.costoPromedio).toDecimalPlaces(4))
      : decimal(0);

    return {
      product,
      productoId: product?.id || null,
      descripcion: input.descripcion || product?.nombre || 'Concepto comercial',
      cantidad: quantity,
      precioUnitario: price,
      descuentoPct: discountPct,
      ivaPct,
      impoconsumoPct,
      descuento: discount,
      subtotal,
      iva,
      impoconsumo,
      total,
      costoUnitario: snapshotCost,
      purchaseNetUnit
    };
  });
}

function sumLines(lines, field) {
  return money(lines.reduce((acc, line) => acc.plus(line[field]), decimal(0)));
}

async function settlementAccount(tx, tenantId, type, formaPago, cajaBancoId) {
  if (formaPago === 'CREDITO') {
    return accountingService.getMappedAccount(tx, tenantId, type === 'FACTURA_VENTA' ? 'CLIENTES' : 'PROVEEDORES');
  }

  if (!cajaBancoId) throw new AppError(400, 'Pago contado requiere Caja/Banco', 'PAYMENT_ACCOUNT_REQUIRED');
  const caja = await treasuryService.getCajaBanco(tenantId, cajaBancoId, tx);

  if (caja.cuentaContableId) {
    const account = await tx.cuentaPUC.findFirst({
      where: { id: caja.cuentaContableId, tenantId, activa: true, permiteMovimiento: true }
    });
    if (account) return account;
  }

  return accountingService.getMappedAccount(tx, tenantId, caja.tipo === 'BANCO' ? 'BANCO_GENERAL' : 'CAJA_GENERAL');
}

function addLine(lines, cuentaId, debito, credito, terceroId, concepto, extra = {}) {
  const d = money(debito || 0);
  const c = money(credito || 0);
  if (d.eq(0) && c.eq(0)) return;
  lines.push({ cuentaId, terceroId: terceroId || null, concepto, debito: d, credito: c, ...extra });
}

async function createAccountingForDocument(tx, params) {
  const {
    tenantId,
    userId,
    comprobante,
    tercero,
    formaPago,
    cajaBancoId,
    subtotal,
    ivaTotal,
    impoconsumoTotal,
    inventoryBase,
    expenseBase,
    costOfSales,
    fiscal
  } = params;

  const lines = [];
  const settlement = await settlementAccount(tx, tenantId, comprobante.tipo, formaPago, cajaBancoId);
  const netSettlement = money(fiscal?.neto ?? comprobante.total);

  if (comprobante.tipo === 'FACTURA_VENTA') {
    const sales = await accountingService.getMappedAccount(tx, tenantId, 'VENTAS');
    const vat = ivaTotal.gt(0) ? await accountingService.getMappedAccount(tx, tenantId, 'IMPUESTO_VENTA') : null;
    const consumption = impoconsumoTotal.gt(0)
      ? await accountingService.getMappedAccount(tx, tenantId, 'IMPOCONSUMO_VENTA')
      : null;

    addLine(lines, settlement.id, netSettlement, 0, tercero?.id, `Cobro/cliente neto ${comprobante.numero}`);
    for (const retention of fiscal?.retenciones || []) {
      addLine(lines, retention.cuentaId, retention.debito, retention.credito, tercero?.id, `${retention.codigo} ${retention.porcentaje}% ${comprobante.numero}`, { conceptoRetencionId: retention.conceptoId });
    }
    addLine(lines, sales.id, 0, subtotal, tercero?.id, `Venta ${comprobante.numero}`);
    if (vat) addLine(lines, vat.id, 0, ivaTotal, tercero?.id, `IVA ${comprobante.numero}`);
    if (consumption) addLine(lines, consumption.id, 0, impoconsumoTotal, tercero?.id, `Impoconsumo ${comprobante.numero}`);

    if (costOfSales.gt(0)) {
      const cogs = await accountingService.getMappedAccount(tx, tenantId, 'COSTO_VENTAS');
      const inventory = await accountingService.getMappedAccount(tx, tenantId, 'INVENTARIO');
      addLine(lines, cogs.id, costOfSales, 0, tercero?.id, `Costo venta ${comprobante.numero}`);
      addLine(lines, inventory.id, 0, costOfSales, tercero?.id, `Salida inventario ${comprobante.numero}`);
    }
  } else if (comprobante.tipo === 'COMPRA') {
    if (inventoryBase.gt(0)) {
      const inventory = await accountingService.getMappedAccount(tx, tenantId, 'INVENTARIO');
      addLine(lines, inventory.id, inventoryBase, 0, tercero?.id, `Compra inventario ${comprobante.numero}`);
    }

    if (expenseBase.gt(0)) {
      const expense = await accountingService.getMappedAccount(tx, tenantId, 'GASTO_COMPRA');
      addLine(lines, expense.id, expenseBase, 0, tercero?.id, `Compra/gasto ${comprobante.numero}`);
    }

    if (ivaTotal.gt(0)) {
      const vat = await accountingService.getMappedAccount(tx, tenantId, 'IMPUESTO_COMPRA');
      addLine(lines, vat.id, ivaTotal, 0, tercero?.id, `IVA compra ${comprobante.numero}`);
    }

    if (impoconsumoTotal.gt(0)) {
      const consumption = await accountingService.getMappedAccount(tx, tenantId, 'IMPOCONSUMO_COMPRA');
      addLine(lines, consumption.id, impoconsumoTotal, 0, tercero?.id, `Impoconsumo compra ${comprobante.numero}`);
    }

    for (const retention of fiscal?.retenciones || []) {
      addLine(lines, retention.cuentaId, retention.debito, retention.credito, tercero?.id, `${retention.codigo} ${retention.porcentaje}% ${comprobante.numero}`, { conceptoRetencionId: retention.conceptoId });
    }
    addLine(lines, settlement.id, 0, netSettlement, tercero?.id, `Pago/proveedor neto ${comprobante.numero}`);
  }

  return accountingService.createJournalInTx(tx, {
    tenantId,
    userId,
    comprobanteId: comprobante.id,
    sourceId: comprobante.sourceId ? `ACC-${comprobante.sourceId}` : null,
    fecha: comprobante.fecha,
    concepto: `${comprobante.tipo} ${comprobante.numero}`,
    referencia: comprobante.numero,
    detalles: lines
  });
}

function lineInputFromStored(detail) {
  return {
    productoId: detail.productoId,
    descripcion: detail.descripcion,
    cantidad: detail.cantidad,
    precioUnitario: detail.precioUnitario,
    descuentoPct: detail.descuentoPct,
    ivaPct: detail.ivaPct,
    impoconsumoPct: detail.impoconsumoPct
  };
}

function enrichDocumentFiscal(document) {
  if (!document) return document;
  const retentionLines = (document.asiento?.detalles || []).filter((line) => line.conceptoRetencionId && line.conceptoRetencion);
  const retenciones = retentionLines.map((line) => ({
    detalleAsientoId: line.id,
    conceptoId: line.conceptoRetencionId,
    codigo: line.conceptoRetencion.codigo,
    nombre: line.conceptoRetencion.nombre,
    tipo: line.conceptoRetencion.tipo,
    porcentajeConfiguradoActual: line.conceptoRetencion.porcentaje,
    valor: money(decimal(line.debito).plus(line.credito)),
    debito: line.debito,
    credito: line.credito
  }));
  const retencionTotal = money(retenciones.reduce((acc, x) => acc.plus(x.valor), decimal(0)));
  return { ...document, retenciones, retencionTotal, netoPagar: money(decimal(document.total || 0).minus(retencionTotal)) };
}

async function getDocumentInTx(tx, tenantId, id) {
  const document = await tx.comprobanteComercial.findFirst({
    where: { id, tenantId },
    include: {
      tercero: true,
      cajaBanco: true,
      detalles: { include: { producto: true } },
      movimientosInventario: true,
      movimientosTesoreria: true,
      cartera: { include: { movimientos: true } },
      pagosRecibidos: { include: { comprobanteTesoreria: true, cajaBanco: true } },
      asiento: { include: { detalles: { include: { cuenta: true, tercero: true, conceptoRetencion: { select: { id: true, codigo: true, nombre: true, tipo: true, porcentaje: true, naturaleza: true } } } } } },
      ajustes: true,
      documentoOrigen: true
    }
  });

  if (!document) throw new AppError(404, 'Comprobante no encontrado', 'COMMERCIAL_DOCUMENT_NOT_FOUND');
  return enrichDocumentFiscal(document);
}

async function createDocumentRecordInTx(tx, tenantId, userId, input) {
  const tercero = await resolveThirdParty(tx, tenantId, input.tipo, input.terceroId);
  const lines = await buildLines(tx, tenantId, input.tipo, input.detalles);

  const subtotal = sumLines(lines, 'subtotal');
  const descuentoTotal = sumLines(lines, 'descuento');
  const ivaTotal = sumLines(lines, 'iva');
  const impoconsumoTotal = sumLines(lines, 'impoconsumo');
  const total = sumLines(lines, 'total');
  const numero = input.numero || generateNumber(input.tipo);

  const comprobante = await tx.comprobanteComercial.create({
    data: {
      tenantId,
      tipo: input.tipo,
      numero,
      sourceId: input.sourceId || null,
      estado: 'BORRADOR',
      documentoOrigenId: input.documentoOrigenId || null,
      terceroId: tercero?.id || null,
      cajaBancoId: input.cajaBancoId || null,
      creadoPorId: userId,
      formaPago: input.formaPago || null,
      fecha: input.fecha || new Date(),
      fechaVencimiento: input.fechaVencimiento || null,
      observaciones: input.observaciones || null,
      subtotal,
      descuentoTotal,
      ivaTotal,
      impoconsumoTotal,
      total,
      saldo: 0
    }
  });

  await tx.detalleComprobante.createMany({
    data: lines.map((line) => ({
      tenantId,
      comprobanteId: comprobante.id,
      productoId: line.productoId,
      descripcion: line.descripcion,
      cantidad: line.cantidad,
      precioUnitario: line.precioUnitario,
      descuentoPct: line.descuentoPct,
      ivaPct: line.ivaPct,
      impoconsumoPct: line.impoconsumoPct,
      subtotalLinea: line.subtotal,
      ivaValor: line.iva,
      impoconsumoValor: line.impoconsumo,
      totalLinea: line.total,
      costoUnitario: line.costoUnitario
    }))
  });

  return { comprobante, tercero, lines, subtotal, descuentoTotal, ivaTotal, impoconsumoTotal, total };
}

async function emitDocumentEffectsInTx(tx, tenantId, userId, documentData) {
  const { comprobante, tercero, lines, subtotal, ivaTotal, impoconsumoTotal, total } = documentData;

  if (!TRANSACTIONAL_TYPES.has(comprobante.tipo)) {
    const updated = await tx.comprobanteComercial.update({ where: { id: comprobante.id }, data: { estado: 'EMITIDO', emitidoEn: new Date() } });
    return getDocumentInTx(tx, tenantId, updated.id);
  }

  if (!comprobante.formaPago) throw new AppError(400, 'Factura/Compra requiere forma de pago', 'PAYMENT_METHOD_REQUIRED');

  let costOfSales = money(0);
  let inventoryBase = money(0);
  let expenseBase = money(0);

  for (const line of lines) {
    if (line.product && line.product.tipo === 'PRODUCTO' && line.product.controlaInventario) {
      const movementResult = await inventoryService.applyMovement(tx, {
        tenantId,
        productoId: line.product.id,
        comprobanteId: comprobante.id,
        tipo: comprobante.tipo === 'FACTURA_VENTA' ? 'VENTA' : 'COMPRA',
        cantidad: line.cantidad,
        costoUnitario: comprobante.tipo === 'COMPRA' ? line.purchaseNetUnit : undefined,
        referencia: comprobante.numero
      });
      if (comprobante.tipo === 'FACTURA_VENTA') costOfSales = money(costOfSales.plus(movementResult.costOfMovement));
      else inventoryBase = money(inventoryBase.plus(line.subtotal));
    } else if (comprobante.tipo === 'COMPRA') {
      expenseBase = money(expenseBase.plus(line.subtotal));
    }
  }

  const fiscal = await accountingTaxService.calculateCommercialRetentionsInTx(tx, tenantId, {
    tercero,
    tipoOperacion: comprobante.tipo === 'COMPRA' ? 'COMPRA' : 'VENTA',
    subtotal,
    ivaTotal,
    total
  });

  await treasuryService.applyCommercialSettlement(tx, {
    tenantId,
    userId,
    comprobante: { ...comprobante, total: fiscal.neto },
    terceroId: tercero?.id || null,
    formaPago: comprobante.formaPago,
    cajaBancoId: comprobante.cajaBancoId || null
  });

  await createAccountingForDocument(tx, {
    tenantId,
    userId,
    comprobante,
    tercero,
    formaPago: comprobante.formaPago,
    cajaBancoId: comprobante.cajaBancoId || null,
    subtotal,
    ivaTotal,
    impoconsumoTotal,
    inventoryBase,
    expenseBase,
    costOfSales,
    fiscal
  });

  await tx.comprobanteComercial.update({
    where: { id: comprobante.id },
    data: { estado: 'EMITIDO', emitidoEn: new Date(), saldo: comprobante.formaPago === 'CREDITO' ? fiscal.neto : 0 }
  });

  return getDocumentInTx(tx, tenantId, comprobante.id);
}

async function createDocumentInTx(tx, tenantId, userId, input) {
  if (input.sourceId) {
    const existing = await tx.comprobanteComercial.findFirst({ where: { tenantId, sourceId: input.sourceId } });
    if (existing) return getDocumentInTx(tx, tenantId, existing.id);
  }

  const record = await createDocumentRecordInTx(tx, tenantId, userId, input);
  if (requestedState(input) === 'EMITIDO') return emitDocumentEffectsInTx(tx, tenantId, userId, record);
  return getDocumentInTx(tx, tenantId, record.comprobante.id);
}

async function createDocument(tenantId, userId, input) {
  return prisma.$transaction((tx) => createDocumentInTx(tx, tenantId, userId, input));
}

async function emitDocument(tenantId, userId, id) {
  return prisma.$transaction(async (tx) => {
    const document = await getDocumentInTx(tx, tenantId, id);
    if (document.estado !== 'BORRADOR') throw new AppError(409, 'Solo un borrador puede emitirse', 'COMMERCIAL_NOT_DRAFT');
    const lines = await buildLines(tx, tenantId, document.tipo, document.detalles.map(lineInputFromStored));
    return emitDocumentEffectsInTx(tx, tenantId, userId, {
      comprobante: document,
      tercero: document.tercero,
      lines,
      subtotal: money(document.subtotal),
      descuentoTotal: money(document.descuentoTotal),
      ivaTotal: money(document.ivaTotal),
      impoconsumoTotal: money(document.impoconsumoTotal),
      total: money(document.total)
    });
  });
}

async function updateDraftDocument(tenantId, userId, id, input) {
  return prisma.$transaction(async (tx) => {
    const current = await getDocumentInTx(tx, tenantId, id);
    if (current.estado !== 'BORRADOR') {
      throw new AppError(409, 'Un documento emitido no se edita directamente; use reemplazar para generar reverso y nueva versión', 'COMMERCIAL_IMMUTABLE_USE_REPLACE');
    }

    const type = input.tipo || current.tipo;
    const mergedDetails = input.detalles || current.detalles.map(lineInputFromStored);
    const terceroId = Object.prototype.hasOwnProperty.call(input, 'terceroId') ? input.terceroId : current.terceroId;
    const tercero = await resolveThirdParty(tx, tenantId, type, terceroId);
    const lines = await buildLines(tx, tenantId, type, mergedDetails);

    const subtotal = sumLines(lines, 'subtotal');
    const descuentoTotal = sumLines(lines, 'descuento');
    const ivaTotal = sumLines(lines, 'iva');
    const impoconsumoTotal = sumLines(lines, 'impoconsumo');
    const total = sumLines(lines, 'total');

    await tx.detalleComprobante.deleteMany({ where: { tenantId, comprobanteId: current.id } });
    await tx.comprobanteComercial.update({
      where: { id: current.id },
      data: {
        tipo: type,
        terceroId: tercero?.id || null,
        cajaBancoId: Object.prototype.hasOwnProperty.call(input, 'cajaBancoId') ? input.cajaBancoId : current.cajaBancoId,
        formaPago: Object.prototype.hasOwnProperty.call(input, 'formaPago') ? input.formaPago : current.formaPago,
        fecha: input.fecha || current.fecha,
        fechaVencimiento: Object.prototype.hasOwnProperty.call(input, 'fechaVencimiento') ? input.fechaVencimiento : current.fechaVencimiento,
        observaciones: Object.prototype.hasOwnProperty.call(input, 'observaciones') ? input.observaciones : current.observaciones,
        subtotal, descuentoTotal, ivaTotal, impoconsumoTotal, total, saldo: 0
      }
    });

    await tx.detalleComprobante.createMany({
      data: lines.map((line) => ({
        tenantId,
        comprobanteId: current.id,
        productoId: line.productoId,
        descripcion: line.descripcion,
        cantidad: line.cantidad,
        precioUnitario: line.precioUnitario,
        descuentoPct: line.descuentoPct,
        ivaPct: line.ivaPct,
        impoconsumoPct: line.impoconsumoPct,
        subtotalLinea: line.subtotal,
        ivaValor: line.iva,
        impoconsumoValor: line.impoconsumo,
        totalLinea: line.total,
        costoUnitario: line.costoUnitario
      }))
    });

    return getDocumentInTx(tx, tenantId, current.id);
  });
}

async function createCancellationNoteInTx(tx, tenantId, userId, original, motivo) {
  const type = original.tipo === 'FACTURA_VENTA' ? 'NOTA_CREDITO' : 'NOTA_DEBITO';
  const note = await tx.comprobanteComercial.create({
    data: {
      tenantId,
      tipo: type,
      numero: generateNumber(type),
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

async function cancelDocumentInTx(tx, tenantId, userId, id, motivo) {
  const original = await getDocumentInTx(tx, tenantId, id);
  if (original.estado === 'ANULADO') return { documento: original, ajuste: original.ajustes?.[0] || null, yaAnulado: true };

  if (original.estado === 'BORRADOR') {
    await tx.comprobanteComercial.update({ where: { id: original.id }, data: { estado: 'ANULADO', anuladoEn: new Date(), motivoAnulacion: motivo } });
    return { documento: await getDocumentInTx(tx, tenantId, original.id), ajuste: null };
  }

  if (!ISSUED_STATES.has(original.estado) || !TRANSACTIONAL_TYPES.has(original.tipo)) {
    throw new AppError(409, 'El documento no admite anulación automática', 'COMMERCIAL_CANNOT_CANCEL');
  }

  const note = await createCancellationNoteInTx(tx, tenantId, userId, original, motivo);
  await treasuryService.reversePaymentsForDocumentInTx(tx, { tenantId, userId, documentoId: original.id, motivo });
  await treasuryReversalService.reverseDirectDocumentSettlementInTx(tx, { tenantId, userId, documentoId: original.id, reversalDocumentId: note.id, referencia: note.numero, motivo });
  await treasuryService.cancelCarteraForDocumentInTx(tx, { tenantId, documentoId: original.id, reversalDocumentId: note.id, referencia: note.numero, motivo });
  await inventoryService.reverseDocumentMovementsInTx(tx, { tenantId, comprobanteId: original.id, reversalDocumentId: note.id, referencia: note.numero });

  if (original.asiento) {
    await accountingService.reverseJournalInTx(tx, {
      tenantId,
      userId,
      asiento: original.asiento,
      comprobanteId: note.id,
      sourceId: `REV-DOC-${original.id}`,
      referencia: note.numero,
      concepto: `Anulación ${original.numero}`
    });
  }

  await tx.comprobanteComercial.update({ where: { id: original.id }, data: { estado: 'ANULADO', saldo: 0, anuladoEn: new Date(), motivoAnulacion: motivo } });
  return { documento: await getDocumentInTx(tx, tenantId, original.id), ajuste: await getDocumentInTx(tx, tenantId, note.id) };
}

async function cancelDocument(tenantId, userId, id, motivo) {
  return prisma.$transaction((tx) => cancelDocumentInTx(tx, tenantId, userId, id, motivo));
}

async function replaceIssuedDocument(tenantId, userId, id, input) {
  return prisma.$transaction(async (tx) => {
    const original = await getDocumentInTx(tx, tenantId, id);
    if (!ISSUED_STATES.has(original.estado) || !TRANSACTIONAL_TYPES.has(original.tipo)) {
      throw new AppError(409, 'Solo un documento emitido puede reemplazarse', 'COMMERCIAL_REPLACE_REQUIRES_ISSUED');
    }

    const cancellation = await cancelDocumentInTx(tx, tenantId, userId, original.id, input.motivo || 'Reemplazo de documento emitido');
    const replacementInput = {
      tipo: original.tipo,
      estado: 'EMITIDO',
      documentoOrigenId: original.id,
      terceroId: Object.prototype.hasOwnProperty.call(input, 'terceroId') ? input.terceroId : original.terceroId,
      cajaBancoId: Object.prototype.hasOwnProperty.call(input, 'cajaBancoId') ? input.cajaBancoId : original.cajaBancoId,
      formaPago: Object.prototype.hasOwnProperty.call(input, 'formaPago') ? input.formaPago : original.formaPago,
      fecha: input.fecha || new Date(),
      fechaVencimiento: Object.prototype.hasOwnProperty.call(input, 'fechaVencimiento') ? input.fechaVencimiento : original.fechaVencimiento,
      observaciones: Object.prototype.hasOwnProperty.call(input, 'observaciones') ? input.observaciones : original.observaciones,
      sourceId: input.sourceId || null,
      detalles: input.detalles || original.detalles.map(lineInputFromStored)
    };

    const nuevo = await createDocumentInTx(tx, tenantId, userId, replacementInput);
    return { anulacion: cancellation, nuevo };
  });
}

async function listDocuments(tenantId, filters = {}) {
  const where = { tenantId };
  if (filters.tipo) where.tipo = filters.tipo;
  if (filters.estado) where.estado = filters.estado;
  if (filters.terceroId) where.terceroId = filters.terceroId;
  if (filters.desde || filters.hasta) {
    where.fecha = {};
    if (filters.desde) where.fecha.gte = new Date(filters.desde);
    if (filters.hasta) where.fecha.lte = new Date(filters.hasta);
  }
  if (filters.montoMin !== undefined || filters.montoMax !== undefined) {
    where.total = {};
    if (filters.montoMin !== undefined) where.total.gte = money(filters.montoMin);
    if (filters.montoMax !== undefined) where.total.lte = money(filters.montoMax);
  }

  const page = Math.max(Number(filters.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(filters.pageSize || filters.limit) || 50, 1), 200);
  const [items, total] = await Promise.all([
    prisma.comprobanteComercial.findMany({ where, include: { tercero: true }, orderBy: [{ fecha: 'desc' }, { creadoEn: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.comprobanteComercial.count({ where })
  ]);

  return { items, meta: { page, pageSize, total, pages: Math.max(Math.ceil(total / pageSize), 1) } };
}

async function getDocument(tenantId, id) {
  return getDocumentInTx(prisma, tenantId, id);
}

module.exports = {
  createDocument,
  createDocumentInTx,
  emitDocument,
  updateDraftDocument,
  cancelDocument,
  replaceIssuedDocument,
  listDocuments,
  getDocument
};
