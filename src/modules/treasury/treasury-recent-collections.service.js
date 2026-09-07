'use strict';

const { prisma } = require('../../config/prisma');

const KIND_LABELS = Object.freeze({
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia / QR',
  TARJETA: 'Tarjeta',
  CHEQUE: 'Cheque',
  OTRO: 'Otro',
  OTRO_ELECTRONICO: 'Otro electrónico'
});

function methodLabel(kind, configuredLabel = null) {
  const custom = String(configuredLabel || '').trim();
  if (custom) return custom;
  return KIND_LABELS[String(kind || '').toUpperCase()] || String(kind || '—').replaceAll('_', ' ');
}

function cleanReference(reference, documentNumber) {
  const value = String(reference || '').trim();
  if (!value || value === String(documentNumber || '').trim()) return null;
  return value;
}

async function listRecentCollections(tenantId, filters = {}) {
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
  const movements = await prisma.movimientoTesoreria.findMany({
    where: { tenantId, tipo: 'INGRESO' },
    include: {
      cajaBanco: {
        select: { id: true, nombre: true, tipo: true, banco: true, numeroCuenta: true, activo: true }
      },
      comprobante: {
        select: {
          id: true,
          tipo: true,
          numero: true,
          formaPago: true,
          estado: true,
          documentoOrigenId: true
        }
      }
    },
    orderBy: { creadoEn: 'desc' },
    take: Math.min(limit * 2, 400)
  });

  const validMovements = movements
    .filter((movement) => movement.comprobante?.estado !== 'ANULADO')
    .slice(0, limit);
  const comprobanteIds = [...new Set(validMovements.map((movement) => movement.comprobanteId).filter(Boolean))];

  const [sessions, payments] = await Promise.all([
    comprobanteIds.length
      ? prisma.restaurantTableSession.findMany({
        where: { tenantId, saleId: { in: comprobanteIds } },
        select: {
          saleId: true,
          paymentMethodLabel: true,
          paymentMethodKind: true,
          paymentAccountId: true,
          paymentReference: true
        }
      })
      : [],
    comprobanteIds.length
      ? prisma.pago.findMany({
        where: { tenantId, comprobanteTesoreriaId: { in: comprobanteIds } },
        select: {
          comprobanteTesoreriaId: true,
          metodoPago: true,
          referencia: true,
          documento: { select: { id: true, numero: true, tipo: true } }
        }
      })
      : []
  ]);

  const sessionBySale = new Map();
  for (const session of sessions) {
    if (session.saleId && !sessionBySale.has(session.saleId)) sessionBySale.set(session.saleId, session);
  }
  const paymentByReceipt = new Map(payments.map((payment) => [payment.comprobanteTesoreriaId, payment]));

  return validMovements.map((movement) => {
    const receiptPayment = movement.comprobanteId ? paymentByReceipt.get(movement.comprobanteId) : null;
    const restaurantSession = movement.comprobanteId ? sessionBySale.get(movement.comprobanteId) : null;
    const destination = movement.cajaBanco || null;

    let source = 'TESORERIA';
    let kind = null;
    let label = null;
    let document = movement.comprobante
      ? { id: movement.comprobante.id, numero: movement.comprobante.numero, tipo: movement.comprobante.tipo }
      : null;
    let reference = cleanReference(movement.referencia, document?.numero);

    if (receiptPayment) {
      source = 'CARTERA';
      kind = String(receiptPayment.metodoPago || '').toUpperCase() || null;
      label = methodLabel(kind);
      document = receiptPayment.documento || document;
      reference = cleanReference(receiptPayment.referencia || movement.referencia, document?.numero);
    } else if (restaurantSession) {
      source = 'RESTAURANTE_POS';
      kind = String(restaurantSession.paymentMethodKind || '').toUpperCase() || null;
      if (!kind) {
        kind = movement.comprobante?.formaPago === 'EFECTIVO'
          ? 'EFECTIVO'
          : movement.comprobante?.formaPago === 'BANCO' ? 'OTRO_ELECTRONICO' : null;
      }
      label = methodLabel(kind, restaurantSession.paymentMethodLabel);
      reference = cleanReference(restaurantSession.paymentReference || movement.referencia, document?.numero);
    } else {
      kind = movement.comprobante?.formaPago === 'EFECTIVO'
        ? 'EFECTIVO'
        : movement.comprobante?.formaPago === 'BANCO' ? 'OTRO_ELECTRONICO' : null;
      label = methodLabel(kind);
    }

    return {
      id: movement.id,
      creadoEn: movement.creadoEn,
      documento: document,
      metodoPago: kind,
      metodoLabel: label || '—',
      monto: movement.monto,
      referencia: reference,
      concepto: movement.concepto || null,
      cuentaDestino: destination
        ? {
          id: destination.id,
          nombre: destination.nombre,
          tipo: destination.tipo,
          banco: destination.banco,
          numeroCuenta: destination.numeroCuenta
        }
        : null,
      source
    };
  });
}

module.exports = { KIND_LABELS, methodLabel, listRecentCollections };
