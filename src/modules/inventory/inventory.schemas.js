const { z } = require('zod');

const productSchema = z.object({
  tipo: z.enum(['PRODUCTO', 'SERVICIO']).default('PRODUCTO'),
  sku: z.string().trim().min(1).max(80),
  codigoBarras: z.string().trim().max(120).optional().nullable(),
  nombre: z.string().trim().min(2).max(180),
  descripcion: z.string().trim().max(1000).optional().nullable(),
  unidadMedida: z.string().trim().min(1).max(20).default('UND'),
  controlaInventario: z.boolean().default(true),
  costoPromedio: z.coerce.number().min(0).default(0),
  stockActual: z.coerce.number().min(0).default(0),
  precio1: z.coerce.number().min(0).default(0),
  precio2: z.coerce.number().min(0).optional().nullable(),
  precio3: z.coerce.number().min(0).optional().nullable(),
  ivaPct: z.coerce.number().min(0).max(100).default(0),
  impoconsumoPct: z.coerce.number().min(0).max(100).default(0),
  activo: z.boolean().default(true)
});

const updateProductSchema = productSchema.partial();

const movementSchema = z.object({
  productoId: z.string().uuid(),
  tipo: z.enum([
    'COMPRA',
    'VENTA',
    'AJUSTE_ENTRADA',
    'AJUSTE_SALIDA',
    'MERMA',
    'DEVOLUCION_COMPRA',
    'DEVOLUCION_VENTA'
  ]),
  cantidad: z.coerce.number().positive(),
  costoUnitario: z.coerce.number().min(0).optional(),
  referencia: z.string().trim().max(150).optional()
});

const accountedAdjustmentSchema = z.object({
  productoId: z.string().uuid(),
  tipo: z.enum(['AJUSTE_ENTRADA', 'AJUSTE_SALIDA', 'MERMA']),
  cantidad: z.coerce.number().positive(),
  costoUnitario: z.coerce.number().min(0).optional(),
  fecha: z.coerce.date().optional(),
  referencia: z.string().trim().max(150).optional(),
  justificacion: z.string().trim().min(5).max(1000),
  sourceId: z.string().trim().min(3).max(160).optional()
});

module.exports = { productSchema, updateProductSchema, movementSchema, accountedAdjustmentSchema };
