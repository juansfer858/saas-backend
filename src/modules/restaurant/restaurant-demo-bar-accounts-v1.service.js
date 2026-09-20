'use strict';

const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { lockOperation } = require('./restaurant-operation-lock-v111.service');
const commercial = require('../commercial/commercial.service');
const sales = require('../commercial/sales.service');

const MARKER = 'VANTIX_DEMO_RESTAURANTE_BAR_ACCOUNTS_V1';
const DEMO_TENANT = 'demo-restaurante';
const ACCOUNT_NOTE_PREFIX = 'VANTIX_BAR_ACCOUNT:';
const ACTIVE_STATES = ['ABIERTA', 'CUENTA_PEDIDA'];

async function assertDemoTenant(tenantId) {
  const tenant = await prisma.tenant.findUnique({ where:{ id:tenantId }, select:{ subdomain:true } });
  if (String(tenant?.subdomain || '').trim().toLowerCase() !== DEMO_TENANT) {
    throw new AppError(404, 'Recurso no disponible', 'DEMO_BAR_ACCOUNT_NOT_AVAILABLE');
  }
  return tenant;
}

function cleanName(value, fallback = 'Cuenta') {
  const name = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  return name || fallback;
}

function accountNameFromSale(sale, fallback = 'Cuenta') {
  const meta = sales.unpackMeta(sale?.observaciones);
  const notes = String(meta?.notes || '');
  if (notes.startsWith(ACCOUNT_NOTE_PREFIX)) {
    return cleanName(notes.slice(ACCOUNT_NOTE_PREFIX.length), fallback);
  }
  return fallback;
}

function saleNotesForAccount(sale, name) {
  const meta = sales.unpackMeta(sale?.observaciones);
  return sales.packMeta({
    documentType: meta.documentType || 'DOCUMENTO_EQUIVALENTE_POS',
    notes: ACCOUNT_NOTE_PREFIX + cleanName(name)
  });
}

async function syncTableStateTx(tx, tenantId, tableId) {
  const rows = await tx.restaurantTableSession.findMany({
    where:{ tenantId, tableId, state:{ in:ACTIVE_STATES } },
    select:{ state:true }
  });
  const state = !rows.length
    ? 'LIBRE'
    : rows.some((row) => row.state === 'ABIERTA')
      ? 'OCUPADA'
      : 'CUENTA_PEDIDA';
  return tx.restaurantTable.update({ where:{ id:tableId }, data:{ state } });
}

async function workspace(tenantId) {
  await assertDemoTenant(tenantId);
  const [zones, tables, sessions] = await Promise.all([
    prisma.restaurantZone.findMany({
      where:{ tenantId, active:true },
      orderBy:[{ sortOrder:'asc' },{ name:'asc' }]
    }),
    prisma.restaurantTable.findMany({
      where:{ tenantId, active:true },
      orderBy:[{ code:'asc' }]
    }),
    prisma.restaurantTableSession.findMany({
      where:{ tenantId, state:{ in:ACTIVE_STATES } },
      orderBy:[{ openedAt:'asc' }]
    })
  ]);

  const saleIds = sessions.map((row) => row.saleId);
  const saleRows = saleIds.length ? await prisma.comprobanteComercial.findMany({
    where:{ tenantId, id:{ in:saleIds }, tipo:'FACTURA_VENTA' },
    select:{ id:true, numero:true, estado:true, total:true, saldo:true, observaciones:true, creadoEn:true }
  }) : [];
  const salesById = new Map(saleRows.map((row) => [row.id,row]));
  const sessionsByTable = new Map();
  for (const session of sessions) {
    if (!sessionsByTable.has(session.tableId)) sessionsByTable.set(session.tableId, []);
    sessionsByTable.get(session.tableId).push(session);
  }
  const zoneById = new Map(zones.map((row) => [row.id,row]));

  const publicTables = tables.map((table) => {
    const rows = sessionsByTable.get(table.id) || [];
    const accounts = rows.map((session, index) => {
      const sale = salesById.get(session.saleId) || null;
      return {
        id: session.id,
        sessionId: session.id,
        tableId: table.id,
        number: sale?.numero || String(index + 1),
        name: accountNameFromSale(sale, `Cuenta ${index + 1}`),
        state: session.state,
        guestCount: Number(session.guestCount || 1),
        openedAt: session.openedAt,
        accountRequestedAt: session.accountRequestedAt || null,
        sale: sale ? {
          id: sale.id,
          numero: sale.numero,
          estado: sale.estado,
          total: String(sale.total || 0),
          saldo: String(sale.saldo || 0)
        } : null
      };
    });
    return {
      id: table.id,
      code: table.code,
      name: table.name,
      state: table.state,
      zoneId: table.zoneId || null,
      zoneName: zoneById.get(table.zoneId)?.name || 'Ubicaciones',
      accounts
    };
  });

  return {
    marker: MARKER,
    tenant: DEMO_TENANT,
    zones: zones.map((row) => ({ id:row.id, name:row.name, sortOrder:row.sortOrder })),
    tables: publicTables
  };
}

async function createAccount(tenantId, user, tableId, input = {}) {
  await assertDemoTenant(tenantId);
  return prisma.$transaction(async (tx) => {
    await lockOperation(tx, tenantId);
    const table = await tx.restaurantTable.findFirst({ where:{ id:tableId, tenantId, active:true } });
    if (!table) throw new AppError(404, 'Mesa no encontrada', 'RESTAURANT_TABLE_NOT_FOUND');

    const currentCount = await tx.restaurantTableSession.count({
      where:{ tenantId, tableId, state:{ in:ACTIVE_STATES } }
    });
    const name = cleanName(input.name, `Cuenta ${currentCount + 1}`);
    const document = await commercial.createDocumentInTx(tx, tenantId, user.id, {
      tipo:'FACTURA_VENTA',
      estado:'BORRADOR',
      sourceId:`REST-DEMO-ACCOUNT-${table.id}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
      terceroId:null,
      cajaBancoId:null,
      formaPago:null,
      observaciones:sales.packMeta({
        documentType:'DOCUMENTO_EQUIVALENTE_POS',
        notes:ACCOUNT_NOTE_PREFIX + name
      }),
      detalles:[]
    });

    const session = await tx.restaurantTableSession.create({
      data:{
        tenantId,
        tableId:table.id,
        saleId:document.id,
        openedByUserId:user.id,
        billingMode:'CONJUNTA',
        guestCount:Math.max(Number(input.guestCount) || 1, 1)
      }
    });
    await syncTableStateTx(tx, tenantId, table.id);
    return {
      marker:MARKER,
      account:{
        id:session.id,
        sessionId:session.id,
        tableId:table.id,
        number:document.numero,
        name,
        state:session.state,
        guestCount:session.guestCount,
        openedAt:session.openedAt,
        sale:{ id:document.id, numero:document.numero, estado:document.estado, total:String(document.total || 0), saldo:String(document.saldo || 0) }
      }
    };
  });
}

async function renameAccount(tenantId, user, sessionId, input = {}) {
  await assertDemoTenant(tenantId);
  return prisma.$transaction(async (tx) => {
    await lockOperation(tx, tenantId);
    const session = await tx.restaurantTableSession.findFirst({
      where:{ id:sessionId, tenantId, state:{ in:ACTIVE_STATES } }
    });
    if (!session) throw new AppError(404, 'Cuenta no encontrada', 'DEMO_BAR_ACCOUNT_NOT_FOUND');
    const sale = await tx.comprobanteComercial.findFirst({
      where:{ id:session.saleId, tenantId, estado:'BORRADOR' }
    });
    if (!sale) throw new AppError(409, 'La cuenta ya no admite cambios de nombre', 'DEMO_BAR_ACCOUNT_NOT_DRAFT');
    const name = cleanName(input.name);
    await tx.comprobanteComercial.update({
      where:{ id:sale.id },
      data:{ observaciones:saleNotesForAccount(sale,name) }
    });
    await tx.auditoriaContable.create({
      data:{
        tenantId,
        userId:user.id,
        entidad:'RESTAURANT_TABLE_SESSION',
        entidadId:session.id,
        accion:'DEMO_BAR_ACCOUNT_RENAMED',
        metadata:{ marker:MARKER, name }
      }
    });
    return { marker:MARKER, id:session.id, name };
  });
}

async function requestAccount(tenantId, user, sessionId) {
  await assertDemoTenant(tenantId);
  return prisma.$transaction(async (tx) => {
    await lockOperation(tx, tenantId);
    const session = await tx.restaurantTableSession.findFirst({
      where:{ id:sessionId, tenantId, state:'ABIERTA' }
    });
    if (!session) throw new AppError(404, 'La cuenta no está abierta', 'DEMO_BAR_ACCOUNT_NOT_OPEN');
    const updated = await tx.restaurantTableSession.update({
      where:{ id:session.id },
      data:{ state:'CUENTA_PEDIDA', accountRequestedAt:new Date() }
    });
    await syncTableStateTx(tx, tenantId, session.tableId);
    await tx.auditoriaContable.create({
      data:{
        tenantId,
        userId:user.id,
        entidad:'RESTAURANT_TABLE_SESSION',
        entidadId:session.id,
        accion:'DEMO_BAR_ACCOUNT_REQUESTED',
        metadata:{ marker:MARKER, tableId:session.tableId }
      }
    });
    return { marker:MARKER, session:updated };
  });
}

async function closeEmptyAccount(tenantId, user, sessionId) {
  await assertDemoTenant(tenantId);
  return prisma.$transaction(async (tx) => {
    await lockOperation(tx, tenantId);
    const session = await tx.restaurantTableSession.findFirst({
      where:{ id:sessionId, tenantId, state:{ in:ACTIVE_STATES } },
      include:{ table:true }
    });
    if (!session) throw new AppError(404, 'Cuenta no encontrada', 'DEMO_BAR_ACCOUNT_NOT_FOUND');
    const [sale, orders, payments, fiscal] = await Promise.all([
      tx.comprobanteComercial.findFirst({ where:{ id:session.saleId, tenantId }, include:{ detalles:true } }),
      tx.restaurantOrder.findMany({ where:{ tenantId, sessionId:session.id }, include:{ items:true, commands:true } }),
      tx.restaurantSessionPayment.count({ where:{ tenantId, sessionId:session.id } }),
      tx.restaurantFiscalDocument.count({ where:{ tenantId, sessionId:session.id } })
    ]);
    if (!sale || sale.estado !== 'BORRADOR') throw new AppError(409, 'La cuenta ya tiene actividad comercial', 'DEMO_BAR_EMPTY_ACCOUNT_SALE_LOCKED');
    const hasOrderActivity = orders.some((order) => (order.items||[]).length || (order.commands||[]).length || order.state !== 'BORRADOR');
    if ((sale.detalles||[]).length || hasOrderActivity || payments || fiscal) {
      throw new AppError(409, 'La cuenta tiene consumos o actividad y no puede cerrarse como vacía', 'DEMO_BAR_EMPTY_ACCOUNT_HAS_ACTIVITY');
    }

    const draftIds = orders.filter((order) => order.state === 'BORRADOR').map((order) => order.id);
    if (draftIds.length) await tx.restaurantOrder.deleteMany({ where:{ id:{ in:draftIds }, tenantId } });
    await tx.restaurantTableSession.delete({ where:{ id:session.id } });
    await tx.comprobanteComercial.delete({ where:{ id:sale.id } });
    await syncTableStateTx(tx, tenantId, session.tableId);
    await tx.auditoriaContable.create({
      data:{
        tenantId,
        userId:user.id,
        entidad:'RESTAURANT_TABLE_SESSION',
        entidadId:session.id,
        accion:'DEMO_BAR_EMPTY_ACCOUNT_CLOSED',
        metadata:{ marker:MARKER, tableId:session.tableId, saleId:sale.id }
      }
    });
    return { marker:MARKER, closed:true, sessionId:session.id, tableId:session.tableId };
  });
}

module.exports = {
  MARKER,
  DEMO_TENANT,
  ACCOUNT_NOTE_PREFIX,
  assertDemoTenant,
  accountNameFromSale,
  saleNotesForAccount,
  syncTableStateTx,
  workspace,
  createAccount,
  renameAccount,
  requestAccount,
  closeEmptyAccount
};
