const { z } = require('zod');

const detailSchema = z.object({
  productoId: z.string().uuid().optional().nullable(),
  descripcion: z.string().trim().max(300).optional(),
  cantidad: z.coerce.number().positive().default(1),
  precioUnitario: z.coerce.number().min(0),
  descuentoPct: z.coerce.number().min(0).max(100).default(0),
  ivaPct: z.coerce.number().min(0).max(100).optional(),
  impoconsumoPct: z.coerce.number().min(0).max(100).optional()
});

const commercialDocumentSchema = z.object({
  tipo: z.enum(['COTIZACION', 'FACTURA_VENTA', 'COMPRA', 'RECIBO_CAJA', 'COMPROBANTE_EGRESO']),
  numero: z.string().trim().max(60).optional(),
  terceroId: z.string().uuid().optional().nullable(),
  cajaBancoId: z.string().uuid().optional().nullable(),
  formaPago: z.enum(['EFECTIVO', 'BANCO', 'CREDITO']).optional().nullable(),
  fecha: z.coerce.date().optional(),
  fechaVencimiento: z.coerce.date().optional().nullable(),
  observaciones: z.string().trim().max(1000).optional().nullable(),
  detalles: z.array(detailSchema).min(1)
});

module.exports = { commercialDocumentSchema };
