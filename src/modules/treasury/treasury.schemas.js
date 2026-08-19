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

const paymentSchema = z.object({
  documentoId: z.string().uuid(),
  monto: z.coerce.number().positive(),
  metodoPago: z.enum(['EFECTIVO', 'TRANSFERENCIA', 'TARJETA']),
  cajaBancoId: z.string().uuid(),
  referencia: z.string().trim().max(300).optional().nullable(),
  sourceId: z.string().trim().max(120).optional().nullable()
});

const transferSchema = z.object({
  origenCajaBancoId: z.string().uuid(),
  destinoCajaBancoId: z.string().uuid(),
  monto: z.coerce.number().positive(),
  fecha: z.coerce.date().optional(),
  concepto: z.string().trim().min(3).max(500).optional(),
  sourceId: z.string().trim().min(3).max(120).optional()
});

const directExpenseSchema = z.object({
  cajaBancoId: z.string().uuid(),
  cuentaGastoId: z.string().uuid().optional().nullable(),
  terceroId: z.string().uuid().optional().nullable(),
  monto: z.coerce.number().positive(),
  fecha: z.coerce.date().optional(),
  concepto: z.string().trim().min(3).max(500),
  sourceId: z.string().trim().min(3).max(120).optional()
});

const batchPaymentSchema = z.object({
  cajaBancoId: z.string().uuid(),
  metodoPago: z.enum(['EFECTIVO', 'TRANSFERENCIA', 'TARJETA']),
  fecha: z.coerce.date().optional(),
  referencia: z.string().trim().max(300).optional().nullable(),
  sourceId: z.string().trim().min(3).max(100).optional(),
  aplicaciones: z.array(z.object({
    documentoId: z.string().uuid(),
    monto: z.coerce.number().positive()
  })).min(1).max(100)
});

module.exports = {
  cajaBancoSchema,
  aperturaSchema,
  cierreSchema,
  paymentSchema,
  transferSchema,
  directExpenseSchema,
  batchPaymentSchema
};
