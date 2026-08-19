const { z } = require('zod');

const accountSchema = z.object({
  codigo: z.string().trim().min(1).max(30),
  nombre: z.string().trim().min(2).max(180),
  nivel: z.enum(['CLASE', 'GRUPO', 'CUENTA', 'SUBCUENTA', 'AUXILIAR']),
  naturaleza: z.enum(['DEBITO', 'CREDITO']),
  parentId: z.string().uuid().optional().nullable(),
  permiteMovimiento: z.boolean().default(false),
  activa: z.boolean().default(true)
});

const journalLineSchema = z.object({
  cuentaId: z.string().uuid(),
  terceroId: z.string().uuid().optional().nullable(),
  concepto: z.string().trim().max(300).optional().nullable(),
  debito: z.coerce.number().min(0).default(0),
  credito: z.coerce.number().min(0).default(0)
});

const journalSchema = z.object({
  fecha: z.coerce.date().optional(),
  concepto: z.string().trim().min(2).max(300),
  referencia: z.string().trim().max(120).optional().nullable(),
  detalles: z.array(journalLineSchema).min(2)
});

module.exports = { accountSchema, journalSchema };
