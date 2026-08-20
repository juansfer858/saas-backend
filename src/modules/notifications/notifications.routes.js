const express = require('express');
const { z } = require('zod');
const { AppError } = require('../../utils/app-error');
const { requirePermission } = require('../../middleware/require-permission');
const service = require('./notifications.service');

const router = express.Router();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, 'Datos de notificaciones inválidos', 'VALIDATION_ERROR', result.error.flatten());
  return result.data;
}

const generalConfigSchema = z.object({
  trackingExpiryDays: z.coerce.number().int().min(30).max(90),
  fallbackHumanContact: z.string().trim().max(500).optional().nullable()
});

const signupCompleteSchema = z.object({
  code: z.string().trim().min(8).max(4096),
  wabaId: z.string().trim().min(3).max(100),
  phoneNumberId: z.string().trim().min(3).max(100)
});

const templateSchema = z.object({
  name: z.string().trim().regex(/^[a-z0-9_]{3,512}$/),
  languageCode: z.string().trim().min(2).max(20).default('es_CO'),
  category: z.enum(['UTILITY', 'MARKETING', 'AUTHENTICATION']),
  bodyText: z.string().trim().min(1).max(1024),
  variables: z.record(z.string(), z.any()).optional().nullable()
});

const eventRuleSchema = z.object({
  enabled: z.boolean(),
  templateId: z.string().uuid().optional().nullable()
});

const consentSchema = z.object({
  terceroId: z.string().uuid().optional().nullable(),
  phoneE164: z.string().trim().min(8).max(30),
  scope: z.enum(['TRANSACTIONAL', 'MARKETING', 'ALL']).default('TRANSACTIONAL'),
  source: z.string().trim().min(2).max(100),
  evidence: z.record(z.string(), z.any()).optional().nullable()
});

const eventSendSchema = z.object({
  eventCode: z.string().trim().min(2).max(100),
  recipientPhoneE164: z.string().trim().min(8).max(30),
  originType: z.string().trim().max(100).optional().nullable(),
  originId: z.string().trim().max(200).optional().nullable(),
  trackingLinkId: z.string().uuid().optional().nullable(),
  dianDocumentId: z.string().uuid().optional().nullable(),
  parameters: z.array(z.union([z.string(), z.number()])).max(20).default([]),
  appendTrackingUrl: z.boolean().optional()
});

const trackingCreateSchema = z.object({
  originType: z.string().trim().min(2).max(100),
  originId: z.string().trim().min(1).max(200),
  publicReference: z.string().trim().min(1).max(120),
  currentStatus: z.string().trim().min(1).max(120),
  note: z.string().trim().max(500).optional().nullable(),
  customerPhoneE164: z.string().trim().min(8).max(30).optional().nullable(),
  expiresAt: z.coerce.date().optional()
});

const trackingStatusSchema = z.object({
  status: z.string().trim().min(1).max(120),
  note: z.string().trim().max(500).optional().nullable(),
  completed: z.boolean().default(false)
});

router.get('/configuracion', requirePermission('CONFIGURACION.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.getPublicConfig(req.tenantId) }); }
  catch (error) { next(error); }
});

router.put('/configuracion', requirePermission('CONFIGURACION.EDITAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.saveGeneralConfig(req.tenantId, req.userId, parse(generalConfigSchema, req.body)) }); }
  catch (error) { next(error); }
});

router.get('/embedded-signup/config', requirePermission('CONFIGURACION.VER'), async (_req, res, next) => {
  try { res.json({ ok: true, data: await service.embeddedSignupPublicConfig() }); }
  catch (error) { next(error); }
});

router.post('/embedded-signup/complete', requirePermission('CONFIGURACION.EDITAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.completeEmbeddedSignup(req.tenantId, req.userId, parse(signupCompleteSchema, req.body)) }); }
  catch (error) { next(error); }
});

router.post('/disconnect', requirePermission('CONFIGURACION.EDITAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.disconnectWhatsApp(req.tenantId, req.userId) }); }
  catch (error) { next(error); }
});

router.get('/plantillas', requirePermission('CONFIGURACION.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.listTemplates(req.tenantId) }); }
  catch (error) { next(error); }
});

router.post('/plantillas', requirePermission('CONFIGURACION.EDITAR'), async (req, res, next) => {
  try { res.status(201).json({ ok: true, data: await service.createTemplate(req.tenantId, req.userId, parse(templateSchema, req.body)) }); }
  catch (error) { next(error); }
});

router.post('/plantillas/:id/enviar-aprobacion', requirePermission('CONFIGURACION.EDITAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.submitTemplate(req.tenantId, req.userId, req.params.id) }); }
  catch (error) { next(error); }
});

router.post('/plantillas/sincronizar', requirePermission('CONFIGURACION.EDITAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.syncTemplateStates(req.tenantId, req.userId) }); }
  catch (error) { next(error); }
});

router.get('/eventos', requirePermission('CONFIGURACION.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.listEventRules(req.tenantId) }); }
  catch (error) { next(error); }
});

router.put('/eventos/:eventCode', requirePermission('CONFIGURACION.EDITAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.saveEventRule(req.tenantId, req.userId, req.params.eventCode, parse(eventRuleSchema, req.body)) }); }
  catch (error) { next(error); }
});

router.post('/consentimientos', requirePermission('CONFIGURACION.EDITAR'), async (req, res, next) => {
  try { res.status(201).json({ ok: true, data: await service.grantConsent(req.tenantId, req.userId, parse(consentSchema, req.body)) }); }
  catch (error) { next(error); }
});

router.post('/consentimientos/revocar', requirePermission('CONFIGURACION.EDITAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.revokeConsent(req.tenantId, req.userId, parse(consentSchema, req.body)) }); }
  catch (error) { next(error); }
});

router.post('/disparar', requirePermission('CONFIGURACION.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.enqueueEventNotification(req.tenantId, parse(eventSendSchema, req.body)) }); }
  catch (error) { next(error); }
});

router.get('/mensajes', requirePermission('CONFIGURACION.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.listMessages(req.tenantId, req.query) }); }
  catch (error) { next(error); }
});

router.post('/cola/procesar', requirePermission('CONFIGURACION.EDITAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.processQueue(Math.min(Number(req.body?.limit) || 25, 100)) }); }
  catch (error) { next(error); }
});

router.get('/seguimiento', requirePermission('CONFIGURACION.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.listTrackingLinks(req.tenantId, req.query) }); }
  catch (error) { next(error); }
});

router.post('/seguimiento', requirePermission('CONFIGURACION.EDITAR'), async (req, res, next) => {
  try { res.status(201).json({ ok: true, data: await service.createTrackingLink(req.tenantId, req.userId, parse(trackingCreateSchema, req.body)) }); }
  catch (error) { next(error); }
});

router.put('/seguimiento/:id/estado', requirePermission('CONFIGURACION.EDITAR'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.updateTrackingStatus(req.tenantId, req.userId, req.params.id, parse(trackingStatusSchema, req.body)) }); }
  catch (error) { next(error); }
});

router.get('/auditoria', requirePermission('CONFIGURACION.VER'), async (req, res, next) => {
  try { res.json({ ok: true, data: await service.listAudits(req.tenantId, req.query) }); }
  catch (error) { next(error); }
});

module.exports = { notificationsRouter: router };
