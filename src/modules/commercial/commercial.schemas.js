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
  tipo: z.enum(['COTIZACION', 'FACTURA_VENTA', 'COMPRA']),
  numero: z.string().trim().max(60).optional(),
  sourceId: z.string().trim().max(120).optional().nullable(),
  estado: z.enum(['BORRADOR', 'EMITIDO']).optional(),
  documentoOrigenId: z.string().uuid().optional().nullable(),
  terceroId: z.string().uuid().optional().nullable(),
  cajaBancoId: z.string().uuid().optional().nullable(),
  formaPago: z.enum(['EFECTIVO', 'BANCO', 'CREDITO']).optional().nullable(),
  fecha: z.coerce.date().optional(),
  fechaVencimiento: z.coerce.date().optional().nullable(),
  observaciones: z.string().trim().max(1000).optional().nullable(),
  detalles: z.array(detailSchema).min(1)
});

const updateDraftSchema = z.object({
  tipo: z.enum(['COTIZACION', 'FACTURA_VENTA', 'COMPRA']).optional(),
  terceroId: z.string().uuid().optional().nullable(),
  cajaBancoId: z.string().uuid().optional().nullable(),
  formaPago: z.enum(['EFECTIVO', 'BANCO', 'CREDITO']).optional().nullable(),
  fecha: z.coerce.date().optional(),
  fechaVencimiento: z.coerce.date().optional().nullable(),
  observaciones: z.string().trim().max(1000).optional().nullable(),
  detalles: z.array(detailSchema).min(1).optional()
}).refine((value) => Object.keys(value).length > 0, { message: 'Debe enviar al menos un cambio' });

const cancelDocumentSchema = z.object({
  motivo: z.string().trim().min(3).max(500)
});

const replaceDocumentSchema = z.object({
  motivo: z.string().trim().min(3).max(500).optional(),
  sourceId: z.string().trim().max(120).optional().nullable(),
  terceroId: z.string().uuid().optional().nullable(),
  cajaBancoId: z.string().uuid().optional().nullable(),
  formaPago: z.enum(['EFECTIVO', 'BANCO', 'CREDITO']).optional().nullable(),
  fecha: z.coerce.date().optional(),
  fechaVencimiento: z.coerce.date().optional().nullable(),
  observaciones: z.string().trim().max(1000).optional().nullable(),
  detalles: z.array(detailSchema).min(1).optional()
});

module.exports = {
  detailSchema,
  commercialDocumentSchema,
  updateDraftSchema,
  cancelDocumentSchema,
  replaceDocumentSchema
};
