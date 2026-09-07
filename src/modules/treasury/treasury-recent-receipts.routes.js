'use strict';

const express = require('express');
const { prisma } = require('../../config/prisma');

const router = express.Router();

function paymentLabel(row) {
  if (row?.cajaBanco?.tipo === 'CAJA') return 'EFECTIVO';
  if (row?.cajaBanco?.tipo === 'BANCO') return 'TARJETA / QR';
  return '—';
}

router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const rows = await prisma.movimientoTesoreria.findMany({
      where: { tenantId:req.tenantId, tipo:'INGRESO' },
      include: {
        cajaBanco: { select:{ id:true, nombre:true, tipo:true, banco:true, numeroCuenta:true } },
        comprobante: { select:{ id:true, numero:true, tipo:true, formaPago:true, estado:true } }
      },
      orderBy: { creadoEn:'desc' },
      take: limit
    });

    const items = rows.map((row) => ({
      id: row.id,
      creadoEn: row.creadoEn,
      monto: row.monto,
      metodoPago: paymentLabel(row),
      referencia: [row.cajaBanco?.nombre, row.referencia].filter(Boolean).join(' · ') || '—',
      concepto: row.concepto || null,
      documentoId: row.comprobanteId || row.id,
      documento: row.comprobante ? {
        id:row.comprobante.id,
        numero:row.comprobante.numero,
        tipo:row.comprobante.tipo,
        formaPago:row.comprobante.formaPago,
        estado:row.comprobante.estado
      } : null,
      cajaBanco: row.cajaBanco,
      saldoAnterior: row.saldoAnterior,
      saldoNuevo: row.saldoNuevo
    }));

    res.set('Cache-Control', 'no-store');
    res.set('X-VantixGC-Treasury-Receipts', 'v43-movimiento-tesoreria');
    res.json({ ok:true, data:{ items, source:'MOVIMIENTO_TESORERIA', immediatePosIncluded:true } });
  } catch (error) { next(error); }
});

module.exports = { treasuryRecentReceiptsRouter:router, paymentLabel };
