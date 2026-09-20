'use strict';

const express = require('express');
const { z } = require('zod');
const { requirePermission } = require('../../middleware/require-permission');
const { AppError } = require('../../utils/app-error');
const service = require('./restaurant-print-template.service');
const documentTemplates = require('./restaurant-document-print-template.service');
const companyService = require('./restaurant-company-profile.service');
const receiptPrint = require('./restaurant-pos-receipt-print.service');
const receiptLayout = require('./restaurant-pos-receipt-layout.service');

const router = express.Router();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Configuración de plantilla inválida', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

const schema = z.object({
  itemAlign: z.enum(['LEFT', 'CENTER']).optional(),
  noteAlign: z.enum(['LEFT', 'CENTER']).optional(),
  seatAlign: z.enum(['LEFT', 'CENTER']).optional(),
  headerSize: z.enum(['NORMAL', 'DOUBLE']).optional(),
  itemSize: z.enum(['NORMAL', 'TALL', 'DOUBLE']).optional(),
  noteSize: z.enum(['NORMAL', 'TALL', 'DOUBLE']).optional(),
  showTopTime: z.boolean().optional(),
  showBottomDateTime: z.boolean().optional(),
  showTrace: z.boolean().optional(),
  showSeat: z.boolean().optional(),
  separatorStyle: z.enum(['DOUBLE', 'SINGLE', 'NONE']).optional(),
  blankLinesBetweenItems: z.coerce.number().int().min(0).max(2).optional(),
  customHeaderText: z.string().trim().max(48).optional(),
  customFooterText: z.string().trim().max(48).optional()
}).refine((value) => Object.keys(value).length > 0, { message: 'Debe enviar al menos un cambio' });

const invoiceTemplateSchema = z.object({
  title: z.string().trim().max(80).nullable().optional(),
  showCompanyName: z.boolean().optional(),
  showNit: z.boolean().optional(),
  showAddress: z.boolean().optional(),
  showCity: z.boolean().optional(),
  showPhone: z.boolean().optional(),
  showEmail: z.boolean().optional(),
  showSaleNumber: z.boolean().optional(),
  showTable: z.boolean().optional(),
  showDate: z.boolean().optional(),
  showCustomerName: z.boolean().optional(),
  showCustomerDocument: z.boolean().optional(),
  showCustomerAddress: z.boolean().optional(),
  showCustomerPhone: z.boolean().optional(),
  showCustomerEmail: z.boolean().optional(),
  showUnitPrice: z.boolean().optional(),
  showSubtotal: z.boolean().optional(),
  showDiscount: z.boolean().optional(),
  showTaxes: z.boolean().optional(),
  showTip: z.boolean().optional(),
  showPayment: z.boolean().optional(),
  showReference: z.boolean().optional(),
  thankYouText: z.string().trim().max(80).optional(),
  footerText: z.string().trim().max(96).optional()
});

const cashCloseTemplateSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  showDetailHint: z.boolean().optional(),
  showInternalNote: z.boolean().optional(),
  footerText: z.string().trim().max(96).optional()
});

const previewSchema = z.object({
  paperFormat: z.enum(['TERMICA_80', 'TERMICA_58']).optional().default('TERMICA_80'),
  template: z.record(z.string(), z.any()).optional().default({})
});

function sampleSale() {
  return {
    id:'preview-sale',
    numero:'FV-000123',
    fecha:new Date(),
    emitidoEn:new Date(),
    formaPago:'EFECTIVO',
    subtotal:38000,
    descuentoTotal:0,
    ivaTotal:0,
    impoconsumoTotal:0,
    total:38000,
    tercero:{
      razonSocial:'Cliente ejemplo',
      nombre:'Cliente ejemplo',
      tipoDocumento:'CC',
      identificacion:'123456789',
      direccion:'Calle 10 # 20-30',
      telefono:'300 000 0000',
      email:'cliente@ejemplo.com'
    },
    detalles:[
      { cantidad:2, descripcion:'Hamburguesa especial', precioUnitario:15000, totalLinea:30000 },
      { cantidad:1, descripcion:'Limonada natural', precioUnitario:8000, totalLinea:8000 }
    ]
  };
}

function sampleSession() {
  return {
    closedAt:new Date(),
    tipAmount:2000,
    paymentMethodLabel:'Efectivo',
    paymentMethodKind:'EFECTIVO',
    paymentReference:'Recibido 50.000 · Cambio 10.000'
  };
}

function sampleCloseSnapshot() {
  return {
    shift:{
      id:'preview-shift',
      cajaNombre:'Caja principal',
      cajero:'Administrador',
      saldoInicial:'50000',
      saldoEsperado:'240000',
      saldoFinal:'240000',
      descuadre:'0',
      abiertoEn:new Date(Date.now()-8*60*60*1000).toISOString(),
      cerradoEn:new Date().toISOString()
    },
    restaurantClosedTablesTotal:'190000',
    systemCashExpected:'240000',
    restaurantCashRecorded:'190000',
    paymentBreakdown:{
      cashSales:'120000',
      transferSales:'50000',
      cardSales:'20000',
      bankOtherSales:'0',
      electronicSales:'70000',
      creditSales:'0',
      exactMethodBreakdown:true
    },
    tables:[]
  };
}

router.get('/plantilla-impresion', requirePermission('RESTAURANTE.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.getPrintTemplate(req.tenantId) }); }
  catch (error) { next(error); }
});

router.put('/plantilla-impresion', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.savePrintTemplate(req.tenantId, req.userId, parse(schema, req.body || {})) }); }
  catch (error) { next(error); }
});

router.post('/plantilla-impresion/restaurar', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.resetPrintTemplate(req.tenantId, req.userId) }); }
  catch (error) { next(error); }
});

router.get('/plantillas-documentos', requirePermission('RESTAURANTE.VER'), async (req, res, next) => {
  try { res.json({ ok:true, data:await documentTemplates.getDocumentPrintTemplates(req.tenantId) }); }
  catch (error) { next(error); }
});

router.put('/plantillas-documentos/factura', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok:true, data:await documentTemplates.saveInvoiceTemplate(req.tenantId, req.userId, parse(invoiceTemplateSchema, req.body || {})) }); }
  catch (error) { next(error); }
});

router.post('/plantillas-documentos/factura/restaurar', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok:true, data:await documentTemplates.resetInvoiceTemplate(req.tenantId, req.userId) }); }
  catch (error) { next(error); }
});

router.put('/plantillas-documentos/cierre', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok:true, data:await documentTemplates.saveCashCloseTemplate(req.tenantId, req.userId, parse(cashCloseTemplateSchema, req.body || {})) }); }
  catch (error) { next(error); }
});

router.post('/plantillas-documentos/cierre/restaurar', requirePermission('RESTAURANTE.ADMINISTRAR'), async (req, res, next) => {
  try { res.json({ ok:true, data:await documentTemplates.resetCashCloseTemplate(req.tenantId, req.userId) }); }
  catch (error) { next(error); }
});

router.post('/plantillas-documentos/factura/preview', requirePermission('RESTAURANTE.VER'), async (req, res, next) => {
  try {
    const input = parse(previewSchema, req.body || {});
    const company = await companyService.getCompanyProfile(req.tenantId);
    const template = documentTemplates.normalizeInvoiceTemplate(input.template);
    const columns = receiptLayout.paperColumns(input.paperFormat);
    const lines = receiptPrint.receiptLines({
      company,
      sale:sampleSale(),
      session:sampleSession(),
      table:{ name:'Mesa 5', code:'M5' },
      paperFormat:input.paperFormat,
      template
    });
    res.json({ ok:true, data:{
      paperFormat:input.paperFormat,
      columns,
      lines,
      footer:receiptLayout.centerLine(template.thankYouText || 'Gracias por su compra', columns)
    } });
  } catch (error) { next(error); }
});

router.post('/plantillas-documentos/cierre/preview', requirePermission('RESTAURANTE.VER'), async (req, res, next) => {
  try {
    const input = parse(previewSchema, req.body || {});
    const company = await companyService.getCompanyProfile(req.tenantId);
    const template = documentTemplates.normalizeCashCloseTemplate(input.template);
    const columns = receiptPrint.cashCloseColumns(input.paperFormat);
    const lines = receiptPrint.cashCloseReceiptLines({
      company,
      snapshot:sampleCloseSnapshot(),
      paperFormat:input.paperFormat,
      template
    });
    res.json({ ok:true, data:{
      paperFormat:input.paperFormat,
      columns,
      lines,
      footer:receiptLayout.centerLine(template.footerText || 'VantixGC · Cierre de caja', columns)
    } });
  } catch (error) { next(error); }
});

module.exports = {
  restaurantPrintTemplateRouter: router,
  printTemplateSchema: schema,
  invoiceTemplateSchema,
  cashCloseTemplateSchema
};
