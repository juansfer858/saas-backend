const express = require('express');
const { z } = require('zod');
const { AppError } = require('../../utils/app-error');
const { requirePermission } = require('../../middleware/require-permission');
const techProvider = require('./meta-tech-provider.service');
const realSignup = require('./meta-real-signup.service');

const router = express.Router();

const signupSchema = z.object({
  code: z.string().trim().min(8).max(4096),
  wabaId: z.string().trim().min(3).max(100),
  phoneNumberId: z.string().trim().min(3).max(100).optional().nullable(),
  onboardingMode: z.enum(['STANDARD', 'COEXISTENCE']).default('STANDARD')
});

router.get('/meta-tech-provider/readiness', requirePermission('CONFIGURACION.VER'), async (_req, res, next) => {
  try { res.json({ ok: true, data: await techProvider.readiness() }); }
  catch (error) { next(error); }
});

router.post('/embedded-signup/complete', requirePermission('CONFIGURACION.EDITAR'), async (req, res, next) => {
  try {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'Datos de Embedded Signup inválidos', 'VALIDATION_ERROR', parsed.error.flatten());
    res.json({ ok: true, data: await realSignup.completeEmbeddedSignup(req.tenantId, req.userId, parsed.data) });
  } catch (error) { next(error); }
});

module.exports = { metaTechRouter: router };
