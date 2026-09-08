'use strict';

const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');

const CONFIRMATION_PREFIX = 'ELIMINAR PRUEBAS';
const MARKER = 'VANTIX_RESTAURANT_TEST_DATA_RESET_V68';
const RESTAURANT_NICHES = Object.freeze(['RESTAURANTE', 'RESTAURANT']);
const SCHEMA_DRIFT_CODES = new Set(['P2021', 'P2022']);

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

function prismaErrorCode(error) {
  return String(error?.code || error?.meta?.code || '').trim().toUpperCase();
}

function isSchemaDriftError(error) {
  const code = prismaErrorCode(error);
  if (SCHEMA_DRIFT_CODES.has(code)) return true;
  const databaseCode = String(error?.meta?.database_error?.code || error?.meta?.driverAdapterError?.cause?.originalCode || '').trim();
  return databaseCode === '42P01' || databaseCode === '42703';
}

function schemaWarning(delegate, error, operation) {
  return {
    delegate,
    operation,
    code: prismaErrorCode(error) || null,
    databaseCode: String(error?.meta?.database_error?.code || error?.meta?.driverAdapterError?.cause?.originalCode || '').trim() || null
  };
}

async function assertRestaurantTenant(tenantId, client = prisma) {
  const tenant = await client.tenant.findFirst({
    where: { id: tenantId },
    select: { id: true, subdomain: true, nombreEmpresa: true, nicho: true, activo: true }
  });
  if (!tenant) throw new AppError(404, 'Empresa no encontrada', 'RESTAURANT_TEST_RESET_TENANT_NOT_FOUND');
  const niche = String(tenant.nicho || '').trim().toUpperCase();
  if (!RESTAURANT_NICHES.includes(niche)) {
    throw new AppError(
      403,
      'La limpieza de pruebas sólo está disponible para empresas del nicho Restaurante.',
      'RESTAURANT_TEST_RESET_RESTAURANT_ONLY'
    );
  }
  return tenant;
}

function confirmationFor(tenant) {
  return `${CONFIRMATION_PREFIX} ${String(tenant?.subdomain || '').trim()}`.trim().toUpperCase();
}

async function count(client, delegate, where, schemaWarnings) {
  try {
    return await client[delegate].count({ where });
  } catch (error) {
    if (isSchemaDriftError(error)) {
      schemaWarnings.push(schemaWarning(delegate, error, 'count'));
      return 0;
    }
    throw new AppError(
      503,
      `No se pudo revisar ${delegate} para preparar la limpieza de pruebas.`,
      'RESTAURANT_TEST_RESET_COUNT_FAILED',
      { delegate, prismaCode: prismaErrorCode(error) || null }
    );
  }
}

async function counts(tenantId, client = prisma) {
  assertDelegates(client);
  const schemaWarnings = [];

  // V68.1: estos conteos se hacen de forma secuencial. La pantalla anterior lanzaba
  // todas las consultas a la vez y podía saturar el pool de PostgreSQL en producción.
  // Además, un módulo auxiliar con drift P2021/P2022 ya no tumba toda la pestaña.
  const sessions = await count(client, 'restaurantTableSession', { tenantId }, schemaWarnings);
  const orders = await count(client, 'restaurantOrder', { tenantId }, schemaWarnings);
  const commands = await count(client, 'restaurantCommand', { tenantId }, schemaWarnings);
  const fiscalDocuments = await count(client, 'restaurantFiscalDocument', { tenantId }, schemaWarnings);
  const commercialDocuments = await count(client, 'comprobanteComercial', { tenantId }, schemaWarnings);
  const payments = await count(client, 'pago', { tenantId }, schemaWarnings);
  const receivables = await count(client, 'cartera', { tenantId }, schemaWarnings);
  const receivableMovements = await count(client, 'movimientoCartera', { tenantId }, schemaWarnings);
  const treasuryMovements = await count(client, 'movimientoTesoreria', { tenantId }, schemaWarnings);
  const inventoryMovements = await count(client, 'movimientoInventario', { tenantId }, schemaWarnings);
  const journals = await count(client, 'asientoContable', { tenantId }, schemaWarnings);
  const cashShifts = await count(client, 'aperturaCierreCaja', { tenantId }, schemaWarnings);
  const deliveryOrders = await count(client, 'restaurantDeliveryOrder', { tenantId }, schemaWarnings);
  const deliveryCommands = await count(client, 'restaurantDeliveryCommand', { tenantId }, schemaWarnings);
  const consumptionRuns = await count(client, 'consumptionRun', { tenantId }, schemaWarnings);
  const dianSandboxDocuments = await count(client, 'dianDocument', { tenantId, environment: 'HABILITACION' }, schemaWarnings);
  const trackingLinks = await count(client, 'trackingLink', { tenantId, originType: { startsWith: 'RESTAURANT_' } }, schemaWarnings);
  const notificationMessages = await count(client, 'notificationMessage', { tenantId }, schemaWarnings);
  const pushDeliveries = await count(client, 'notificationPushDelivery', { tenantId }, schemaWarnings);

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
    transactions: payments + receivables + receivableMovements + treasuryMovements + inventoryMovements + journals + cashShifts + consumptionRuns,
    schemaWarnings
  };
}

async function productionDianCount(tenantId) {
  try {
    return await prisma.dianDocument.count({ where: { tenantId, environment: 'PRODUCCION' } });
  } catch (error) {
    if (isSchemaDriftError(error)) return 0;
    throw new AppError(
      503,
      'No se pudo verificar el estado DIAN antes de la limpieza.',
      'RESTAURANT_TEST_RESET_DIAN_CHECK_FAILED',
      { prismaCode: prismaErrorCode(error) || null }
    );
  }
}

async function summary(tenantId) {
  assertDelegates(prisma);
  const tenant = await assertRestaurantTenant(tenantId);
  const productionDianDocuments = await productionDianCount(tenantId);
  const current = await counts(tenantId);
  return {
    marker: MARKER,
    version: '68.1.0',
    scope: 'RESTAURANT_NICHE',
    allowed: productionDianDocuments === 0,
    tenant,
    productionDianDocuments,
    confirmation: confirmationFor(tenant),
    counts: current,
    schemaWarnings: current.schemaWarnings,
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
  try {
    const result = await tx[key].deleteMany({ where });
    removed[label] = (removed[label] || 0) + Number(result?.count || 0);
  } catch (error) {
    if (!isSchemaDriftError(error)) throw error;
    if (!Array.isArray(removed.schemaWarnings)) removed.schemaWarnings = [];
    removed.schemaWarnings.push(schemaWarning(key, error, 'deleteMany'));
  }
}

async function execute(tenantId, userId, confirmation) {
  assertDelegates(prisma);
  const tenant = await assertRestaurantTenant(tenantId);
  const expected = confirmationFor(tenant);
  if (String(confirmation || '').trim().toUpperCase() !== expected) {
    throw new AppError(
      400,
      `Escribe exactamente ${expected} para confirmar.`,
      'RESTAURANT_TEST_RESET_CONFIRMATION_REQUIRED'
    );
  }

  const productionDianDocuments = await productionDianCount(tenantId);
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

  try {
    await prisma.$transaction(async (tx) => {
      assertDelegates(tx);

      const notificationRows = await tx.notificationMessage.findMany({
        where: { tenantId },
        select: { id: true }
      }).catch((error) => {
        if (!isSchemaDriftError(error)) throw error;
        if (!Array.isArray(removed.schemaWarnings)) removed.schemaWarnings = [];
        removed.schemaWarnings.push(schemaWarning('notificationMessage', error, 'findMany'));
        return [];
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
          entidad: 'RESTAURANT_TEST_DATA_RESET_V68',
          entidadId: tenantId,
          accion: 'RESET_TEST_DATA',
          metadata: {
            marker: MARKER,
            version: '68.1.0',
            scope: 'RESTAURANT_NICHE',
            subdomain: tenant.subdomain,
            before,
            removed,
            preserved: ['PRODUCTOS', 'CARTA', 'RECETAS', 'MESAS', 'ZONAS', 'USUARIOS', 'TERCEROS', 'CONFIGURACION', 'IMPRESORAS', 'DISPOSITIVOS_PUSH']
          }
        }
      });
    }, { timeout: 60_000 });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      503,
      'La limpieza no pudo completarse. No se confirmó ningún borrado parcial; la transacción fue revertida.',
      'RESTAURANT_TEST_RESET_EXECUTION_FAILED',
      { prismaCode: prismaErrorCode(error) || null }
    );
  }

  const after = await counts(tenantId);
  return {
    marker: MARKER,
    version: '68.1.0',
    ok: true,
    tenant: { id: tenant.id, subdomain: tenant.subdomain, nombreEmpresa: tenant.nombreEmpresa },
    before,
    removed,
    after,
    schemaWarnings: [
      ...(before.schemaWarnings || []),
      ...(removed.schemaWarnings || []),
      ...(after.schemaWarnings || [])
    ],
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
  CONFIRMATION_PREFIX,
  MARKER,
  RESTAURANT_NICHES,
  SCHEMA_DRIFT_CODES,
  summary,
  execute,
  counts,
  assertRestaurantTenant,
  confirmationFor,
  isSchemaDriftError
};
