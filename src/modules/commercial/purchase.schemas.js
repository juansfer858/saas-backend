const { z } = require('zod');

const purchaseLineSchema = z.object({
  productoId: z.string().uuid(),
  cantidad: z.coerce.number().positive(),
  costoUnitario: z.coerce.number().positive(),
  ivaPct: z.coerce.number().min(0).max(100).default(0)
});

const purchaseDraftSchema = z.object({
  proveedorId: z.string().uuid(),
  fecha: z.coerce.date(),
  referenciaExterna: z.string().trim().min(1).max(120),
  condicionPagoDias: z.coerce.number().int().min(0).max(3650).optional(),
  notas: z.string().trim().max(1000).optional().nullable(),
  detalles: z.array(purchaseLineSchema).min(1)
});

const purchaseUpdateSchema = purchaseDraftSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'Debe enviar al menos un cambio' }
);

const purchaseCancelSchema = z.object({
  motivo: z.string().trim().min(3).max(500)
});

module.exports = {
  purchaseLineSchema,
  purchaseDraftSchema,
  purchaseUpdateSchema,
  purchaseCancelSchema
};
