const { z } = require('zod');

const cajaBancoSchema = z.object({
  tipo: z.enum(['CAJA', 'BANCO']),
  nombre: z.string().trim().min(2).max(120),
  banco: z.string().trim().max(120).optional().nullable(),
  numeroCuenta: z.string().trim().max(80).optional().nullable(),
  cuentaContableId: z.string().uuid().optional().nullable(),
  saldoActual: z.coerce.number().default(0),
  activo: z.boolean().default(true)
});

const aperturaSchema = z.object({
  saldoInicial: z.coerce.number().min(0).default(0)
});

const cierreSchema = z.object({
  saldoFinal: z.coerce.number().min(0)
});

module.exports = { cajaBancoSchema, aperturaSchema, cierreSchema };
