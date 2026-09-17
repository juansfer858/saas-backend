'use strict';

const crypto = require('node:crypto');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { money, decimal } = require('../../utils/decimal');
const commercial = require('../commercial/commercial.service');
const sales = require('../commercial/sales.service');
const treasury = require('../treasury/treasury.service');
const treasuryReversal = require('../treasury/treasury-reversal.service');
const inventory = require('../inventory/inventory.service');
const accounting = require('../accounting/accounting.service');
const customerDisplay = require('./restaurant-customer-display-name');
const { lockOperation } = require('./restaurant-operation-lock-v111.service');
const { installOperationalPosMode } = require('./restaurant-pos-operational-mode');

installOperationalPosMode();

const MARKER = 'VANTIX_RESTAURANT_CUSTOMER_REISSUE_V128';
const GENERIC_CUSTOMER_IDENTIFICATION = '222222222222';
const ISSUED_STATES = new Set(['EMITIDO', 'PAGADO_PARCIAL', 'PAGADO_TOTAL', 'CONFIRMADO']);
const CUSTOMER_TYPES = ['CLIENTE', 'CLIENTE_PROVEEDOR'];

function customerLabel(customer) {
  return String(customer?.razonSocial || customer?.nombre || 'Cliente').trim().slice(0, 160);
}

function publicCustomer(customer) {
  if (!customer) return null;
  return {
    id: customer.id,
    tipo: customer.tipo,
    tipoDocumento: customer.tipoDocumento,
    identificacion: customer.identificacion,
    nombre: customer.nombre,
    razonSocial: customer.razonSocial || null,
    direccion: customer.direccion || null,
    telefono: customer.telefono || null,
    email: customer.email || null
  };
}

function publicSale(sale) {
  if (!sale) return null;
  return {
    id: sale.id,
    numero: sale.numero,
    estado: sale.estado,
    terceroId: sale.terceroId || null,
    total: money(sale.total || 0).toString(),
    saldo: money(sale.saldo || 0).toString(),
    formaPago: sale.formaPago || null,
    cajaBancoId: sale.cajaBancoId || null
  };
}

function lineInputFromStored(detail) {
  return {
    productoId: detail.productoId || null,
    descripcion: detail.descripcion,
    cantidad: Number(detail.cantidad),
    precioUnitario: Number(detail.precioUnitario),
    descuentoPct: Number(detail.descuentoPct || 0),
    ivaPct: Number(detail.ivaPct || 0),
    impoconsumoPct: Number(detail.impoconsumoPct || 0)
  };
}

function decimalKey(value) {
  return decimal(value || 0).toString();
}

function detailSignature(detail) {
  return JSON.stringify([
    detail.productoId || null,
    String(detail.descripcion || '').trim(),
    decimalKey(detail.cantidad),
    decimalKey(detail.precioUnitario),
    decimalKey(detail.descuentoPct),
    decimalKey(detail.ivaPct),
    decimalKey(detail.impoconsumoPct),
    decimalKey(detail.totalLinea)
  ]);
}

function mapReplacementDetails(originalDetails, replacementDetails) {
  const available = new Map();
  for (const detail of replacementDetails || []) {
    const key = detailSignature(detail);
    const queue = available.get(key) || [];
    queue.push(detail.id);
    available.set(key, queue);
  }
  const mapping = new Map();
  for (const detail of originalDetails || []) {
    const key = detailSignature(detail);
    const queue = available.get(key) || [];
    const replacementId = queue.shift();
    if (!replacementId) {
      throw new AppError(409, 'No fue posible conservar el vínculo entre Producción y la nueva venta', 'RESTAURANT_REISSUE_DETAIL_MAP_FAILED');
    }
    mapping.set(detail.id, replacementId);
  }
  if (mapping.size !== (originalDetails || []).length || [...available.values()].some((queue) => queue.length)) {
    throw new AppError(409, 'La venta recreada no conserva exactamente las líneas originales', 'RESTAURANT_REISSUE_DETAIL_COUNT_MISMATCH');
  }
  return mapping;
}

function cancellationNumber() {
  return `NC-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

async function createCancellationNoteInTx(tx, tenantId, userId, original, motivo) {
  const note = await tx.comprobanteComercial.create({
    data: {
      tenantId,
      tipo: 'NOTA_CREDITO',
      numero: cancellationNumber(),
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
  if ((original.detalles || []).length) {
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

async function cancelOriginalSaleInTx(tx, tenantId, userId, original, motivo) {
  const note = await createCancellationNoteInTx(tx, tenantId, userId, original, motivo);
  await treasury.reversePaymentsForDocumentInTx(tx, { tenantId, userId, documentoId: original.id, motivo });
  await treasuryReversal.reverseDirectDocumentSettlementInTx(tx, {
    tenantId,
    userId,
    documentoId: original.id,
    reversalDocumentId: note.id,
    referencia: note.numero,
    motivo
  });
  await treasury.cancelCarteraForDocumentInTx(tx, {
    tenantId,
    documentoId: original.id,
    reversalDocumentId: note.id,
    referencia: note.numero,
    motivo
  });
  await inventory.reverseDocumentMovementsInTx(tx, {
    tenantId,
    comprobanteId: original.id,
    reversalDocumentId: note.id,
    referencia: note.numero
  });
  if (original.asiento) {
    await accounting.reverseJournalInTx(tx, {
      tenantId,
      userId,
      asiento: original.asiento,
      comprobanteId: note.id,
      sourceId: `REV-DOC-${original.id}`,
      referencia: note.numero,
      concepto: `Anulación ${original.numero}`,
      motivo
    });
  }
  await tx.comprobanteComercial.update({
    where: { id: original.id },
    data: { estado: 'ANULADO', saldo: 0, anuladoEn: new Date(), motivoAnulacion: motivo }
  });
  return note;
}

async function ensureTipAccountInTx(tx, tenantId) {
  const root = await tx.cuentaPUC.findFirst({ where: { tenantId, codigo: '23' } });
  if (!root) throw new AppError(409, 'PUC no tiene grupo 23 para contabilizar propinas', 'RESTAURANT_TIP_ACCOUNT_PARENT_MISSING');
  const parent = await tx.cuentaPUC.upsert({
    where: { tenantId_codigo: { tenantId, codigo: '2380' } },
    create: { tenantId, codigo: '2380', codigoReferencia: '2380', nombre: 'Acreedores varios - Restaurante', nivel: 'CUENTA', naturaleza: 'CREDITO', parentId: root.id, permiteMovimiento: false, clasificacionESF: 'PASIVO_CORRIENTE', versionCatalogo: 'CO-RESTAURANT-V1', activa: true },
    update: { activa: true }
  });
  return tx.cuentaPUC.upsert({
    where: { tenantId_codigo: { tenantId, codigo: '238095' } },
    create: { tenantId, codigo: '238095', codigoReferencia: '238095', nombre: 'Propinas por pagar', nivel: 'SUBCUENTA', naturaleza: 'CREDITO', parentId: parent.id, permiteMovimiento: true, clasificacionESF: 'PASIVO_CORRIENTE', versionCatalogo: 'CO-RESTAURANT-V1', activa: true },
    update: { nombre: 'Propinas por pagar', activa: true, permiteMovimiento: true }
  });
}

async function cashAccountingAccountInTx(tx, tenantId, cajaBancoId) {
  const caja = await treasury.getCajaBanco(tenantId, cajaBancoId, tx);
  if (caja.cuentaContableId) {
    const mapped = await tx.cuentaPUC.findFirst({ where: { id: caja.cuentaContableId, tenantId, activa: true, permiteMovimiento: true } });
    if (mapped) return mapped;
  }
  return accounting.getMappedAccount(tx, tenantId, caja.tipo === 'BANCO' ? 'BANCO_GENERAL' : 'CAJA_GENERAL');
}

async function reverseTipJournalInTx(tx, tenantId, userId, session, originalSale) {
  const tipAmount = money(session.tipAmount || 0);
  if (!tipAmount.gt(0)) return null;
  const sourceId = `REST-TIP-${session.id}`;
  const journal = await tx.asientoContable.findFirst({
    where: { tenantId, sourceId },
    include: { detalles: true }
  });
  if (!journal || journal.estado !== 'CONTABILIZADO') {
    throw new AppError(409, 'La propina de esta venta no tiene un asiento activo seguro para reversar', 'RESTAURANT_REISSUE_TIP_JOURNAL_INVALID');
  }
  return accounting.reverseJournalInTx(tx, {
    tenantId,
    userId,
    asiento: journal,
    comprobanteId: null,
    sourceId: `REV-REST-TIP-${originalSale.id}`,
    referencia: originalSale.numero,
    concepto: `Anulación de propina ${originalSale.numero}`,
    motivo: 'Anulación y recreación por identificación de cliente'
  });
}

async function postReplacementTipInTx(tx, tenantId, userId, session, sale) {
  const tipAmount = money(session.tipAmount || 0);
  if (!tipAmount.gt(0)) return null;
  if (!sale.cajaBancoId || sale.formaPago === 'CREDITO') {
    throw new AppError(409, 'La propina no puede recrearse sin una cuenta de pago de contado', 'RESTAURANT_REISSUE_TIP_ACCOUNT_INVALID');
  }
  const cashAccount = await cashAccountingAccountInTx(tx, tenantId, sale.cajaBancoId);
  const tipAccount = await ensureTipAccountInTx(tx, tenantId);
  const movement = await treasury.recordTreasuryMovementInTx(tx, {
    tenantId,
    userId,
    cajaBancoId: sale.cajaBancoId,
    comprobanteId: sale.id,
    tipo: 'INGRESO',
    monto: tipAmount,
    sign: 1,
    referencia: sale.numero,
    concepto: `Propina separada ${sale.numero}`
  });
  const journal = await accounting.createJournalInTx(tx, {
    tenantId,
    userId,
    comprobanteId: null,
    sourceId: `REST-TIP-REISSUE-${session.id}-${sale.id}`,
    fecha: new Date(),
    concepto: `Propina por pagar ${sale.numero}`,
    referencia: sale.numero,
    detalles: [
      { cuentaId: cashAccount.id, debito: tipAmount, credito: 0, concepto: `Cobro propina ${sale.numero}` },
      { cuentaId: tipAccount.id, debito: 0, credito: tipAmount, concepto: `Propina por pagar ${sale.numero}` }
    ]
  });
  return { movement: movement.movement, journal };
}

async function existingReplacementForSale(client, tenantId, saleId) {
  const replacement = await client.comprobanteComercial.findFirst({
    where: { tenantId, tipo: 'FACTURA_VENTA', documentoOrigenId: saleId, estado: { not: 'ANULADO' } },
    include: { tercero: true },
    orderBy: { creadoEn: 'desc' }
  });
  if (!replacement) return null;
  const session = await client.restaurantTableSession.findFirst({ where: { tenantId, saleId: replacement.id } });
  return session ? { replacement, session } : null;
}

async function reissueContextForSale(tenantId, userId, saleId, client = prisma) {
  const original = await client.comprobanteComercial.findFirst({
    where: { id: saleId, tenantId, tipo: 'FACTURA_VENTA' },
    include: { tercero: true }
  });
  if (!original) return null;

  if (original.estado === 'ANULADO') {
    const existing = await existingReplacementForSale(client, tenantId, original.id);
    if (existing) {
      return {
        marker: MARKER,
        saleId: original.id,
        saleNumber: original.numero,
        saleState: original.estado,
        eligible: false,
        alreadyReissued: true,
        blockedReason: 'ALREADY_REISSUED',
        replacement: publicSale(existing.replacement),
        customer: publicCustomer(existing.replacement.tercero)
      };
    }
  }

  const session = await client.restaurantTableSession.findFirst({
    where: { tenantId, saleId: original.id },
    include: { table: { select: { id: true, code: true, name: true } } }
  });
  if (!session) return null;

  const [acceptedDian, sessionPaymentCount, shift] = await Promise.all([
    client.dianDocument.findFirst({ where: { tenantId, originType: 'COMPROBANTE_COMERCIAL', originId: original.id, state: 'ACEPTADO' }, select: { id: true } }),
    client.restaurantSessionPayment.count({ where: { tenantId, sessionId: session.id } }),
    session.cashShiftId ? client.aperturaCierreCaja.findFirst({ where: { id: session.cashShiftId, tenantId } }) : null
  ]);

  let blockedReason = null;
  let blockedMessage = null;
  const generic = String(original.tercero?.identificacion || '').trim() === GENERIC_CUSTOMER_IDENTIFICATION;
  const splitMode = String(session.splitMode || 'NONE').trim().toUpperCase();
  if (session.state !== 'CERRADA') {
    blockedReason = 'SESSION_NOT_CLOSED';
    blockedMessage = 'La cuenta todavía no está liquidada.';
  } else if (!ISSUED_STATES.has(original.estado)) {
    blockedReason = 'SALE_NOT_ISSUED';
    blockedMessage = 'Solo una venta emitida puede anularse y recrearse.';
  } else if (!generic) {
    blockedReason = 'CUSTOMER_ALREADY_IDENTIFIED';
    blockedMessage = 'Esta venta ya tiene un cliente identificado.';
  } else if (original.formaPago === 'CREDITO') {
    blockedReason = 'CREDIT_NOT_SUPPORTED';
    blockedMessage = 'Una venta a crédito ya exige cliente identificado y no entra en este flujo.';
  } else if (splitMode !== 'NONE' || sessionPaymentCount > 0) {
    blockedReason = 'SPLIT_NOT_SUPPORTED';
    blockedMessage = 'Una cuenta dividida requiere un ajuste específico y no se recrea automáticamente.';
  } else if (acceptedDian) {
    blockedReason = 'DIAN_ACCEPTED';
    blockedMessage = 'El documento ya fue aceptado fiscalmente y requiere el ajuste electrónico correspondiente.';
  } else if (!shift || shift.estado !== 'ABIERTA') {
    blockedReason = 'SHIFT_CLOSED';
    blockedMessage = 'El turno de Caja de esta venta ya está cerrado; no se modifica automáticamente.';
  } else if (shift.userId !== userId) {
    blockedReason = 'SHIFT_OWNER_REQUIRED';
    blockedMessage = 'La recreación debe hacerla el cajero dueño del turno que registró el cobro.';
  }

  return {
    marker: MARKER,
    saleId: original.id,
    saleNumber: original.numero,
    saleState: original.estado,
    sessionId: session.id,
    table: session.table,
    cashShiftId: session.cashShiftId || null,
    customer: publicCustomer(original.tercero),
    genericCustomer: generic,
    eligible: !blockedReason,
    alreadyReissued: false,
    blockedReason,
    blockedMessage
  };
}

async function reissueGenericCustomerSale(tenantId, user, saleId, terceroId) {
  return prisma.$transaction(async (tx) => {
    await lockOperation(tx, tenantId, true);

    const existing = await existingReplacementForSale(tx, tenantId, saleId);
    if (existing) {
      return {
        marker: MARKER,
        reissued: true,
        idempotent: true,
        originalSaleId: saleId,
        replacement: publicSale(existing.replacement),
        customer: publicCustomer(existing.replacement.tercero),
        sessionId: existing.session.id
      };
    }

    const context = await reissueContextForSale(tenantId, user.id, saleId, tx);
    if (!context) throw new AppError(404, 'La venta del restaurante no está disponible', 'RESTAURANT_REISSUE_SALE_NOT_FOUND');
    if (!context.eligible) {
      throw new AppError(409, context.blockedMessage || 'La venta no puede anularse y recrearse automáticamente', `RESTAURANT_REISSUE_${context.blockedReason || 'BLOCKED'}`);
    }

    const customer = await tx.tercero.findFirst({
      where: { id: terceroId, tenantId, activo: true, tipo: { in: CUSTOMER_TYPES } }
    });
    if (!customer || String(customer.identificacion || '').trim() === GENERIC_CUSTOMER_IDENTIFICATION) {
      throw new AppError(400, 'Selecciona un cliente identificado y activo', 'RESTAURANT_REISSUE_CUSTOMER_INVALID');
    }

    const session = await tx.restaurantTableSession.findFirst({
      where: { id: context.sessionId, tenantId, saleId },
      include: { table: true }
    });
    if (!session) throw new AppError(409, 'La sesión cambió; actualiza Caja antes de continuar', 'RESTAURANT_REISSUE_SESSION_CHANGED');

    const original = await tx.comprobanteComercial.findFirst({
      where: { id: saleId, tenantId, tipo: 'FACTURA_VENTA' },
      include: {
        tercero: true,
        detalles: { orderBy: { id: 'asc' } },
        asiento: { include: { detalles: true } }
      }
    });
    if (!original || !ISSUED_STATES.has(original.estado)) {
      throw new AppError(409, 'La venta cambió; actualiza Caja antes de continuar', 'RESTAURANT_REISSUE_SALE_CHANGED');
    }

    const acceptedDian = await tx.dianDocument.findFirst({
      where: { tenantId, originType: 'COMPROBANTE_COMERCIAL', originId: original.id, state: 'ACEPTADO' },
      select: { id: true }
    });
    if (acceptedDian) throw new AppError(409, 'El documento ya fue aceptado fiscalmente y requiere ajuste electrónico', 'RESTAURANT_REISSUE_DIAN_ACCEPTED');

    const motivo = `Anulación y recreación para identificar cliente ${customer.identificacion}`.slice(0, 500);
    const tipAmount = money(session.tipAmount || 0);
    await reverseTipJournalInTx(tx, tenantId, user.id, session, original);
    const cancellationNote = await cancelOriginalSaleInTx(tx, tenantId, user.id, original, motivo);

    await tx.consumptionRun.updateMany({
      where: { tenantId, sourceType: 'SALE', sourceId: original.id, state: 'COMPLETED' },
      data: { state: 'REVERSED', reversedAt: new Date() }
    });
    await tx.dianDocument.updateMany({
      where: {
        tenantId,
        originType: 'COMPROBANTE_COMERCIAL',
        originId: original.id,
        state: { in: ['GENERADO', 'PENDIENTE_ENVIO', 'CONTINGENCIA', 'RECHAZADO'] }
      },
      data: {
        state: 'CANCELADO',
        nextRetryAt: null,
        lastError: 'Documento de restaurante anulado y recreado para identificar cliente',
        contingencyReason: null
      }
    });

    const sourceId = `REST-TABLE-REISSUE-${session.tableId}-${original.id}`.slice(0, 120);
    const draft = await commercial.createDocumentInTx(tx, tenantId, user.id, {
      tipo: 'FACTURA_VENTA',
      estado: 'BORRADOR',
      documentoOrigenId: original.id,
      sourceId,
      terceroId: customer.id,
      cajaBancoId: original.cajaBancoId,
      formaPago: original.formaPago,
      fecha: new Date(),
      fechaVencimiento: original.fechaVencimiento || null,
      observaciones: customerDisplay.mergeCustomerNameObservation(original.observaciones, customerLabel(customer)),
      detalles: original.detalles.map(lineInputFromStored)
    });
    const replacement = await sales.emitSaleInTx(tx, tenantId, user.id, draft.id, 'DOCUMENTO_EQUIVALENTE_POS');

    if (!money(replacement.total).eq(money(original.total))) {
      throw new AppError(409, 'La nueva venta cambió de valor; la operación fue revertida completa', 'RESTAURANT_REISSUE_TOTAL_CHANGED');
    }

    const detailMap = mapReplacementDetails(original.detalles, replacement.detalles || []);
    for (const [oldDetailId, newDetailId] of detailMap.entries()) {
      await tx.restaurantOrderItem.updateMany({
        where: { tenantId, saleDetailId: oldDetailId },
        data: { saleDetailId: newDetailId }
      });
    }

    const tipPosting = await postReplacementTipInTx(tx, tenantId, user.id, session, replacement);

    const config = await tx.restaurantConfig.findUnique({ where: { tenantId } });
    if (config?.dianRealEnabled) {
      if (!replacement.dianDocument) {
        throw new AppError(409, 'DIAN está habilitada pero la nueva venta no generó documento fiscal', 'RESTAURANT_REISSUE_DIAN_DOCUMENT_REQUIRED');
      }
      await tx.restaurantFiscalDocument.create({
        data: {
          tenantId,
          sessionId: session.id,
          saleId: replacement.id,
          mode: 'DIAN',
          documentType: 'DOCUMENTO_EQUIVALENTE_POS',
          internalNumber: replacement.numero,
          dianDocumentId: replacement.dianDocument.id,
          simulatedData: null
        }
      });
    }

    const moved = await tx.restaurantTableSession.updateMany({
      where: { id: session.id, tenantId, saleId: original.id, state: 'CERRADA' },
      data: { saleId: replacement.id }
    });
    if (moved.count !== 1) {
      throw new AppError(409, 'La sesión cambió durante la recreación; no se aplicó ningún cambio', 'RESTAURANT_REISSUE_SESSION_RACE');
    }

    await tx.auditoriaContable.create({
      data: {
        tenantId,
        userId: user.id,
        entidad: 'RESTAURANT_TABLE_SESSION',
        entidadId: session.id,
        accion: 'RESTAURANT_SALE_CUSTOMER_REISSUED',
        metadata: {
          marker: MARKER,
          scope: 'VOID_AND_REISSUE',
          sessionId: session.id,
          tableId: session.tableId,
          cashShiftId: session.cashShiftId,
          originalSaleId: original.id,
          originalSaleNumber: original.numero,
          cancellationNoteId: cancellationNote.id,
          cancellationNoteNumber: cancellationNote.numero,
          replacementSaleId: replacement.id,
          replacementSaleNumber: replacement.numero,
          oldCustomerId: original.terceroId,
          newCustomerId: customer.id,
          newCustomerIdentification: customer.identificacion,
          total: money(replacement.total).toString(),
          tipAmount: tipAmount.toString(),
          paymentMethodKind: session.paymentMethodKind || null,
          paymentAccountId: session.paymentAccountId || replacement.cajaBancoId || null,
          productionLinksRemapped: detailMap.size,
          originalPreservedAsCancelled: true
        }
      }
    });

    return {
      marker: MARKER,
      reissued: true,
      idempotent: false,
      sessionId: session.id,
      cancellation: {
        sale: publicSale({ ...original, estado: 'ANULADO', saldo: 0 }),
        note: { id: cancellationNote.id, numero: cancellationNote.numero }
      },
      replacement: publicSale(replacement),
      customer: publicCustomer(customer),
      tipReposted: Boolean(tipPosting),
      productionLinksRemapped: detailMap.size
    };
  }, { maxWait: 10_000, timeout: 30_000 });
}

module.exports = {
  MARKER,
  GENERIC_CUSTOMER_IDENTIFICATION,
  reissueContextForSale,
  reissueGenericCustomerSale,
  mapReplacementDetails
};
