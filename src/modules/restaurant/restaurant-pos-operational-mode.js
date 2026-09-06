'use strict';

const { prisma } = require('../../config/prisma');
const restaurantService = require('./restaurant.service');
const settlementFinalizer = require('./restaurant-settlement-finalizer.service');
const posReceipt = require('./restaurant-pos-receipt-print.service');
const dian = require('../platform/dian/dian.service');

const INSTALL_FLAG = Symbol.for('vantixgc.restaurant.operational.pos.v40');
const DIAN_FLAG = Symbol.for('vantixgc.restaurant.operational.pos.dian.v40');
const SETTLEMENT_FLAG = Symbol.for('vantixgc.restaurant.operational.pos.split.v40');

function operationalStatus(config = {}) {
  const dianEnabled = Boolean(config.dianRealEnabled);
  return {
    verticalStatus: 'OPERATIONAL_POS',
    label: 'Operación POS activa',
    printMode: config.printMode,
    productionReady: true,
    productionLabel: 'OPERACIÓN RESTAURANTE ACTIVA',
    gates: {
      physicalPrinterFieldPass: Boolean(config.physicalPrinterFieldPass),
      metaBusinessManagementReviewPass: Boolean(config.metaBusinessManagementReviewPass),
      dianRealEnabled: dianEnabled,
      fiscalGateSatisfied: true,
      fiscalIntegrationOptional: true
    },
    limitations: [],
    whatsappOrderReadyEnabled: Boolean(config.whatsappOrderReadyEnabled),
    fiscalIntegration: {
      enabled: dianEnabled,
      mode: dianEnabled ? 'DIAN' : 'OPTIONAL_DISABLED'
    },
    posOperation: {
      enabled: true,
      mode: 'POS_INTERNO',
      receipt: 'TIRILLA_POS',
      electronicInvoiceRequired: false
    }
  };
}

async function restaurantConfig(tenantId) {
  return prisma.restaurantConfig.upsert({ where: { tenantId }, create: { tenantId }, update: {} });
}

function operationalResult(result, config) {
  if (!result || typeof result !== 'object') return result;
  const dianMode = Boolean(config?.dianRealEnabled && result?.fiscalDocument?.mode === 'DIAN');
  const saleNumber = result?.sale?.numero || null;
  return {
    ...result,
    status: operationalStatus(config),
    operationMode: dianMode ? 'DIAN' : 'POS_INTERNO',
    fiscalDocument: dianMode ? result.fiscalDocument : {
      mode: 'POS',
      documentType: 'TIRILLA_POS',
      internalNumber: saleNumber,
      operational: true,
      electronic: false
    },
    posReceipt: {
      mode: 'TIRILLA_POS',
      saleNumber,
      queued: Boolean(result?.posReceipt?.queued),
      electronic: false
    }
  };
}

async function cleanupLegacySimulatedFiscal(tenantId, saleId) {
  if (!saleId) return;
  await prisma.restaurantFiscalDocument.deleteMany({
    where: { tenantId, saleId, mode: 'SIMULATED' }
  });
}

function installDianOptInGuard() {
  if (dian[DIAN_FLAG]) return;
  const original = dian.enqueueCommercialInTx.bind(dian);
  dian.enqueueCommercialInTx = async function enqueueRestaurantCommercialOnlyWhenEnabled(tx, params) {
    const sourceId = String(params?.comprobante?.sourceId || '');
    if (sourceId.startsWith('REST-TABLE-')) {
      const config = await tx.restaurantConfig.findUnique({ where: { tenantId: params.tenantId } });
      if (!config?.dianRealEnabled) return null;
    }
    return original(tx, params);
  };
  Object.defineProperty(dian, DIAN_FLAG, { value: true });
}

function installSplitReceiptHook() {
  if (settlementFinalizer[SETTLEMENT_FLAG]) return;
  const original = settlementFinalizer.registerPartPaymentFinalized.bind(settlementFinalizer);
  settlementFinalizer.registerPartPaymentFinalized = async function registerPartPaymentWithReceipt(tenantId, user, tableId, input) {
    const result = await original(tenantId, user, tableId, input);
    await posReceipt.queueReceiptForTableIfClosed(tenantId, tableId).catch(() => {});
    return result;
  };
  Object.defineProperty(settlementFinalizer, SETTLEMENT_FLAG, { value: true });
}

function installOperationalPosMode() {
  if (restaurantService[INSTALL_FLAG]) return restaurantService;

  installDianOptInGuard();
  installSplitReceiptHook();

  const originalGetStatus = restaurantService.getStatus.bind(restaurantService);
  const originalSaveOperationalConfig = restaurantService.saveOperationalConfig.bind(restaurantService);
  const originalUpdateProductionGates = restaurantService.updateProductionGates.bind(restaurantService);
  const originalCloseTable = restaurantService.closeTable.bind(restaurantService);

  restaurantService.getStatus = async function getOperationalRestaurantStatus(tenantId) {
    await originalGetStatus(tenantId);
    return operationalStatus(await restaurantConfig(tenantId));
  };

  restaurantService.saveOperationalConfig = async function saveOperationalRestaurantConfig(tenantId, input) {
    await originalSaveOperationalConfig(tenantId, input);
    return operationalStatus(await restaurantConfig(tenantId));
  };

  restaurantService.updateProductionGates = async function updateOptionalIntegrationGates(tenantId, userId, input) {
    await originalUpdateProductionGates(tenantId, userId, input);
    return operationalStatus(await restaurantConfig(tenantId));
  };

  restaurantService.closeTable = async function closeTableAsRealPos(tenantId, user, tableId, input) {
    let config = await restaurantConfig(tenantId);
    if (!config.dianRealEnabled && config.allowSimulatedDocumentEquivalent === false) {
      config = await prisma.restaurantConfig.update({
        where: { tenantId },
        data: { allowSimulatedDocumentEquivalent: true }
      });
    }

    const result = await originalCloseTable(tenantId, user, tableId, input);

    if (!config.dianRealEnabled) {
      await cleanupLegacySimulatedFiscal(tenantId, result?.sale?.id);
    }

    const receipt = await posReceipt.queueReceiptIntent(tenantId, result?.session?.id).catch(() => ({ queued: false }));
    return operationalResult({ ...result, posReceipt: receipt }, config);
  };

  restaurantService.productionStatus = operationalStatus;
  restaurantService.SIMULATED_STATUS = 'Operación POS activa';
  restaurantService.PRODUCTION_BLOCKED = 'OPERACIÓN RESTAURANTE ACTIVA';
  Object.defineProperty(restaurantService, INSTALL_FLAG, { value: true });
  return restaurantService;
}

installOperationalPosMode();

module.exports = {
  INSTALL_FLAG,
  DIAN_FLAG,
  SETTLEMENT_FLAG,
  operationalStatus,
  operationalResult,
  cleanupLegacySimulatedFiscal,
  installDianOptInGuard,
  installSplitReceiptHook,
  installOperationalPosMode
};
