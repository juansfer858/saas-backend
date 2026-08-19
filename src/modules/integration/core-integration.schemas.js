const { z } = require('zod');

const accountMappingsSchema = z.record(z.string().min(1), z.string().uuid()).optional();
const parametrizationSchema = z.object({
  mappings: accountMappingsSchema,
  cajasBancos: z.array(z.object({ cajaBancoId: z.string().uuid(), cuentaContableId: z.string().uuid() })).optional(),
  config: z.object({
    metodoCosteo: z.enum(['PROMEDIO_PONDERADO', 'PEPS']).optional(),
    exigirTerceroVentas: z.boolean().optional(),
    exigirTerceroCompras: z.boolean().optional()
  }).optional()
}).refine((x) => x.mappings || x.cajasBancos || x.config, { message: 'Debe enviar al menos una configuración' });

const supportSchema = z.object({
  nombre: z.string().trim().min(1).max(180),
  mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  base64: z.string().min(4)
});

const inventoryAdjustmentSchema = z.object({
  productoId: z.string().uuid(),
  tipo: z.enum(['FALTANTE', 'SOBRANTE', 'MERMA']),
  cantidad: z.coerce.number().positive(),
  costoUnitario: z.coerce.number().min(0).optional(),
  fecha: z.coerce.date().optional(),
  justificacion: z.string().trim().min(5).max(500),
  soporte: supportSchema.optional()
});

const transferSchema = z.object({
  origenId: z.string().uuid(),
  destinoId: z.string().uuid(),
  monto: z.coerce.number().positive(),
  fecha: z.coerce.date().optional(),
  referencia: z.string().trim().max(120).optional(),
  concepto: z.string().trim().min(3).max(300).optional()
});

const directExpenseSchema = z.object({
  cajaBancoId: z.string().uuid(),
  cuentaGastoId: z.string().uuid(),
  terceroId: z.string().uuid().optional().nullable(),
  monto: z.coerce.number().positive(),
  fecha: z.coerce.date().optional(),
  referencia: z.string().trim().max(120).optional(),
  concepto: z.string().trim().min(3).max(300)
});

const multiplePaymentSchema = z.object({
  tipo: z.enum(['CXC', 'CXP']),
  cajaBancoId: z.string().uuid(),
  metodoPago: z.enum(['EFECTIVO', 'TRANSFERENCIA', 'TARJETA']),
  fecha: z.coerce.date().optional(),
  referencia: z.string().trim().max(120).optional(),
  aplicaciones: z.array(z.object({ documentoId: z.string().uuid(), monto: z.coerce.number().positive() })).min(1).max(100)
});

const thirdPartyOperationSchema = z.object({
  cupoCredito: z.coerce.number().min(0).optional(),
  diasPlazo: z.coerce.number().int().min(0).max(3650).optional(),
  operacion: z.object({
    condicionPagoDefault: z.enum(['CONTADO', 'CREDITO_30', 'CREDITO_60', 'PERSONALIZADO']).optional(),
    vendedorAsignadoId: z.string().uuid().optional().nullable(),
    responsableRetener: z.boolean().optional()
  }).optional()
}).refine((x) => Object.keys(x).length > 0, { message: 'Debe enviar al menos un cambio' });

module.exports = {
  parametrizationSchema,
  inventoryAdjustmentSchema,
  transferSchema,
  directExpenseSchema,
  multiplePaymentSchema,
  thirdPartyOperationSchema
};
