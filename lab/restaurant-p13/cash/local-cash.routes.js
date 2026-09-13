'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { prisma } = require('../../../src/config/prisma');
const { verifyAccessToken } = require('../../../src/utils/jwt');
const rbac = require('../../../src/modules/platform/rbac/rbac.service');
const companyService = require('../../../src/modules/restaurant/restaurant-company-profile.service');
const posReceiptPrint = require('../../../src/modules/restaurant/restaurant-pos-receipt-print.service');
const { buildEscPos } = require('../../../edge/print-spooler/escpos');

const MARKER = 'VANTIX_RESTAURANT_P13_E5_LOCAL_CASH_HISTORY';
const LOCAL_CASH_PERMISSION = 'RESTAURANTE.CERRAR';

function moneyString(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? String(value ?? 0) : '0';
}

function apiError(res, status, code, message, details = null) {
  return res.status(status).json({ ok: false, error: { code, message, ...(details ? { details } : {}) } });
}

function bearerToken(req) {
  const value = String(req.headers.authorization || '').trim();
  if (!value.toLowerCase().startsWith('bearer ')) return null;
  return value.slice(7).trim() || null;
}

async function localCashAuth(config, req, res, next) {
  try {
    const token = bearerToken(req);
    if (!token) return apiError(res, 401, 'P13_LOCAL_AUTH_REQUIRED', 'Se requiere sesión local.');
    let payload;
    try { payload = verifyAccessToken(token); }
    catch { return apiError(res, 401, 'P13_LOCAL_AUTH_INVALID', 'La sesión local no es válida o venció.'); }

    const tenant = await prisma.tenant.findUnique({
      where: { subdomain: config.tenantSubdomain },
      select: { id: true, subdomain: true }
    });
    if (!tenant || payload.tenantId !== tenant.id) {
      return apiError(res, 403, 'P13_LOCAL_TENANT_FORBIDDEN', 'La sesión no pertenece a este restaurante local.');
    }
    const user = await prisma.user.findFirst({
      where: { id: payload.userId, tenantId: tenant.id, activo: true },
      select: { id: true, tenantId: true, nombre: true, email: true, rol: true, activo: true }
    });
    if (!user) return apiError(res, 401, 'P13_LOCAL_USER_NOT_FOUND', 'El usuario local ya no está disponible.');
    const permissions = await rbac.effectivePermissions(tenant.id, user);
    if (!permissions.has('*') && !permissions.has(LOCAL_CASH_PERMISSION)) {
      return apiError(res, 403, 'P13_LOCAL_CASH_FORBIDDEN', 'No tienes permiso para consultar Caja.');
    }
    req.p13LocalCash = { tenant, user, permissions };
    return next();
  } catch (error) {
    return next(error);
  }
}

function publicSale(sale) {
  return {
    id: sale.id,
    number: sale.numero,
    state: sale.estado,
    date: sale.fecha || null,
    emittedAt: sale.emitidoEn || null,
    subtotal: moneyString(sale.subtotal),
    discount: moneyString(sale.descuentoTotal),
    iva: moneyString(sale.ivaTotal),
    impoconsumo: moneyString(sale.impoconsumoTotal),
    total: moneyString(sale.total),
    balance: moneyString(sale.saldo),
    paymentForm: sale.formaPago || null,
    customerId: sale.terceroId || null,
    items: (sale.detalles || []).map((row) => ({
      id: row.id,
      productId: row.productoId || null,
      description: row.descripcion,
      quantity: String(row.cantidad),
      unitPrice: moneyString(row.precioUnitario),
      subtotal: moneyString(row.subtotalLinea),
      iva: moneyString(row.ivaValor),
      impoconsumo: moneyString(row.impoconsumoValor),
      total: moneyString(row.totalLinea)
    }))
  };
}

async function loadSettledDocument(tenantId, sessionId) {
  const session = await prisma.restaurantTableSession.findFirst({
    where: { id: sessionId, tenantId, state: 'CERRADA' },
    include: { table: true }
  });
  if (!session) {
    const error = new Error('La venta liquidada no existe en este restaurante.');
    error.statusCode = 404;
    error.code = 'P13_LOCAL_SETTLED_SESSION_NOT_FOUND';
    throw error;
  }
  const sale = await prisma.comprobanteComercial.findFirst({
    where: { id: session.saleId, tenantId, tipo: 'FACTURA_VENTA', estado: { not: 'ANULADO' } },
    include: { detalles: { orderBy: { id: 'asc' } } }
  });
  if (!sale || Number(sale.saldo || 0) > 0) {
    const error = new Error('La venta todavía no está completamente liquidada.');
    error.statusCode = 409;
    error.code = 'P13_LOCAL_SALE_NOT_SETTLED';
    throw error;
  }
  const cashier = session.closedByUserId
    ? await prisma.user.findFirst({
      where: { id: session.closedByUserId, tenantId },
      select: { id: true, nombre: true, email: true }
    })
    : null;
  return {
    marker: MARKER,
    session: {
      id: session.id,
      state: session.state,
      tableId: session.tableId,
      table: session.table ? { id: session.table.id, code: session.table.code, name: session.table.name } : null,
      closedAt: session.closedAt || null,
      tipAmount: moneyString(session.tipAmount),
      paymentMethodId: session.paymentMethodId || null,
      paymentMethodLabel: session.paymentMethodLabel || null,
      paymentMethodKind: session.paymentMethodKind || null,
      paymentReference: session.paymentReference || null,
      cashier: cashier ? { id: cashier.id, name: cashier.nombre, email: cashier.email } : null
    },
    sale: publicSale(sale),
    readOnly: true
  };
}

async function listRecentSettled(tenantId, limit = 15) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 15, 50));
  const sessions = await prisma.restaurantTableSession.findMany({
    where: { tenantId, state: 'CERRADA' },
    include: { table: true },
    orderBy: [{ closedAt: 'desc' }, { actualizadoEn: 'desc' }],
    take: safeLimit
  });
  const saleIds = [...new Set(sessions.map((row) => row.saleId).filter(Boolean))];
  const sales = saleIds.length ? await prisma.comprobanteComercial.findMany({
    where: { tenantId, id: { in: saleIds }, tipo: 'FACTURA_VENTA', estado: { not: 'ANULADO' } },
    select: { id: true, numero: true, total: true, saldo: true, formaPago: true, estado: true }
  }) : [];
  const byId = new Map(sales.map((row) => [row.id, row]));
  return sessions.flatMap((session) => {
    const sale = byId.get(session.saleId);
    if (!sale || Number(sale.saldo || 0) > 0) return [];
    return [{
      sessionId: session.id,
      saleId: sale.id,
      saleNumber: sale.numero,
      saleState: sale.estado,
      total: moneyString(sale.total),
      paymentForm: sale.formaPago || null,
      paymentMethodLabel: session.paymentMethodLabel || null,
      paymentMethodKind: session.paymentMethodKind || null,
      closedAt: session.closedAt || null,
      table: session.table ? { id: session.table.id, code: session.table.code, name: session.table.name } : null
    }];
  });
}

function buildCopyReceipt({ company, document, requestId }) {
  const virtualPrinter = {
    id: 'p13-local-pos-copy',
    name: 'Caja local',
    transport: 'WINDOWS',
    host: 'P13_LOCAL_PRINT_QUEUE',
    format: 'TERMICA_80'
  };
  const sale = {
    id: document.sale.id,
    numero: document.sale.number,
    estado: document.sale.state,
    fecha: document.sale.date,
    emitidoEn: document.sale.emittedAt,
    subtotal: document.sale.subtotal,
    descuentoTotal: document.sale.discount,
    ivaTotal: document.sale.iva,
    impoconsumoTotal: document.sale.impoconsumo,
    total: document.sale.total,
    saldo: document.sale.balance,
    formaPago: document.sale.paymentForm,
    terceroId: document.sale.customerId,
    detalles: document.sale.items.map((row) => ({
      id: row.id,
      productoId: row.productId,
      descripcion: row.description,
      cantidad: row.quantity,
      precioUnitario: row.unitPrice,
      subtotalLinea: row.subtotal,
      ivaValor: row.iva,
      impoconsumoValor: row.impoconsumo,
      totalLinea: row.total
    }))
  };
  const session = {
    id: document.session.id,
    closedAt: document.session.closedAt,
    tipAmount: document.session.tipAmount,
    paymentMethodLabel: document.session.paymentMethodLabel,
    paymentMethodKind: document.session.paymentMethodKind,
    paymentReference: document.session.paymentReference
  };
  const table = document.session.table;
  const job = posReceiptPrint.buildReceiptJob({ company, sale, session, table, printer: virtualPrinter });
  job.id = `p13-pos-copy:${requestId}`;
  job.payload.lines = ['*** COPIA / REIMPRESIÓN ***', ...(job.payload.lines || [])];
  job.payload.copy = true;
  job.payload.reprintRequestId = requestId;
  const buffer = buildEscPos(job.payload);
  return {
    job,
    bytes: buffer.length,
    payloadSha256: crypto.createHash('sha256').update(buffer).digest('hex')
  };
}

async function enqueueReprint({ tenantId, userId, sessionId, requestId }) {
  const normalizedRequestId = String(requestId || '').trim();
  if (!/^[a-zA-Z0-9._:-]{8,120}$/.test(normalizedRequestId)) {
    const error = new Error('requestId de reimpresión inválido.');
    error.statusCode = 400;
    error.code = 'P13_LOCAL_REPRINT_REQUEST_ID_INVALID';
    throw error;
  }
  const document = await loadSettledDocument(tenantId, sessionId);
  const company = await companyService.getCompanyProfile(tenantId);
  const rendered = buildCopyReceipt({ company, document, requestId: normalizedRequestId });
  const jobJson = JSON.stringify(rendered.job);

  const inserted = await prisma.$queryRawUnsafe(`
    INSERT INTO p13_local_receipt_reprint_queue(
      request_id, tenant_id, session_id, sale_id, sale_number, requested_by_user_id,
      job, payload_sha256, bytes, status, available_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,'PENDING',NOW(),NOW())
    ON CONFLICT (request_id) DO NOTHING
    RETURNING request_id, tenant_id, session_id, sale_id, sale_number, status, attempts, bytes, payload_sha256, created_at
  `, normalizedRequestId, tenantId, sessionId, document.sale.id, document.sale.number || null, userId || null, jobJson, rendered.payloadSha256, rendered.bytes);

  if (inserted.length) return { queued: true, duplicate: false, copy: true, job: inserted[0] };

  const existing = await prisma.$queryRawUnsafe(`
    SELECT request_id, tenant_id, session_id, sale_id, sale_number, status, attempts, bytes, payload_sha256, created_at
    FROM p13_local_receipt_reprint_queue
    WHERE request_id=$1
    LIMIT 1
  `, normalizedRequestId);
  const row = existing[0] || null;
  if (!row || row.tenant_id !== tenantId || row.session_id !== sessionId || row.sale_id !== document.sale.id || row.payload_sha256 !== rendered.payloadSha256) {
    const error = new Error('El requestId ya existe con otro contenido.');
    error.statusCode = 409;
    error.code = 'P13_LOCAL_REPRINT_IDEMPOTENCY_COLLISION';
    throw error;
  }
  return { queued: true, duplicate: true, copy: true, job: row };
}

function createLocalCashRouter(config) {
  const router = express.Router();
  router.use((req, res, next) => localCashAuth(config, req, res, next));

  router.get('/ultimos-cobros', async (req, res, next) => {
    try {
      const rows = await listRecentSettled(req.p13LocalCash.tenant.id, req.query.limit);
      res.json({ ok: true, data: { marker: MARKER, rows } });
    } catch (error) { next(error); }
  });

  router.get('/documentos/:sessionId', async (req, res, next) => {
    try {
      res.json({ ok: true, data: await loadSettledDocument(req.p13LocalCash.tenant.id, req.params.sessionId) });
    } catch (error) {
      if (error.statusCode) return apiError(res, error.statusCode, error.code || 'P13_LOCAL_CASH_ERROR', error.message);
      next(error);
    }
  });

  router.post('/documentos/:sessionId/reimprimir', async (req, res, next) => {
    try {
      const data = await enqueueReprint({
        tenantId: req.p13LocalCash.tenant.id,
        userId: req.p13LocalCash.user.id,
        sessionId: req.params.sessionId,
        requestId: req.body?.requestId
      });
      res.status(data.duplicate ? 200 : 201).json({ ok: true, data: { marker: MARKER, ...data } });
    } catch (error) {
      if (error.statusCode) return apiError(res, error.statusCode, error.code || 'P13_LOCAL_CASH_ERROR', error.message);
      next(error);
    }
  });

  return router;
}

module.exports = {
  MARKER,
  LOCAL_CASH_PERMISSION,
  listRecentSettled,
  loadSettledDocument,
  buildCopyReceipt,
  enqueueReprint,
  createLocalCashRouter
};
