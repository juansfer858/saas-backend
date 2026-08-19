const express = require('express');
const controller = require('./accounting.controller');
const taxes = require('./accounting-tax.service');
const { fiscalJournalSchema } = require('./accounting.schemas');
const { AppError } = require('../../utils/app-error');
const { partidaDobleMiddleware } = require('../../middleware/partida-doble-middleware');

const router = express.Router();

router.get('/cuentas', controller.listAccounts);
router.post('/cuentas', controller.createAccount);

router.get('/tipos-comprobante', controller.listVoucherTypes);
router.post('/tipos-comprobante', controller.createVoucherType);
router.patch('/tipos-comprobante/:id', controller.updateVoucherType);

router.get('/asientos', controller.listJournals);
router.post('/asientos', partidaDobleMiddleware, controller.createJournal);
router.post('/asientos/borrador', partidaDobleMiddleware, controller.createDraftJournal);
router.post('/asientos/fiscal', async (req, res, next) => {
  try {
    const parsed = fiscalJournalSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'Datos fiscales inválidos', 'VALIDATION_ERROR', parsed.error.flatten());
    res.status(201).json({ ok: true, data: await taxes.createFiscalJournal(req.tenantId, req.userId, parsed.data) });
  } catch (error) { next(error); }
});
router.post('/asientos/:id/contabilizar', controller.postDraftJournal);
router.post('/asientos/:id/anular', controller.reverseJournal);
router.post('/asientos/:id/soportes', controller.addSupport);
router.get('/asientos/:id/soportes/:soporteId', controller.downloadSupport);
router.get('/asientos/:id', controller.getJournal);

router.get('/mayor', controller.getLedger);
router.get('/reportes/balance-prueba', controller.getTrialBalance);
router.get('/reportes/estado-resultados', controller.getProfitAndLoss);
router.get('/reportes/balance-general', controller.getBalanceSheet);
router.get('/reportes/:tipo/exportar', controller.exportReport);

router.get('/periodos', controller.listPeriods);
router.post('/periodos/:anio/:mes/cerrar', controller.closePeriod);
router.post('/periodos/:anio/:mes/reabrir', controller.reopenPeriod);

router.get('/configuracion', controller.getConfig);
router.patch('/configuracion', controller.updateConfig);

router.get('/impuestos/iva', controller.listVatRates);
router.post('/impuestos/iva', controller.createVatRate);
router.patch('/impuestos/iva/:id', controller.updateVatRate);
router.get('/impuestos/retenciones', controller.listRetentions);
router.post('/impuestos/retenciones', controller.createRetention);
router.patch('/impuestos/retenciones/:id', controller.updateRetention);
router.post('/impuestos/calcular', controller.calculateTaxes);

router.get('/activos-fijos', controller.listAssets);
router.post('/activos-fijos', controller.createAsset);
router.post('/activos-fijos/:id/depreciar', controller.generateDepreciation);

router.get('/conciliaciones', controller.listReconciliations);
router.post('/conciliaciones', controller.createReconciliation);
router.get('/conciliaciones/:id/movimientos', controller.listReconciliationMovements);
router.patch('/conciliaciones/:id/partidas/:partidaId', controller.matchReconciliationEntry);
router.post('/conciliaciones/:id/cerrar', controller.closeReconciliation);

module.exports = { accountingRouter: router };
