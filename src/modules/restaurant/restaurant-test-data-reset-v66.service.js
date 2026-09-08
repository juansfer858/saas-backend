'use strict';

const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');

const DEMO_SUBDOMAIN = 'demo-restaurante';
const CONFIRMATION = 'ELIMINAR PRUEBAS';
const MARKER = 'VANTIX_RESTAURANT_TEST_DATA_RESET_V66';

const REQUIRED_DELEGATES = Object.freeze([
  'tenant',
  'restaurantTable',
  'restaurantTableSession',
  'restaurantOrder',
  'restaurantOrderItem',
  'restaurantCommand',
  'restaurantFiscalDocument',
  'restaurantQrVisitDevice',
  'restaurantSessionPayment',
  'restaurantDeliveryOrder',
  'restaurantDeliveryItem',
  'restaurantDeliveryCommand',
  'consumptionRun',
  'consumptionRunItem',
  'pago',
  'cartera',
  'movimientoCartera',
  'movimientoTesoreria',
  'movimientoInventario',
  'comprobanteComercial',
  'detalleComprobante',
  'aperturaCierreCaja',
  'cajaBanco',
  'asientoContable',
  'detalleAsiento',
  'soporteAsiento',
  'auditoriaContable',
  'periodoContable',
  'consecutivoContable',
  'depreciacionActivo',
  'conciliacionBancaria',
  'partidaExtractoBancario',
  'dianDocument',
  'notificationMessage',
  'notificationDeliveryAttempt',
  'trackingLink',
  'notificationPushDelivery'
]);

function assertDelegates(client) {
  const missing = REQUIRED_DELEGATES.filter((name) => !client?.[name]);
  if (missing.length) {
    throw new AppError(
      503,
      'La limpieza de pruebas no puede ejecutarse porque el esquema transaccional no está completo.',
      'RESTAURANT_TEST_RESET_SCHEMA_INCOMPLETE',
      { missing }
    );
  }
}

async function assertDemoTenant(tenantId, client = prisma) {
  const tenant = await client.tenant.findFirst({
    where: { id: tenantId },
    select: { id: true, subdomain: true, nombreEmpresa: true, nicho: true, activo: true }
  });
  if (!tenant) throw new AppError(404, 'Empresa no encontrada', 'RESTAURANT_TEST_RESET_TENANT_NOT_FOUND');
  if (String(tenant.subdomain || '').toLowerCase() !== DEMO_SUBDOMAIN) {
    throw new AppError(
      403,
      'La limpieza destructiva de pruebas está habilitada únicamente para demo-restaurante.',
      'RESTAURANT_TEST_RESET_DEMO_ONLY'
    );
  }
  return tenant;
}

async function count(client, delegate, where) {
  return client[delegate].count({ where });
}

async function counts(tenantId, client = prisma) {
  assertDelegates(client);
  const [
    sessions,
    orders,
    commands,
    fiscalDocuments,
    commercialDocuments,
    payments,
    receivables,
    receivableMovements,
    treasuryMovements,
    inventoryMovements,
    journals,
    cashShifts,
    deliveryOrders,
    deliveryCommands,
    consumptionRuns,
    dianSandboxDocuments,
    trackingLinks,
    notificationMessages,
    pushDeliveries
  ] = await Promise.all([
    count(client, 'restaurantTableSession', { tenantId }),
    count(client, 'restaurantOrder', { tenantId }),
    count(client, 'restaurantCommand', { tenantId }),
    count(client, 'restaurantFiscalDocument', { tenantId }),
    count(client, 'comprobanteComercial', { tenantId }),
    count(client, 'pago', { tenantId }),
    count(client, 'cartera', { tenantId }),
    count(client, 'movimientoCartera', { tenantId }),
    count(client, 'movimientoTesoreria', { tenantId }),
    count(client, 'movimientoInventario', { tenantId }),
    count(client, 'asientoContable', { tenantId }),
    count(client, 'aperturaCierreCaja', { tenantId }),
    count(client, 'restaurantDeliveryOrder', { tenantId }),
    count(client, 'restaurantDeliveryCommand', { tenantId }),
    count(client, 'consumptionRun', { tenantId }),
    count(client, 'dianDocument', { tenantId, environment: 'HABILITACION' }),
    count(client, 'trackingLink', { tenantId, originType: { startsWith: 'RESTAURANT_' } }),
    count(client, 'notificationMessage', { tenantId }),
    count(client, 'notificationPushDelivery', { tenantId })
  ]);

  return {
    sessions,
    orders,
    commands: commands + deliveryCommands,
    restaurantCommands: commands,
    deliveryCommands,
    fiscalDocuments,
    commercialDocuments,
    documents: fiscalDocuments + commercialDocuments + dianSandboxDocuments,
    payments,
    receivables,
    receivableMovements,
    treasuryMovements,
    inventoryMovements,
    journals,
    cashShifts,
    deliveryOrders,
    consumptionRuns,
    dianSandboxDocuments,
    trackingLinks,
    notificationMessages,
    pushDeliveries,
    transactions: payments + receivables + receivableMovements + treasuryMovements + inventoryMovements + journals + cashShifts + consumptionRuns
  };
}

async function summary(tenantId) {
  assertDelegates(prisma);
  const tenant = await assertDemoTenant(tenantId);
  const productionDianDocuments = await prisma.dianDocument.count({ where: { tenantId, environment: 'PRODUCCION' } });
  const current = await counts(tenantId);
  return {
    marker: MARKER,
    version: '66.0.0',
    allowed: productionDianDocuments === 0,
    tenant,
    productionDianDocuments,
    confirmation: CONFIRMATION,
    counts: current,
    preserved: {
      products: true,
      menu: true,
      recipes: true,
      tables: true,
      zones: true,
      users: true,
      thirdParties: true,
      restaurantConfig: true,
      printers: true,
      notificationConfig: true,
      pushDevices: true,
      dianConfig: true
    },
    operationalReset: {
      tablesBecomeFree: true,
      cashAndBankBalancesBecomeZero: true,
      posNumberingRestartsFromExistingDocuments: true,
      productsAreNotUpdated: true
    }
  };
}

async function removeMany(tx, removed, key, where, label = key) {
  const result = await tx[key].deleteMany({ where });
  removed[label] = (removed[label] || 0) + Number(result?.count || 0);
}

async function execute(tenantId, userId, confirmation) {
  if (String(confirmation || '').trim().toUpperCase() !== CONFIRMATION) {
    throw new AppError(400, `Escribe exactamente ${CONFIRMATION} para confirmar.`, 'RESTAURANT_TEST_RESET_CONFIRMATION_REQUIRED');
  }

  assertDelegates(prisma);
  const tenant = await assertDemoTenant(tenantId);
  const productionDianDocuments = await prisma.dianDocument.count({ where: { tenantId, environment: 'PRODUCCION' } });
  if (productionDianDocuments > 0) {
    throw new AppError(
      409,
      'La limpieza fue bloqueada porque existen documentos DIAN de PRODUCCIÓN. No se borró nada.',
      'RESTAURANT_TEST_RESET_REAL_DIAN_BLOCK',
      { productionDianDocuments }
    );
  }

  const before = await counts(tenantId);
  const removed = {};

  await prisma.$transaction(async (tx) => {
    assertDelegates(tx);

    const notificationRows = await tx.notificationMessage.findMany({
      where: { tenantId },
      select: { id: true }
    });
    const notificationIds = notificationRows.map((row) => row.id);
    if (notificationIds.length) {
      await removeMany(tx, removed, 'notificationDeliveryAttempt', { notificationMessageId: { in: notificationIds } });
    }
    await removeMany(tx, removed, 'notificationMessage', { tenantId });
    await removeMany(tx, removed, 'notificationPushDelivery', { tenantId });
    await removeMany(tx, removed, 'trackingLink', { tenantId, originType: { startsWith: 'RESTAURANT_' } });

    await removeMany(tx, removed, 'dianDocument', { tenantId, environment: 'HABILITACION' }, 'dianSandboxDocuments');

    await removeMany(tx, removed, 'restaurantDeliveryCommand', { tenantId });
    await removeMany(tx, removed, 'restaurantDeliveryItem', { tenantId });
    await removeMany(tx, removed, 'restaurantDeliveryOrder', { tenantId });

    await removeMany(tx, removed, 'restaurantFiscalDocument', { tenantId });
    await removeMany(tx, removed, 'restaurantSessionPayment', { tenantId });
    await removeMany(tx, removed, 'restaurantQrVisitDevice', { tenantId });
    await removeMany(tx, removed, 'restaurantCommand', { tenantId });
    await removeMany(tx, removed, 'restaurantOrderItem', { tenantId });
    await removeMany(tx, removed, 'restaurantOrder', { tenantId });
    await removeMany(tx, removed, 'restaurantTableSession', { tenantId });

    await removeMany(tx, removed, 'consumptionRunItem', { tenantId });
    await removeMany(tx, removed, 'consumptionRun', { tenantId });

    await removeMany(tx, removed, 'partidaExtractoBancario', { tenantId });
    await removeMany(tx, removed, 'conciliacionBancaria', { tenantId });
    await removeMany(tx, removed, 'depreciacionActivo', { tenantId });
    await removeMany(tx, removed, 'soporteAsiento', { tenantId });
    await removeMany(tx, removed, 'detalleAsiento', { tenantId });
    await tx.periodoContable.updateMany({ where: { tenantId }, data: { asientoCierreId: null } });
    await tx.asientoContable.updateMany({ where: { tenantId }, data: { reversoDeId: null } });
    await removeMany(tx, removed, 'asientoContable', { tenantId });
    await removeMany(tx, removed, 'periodoContable', { tenantId });
    await removeMany(tx, removed, 'consecutivoContable', { tenantId });
    await removeMany(tx, removed, 'auditoriaContable', { tenantId });

    await removeMany(tx, removed, 'pago', { tenantId });
    await removeMany(tx, removed, 'movimientoCartera', { tenantId });
    await removeMany(tx, removed, 'cartera', { tenantId });
    await removeMany(tx, removed, 'movimientoInventario', { tenantId });
    await removeMany(tx, removed, 'movimientoTesoreria', { tenantId });

    await tx.comprobanteComercial.updateMany({ where: { tenantId }, data: { documentoOrigenId: null } });
    await removeMany(tx, removed, 'detalleComprobante', { tenantId });
    await removeMany(tx, removed, 'comprobanteComercial', { tenantId });
    await removeMany(tx, removed, 'aperturaCierreCaja', { tenantId });

    await tx.restaurantTable.updateMany({ where: { tenantId }, data: { state: 'LIBRE' } });
    await tx.cajaBanco.updateMany({ where: { tenantId }, data: { saldoActual: 0 } });

    await tx.auditoriaContable.create({
      data: {
        tenantId,
        userId,
        entidad: 'RESTAURANT_TEST_DATA_RESET_V66',
        entidadId: tenantId,
        accion: 'RESET_TEST_DATA',
        metadata: {
          marker: MARKER,
          subdomain: tenant.subdomain,
          before,
          removed,
          preserved: ['PRODUCTOS', 'CARTA', 'RECETAS', 'MESAS', 'ZONAS', 'USUARIOS', 'TERCEROS', 'CONFIGURACION', 'IMPRESORAS', 'DISPOSITIVOS_PUSH']
        }
      }
    });
  }, { timeout: 60_000 });

  const after = await counts(tenantId);
  return {
    marker: MARKER,
    ok: true,
    tenant: { id: tenant.id, subdomain: tenant.subdomain, nombreEmpresa: tenant.nombreEmpresa },
    before,
    removed,
    after,
    preserved: {
      products: true,
      menu: true,
      recipes: true,
      tables: true,
      zones: true,
      users: true,
      thirdParties: true,
      configuration: true,
      printers: true,
      pushDevices: true
    }
  };
}

module.exports = {
  DEMO_SUBDOMAIN,
  CONFIRMATION,
  MARKER,
  summary,
  execute,
  assertDemoTenant
};
