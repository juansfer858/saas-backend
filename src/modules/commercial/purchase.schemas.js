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

// V69: alta controlada de proveedores desde la propia compra. El servidor fija
// el tipo PROVEEDOR; no se expone el CRUD administrativo completo de Terceros.
const quickSupplierSchema = z.object({
  tipoDocumento: z.string().trim().min(1).max(20),
  identificacion: z.string().trim().min(3).max(40),
  nombre: z.string().trim().min(2).max(160),
  razonSocial: z.string().trim().max(200).optional().nullable(),
  direccion: z.string().trim().max(250).optional().nullable(),
  telefono: z.string().trim().max(50).optional().nullable(),
  email: z.string().trim().email().max(254).optional().nullable(),
  diasPlazo: z.coerce.number().int().min(0).max(3650).default(0),
  responsableIva: z.boolean().default(false),
  sujetoRetefuente: z.boolean().default(false),
  sujetoReteIca: z.boolean().default(false),
  sujetoReteIva: z.boolean().default(false)
});

module.exports = {
  purchaseLineSchema,
  purchaseDraftSchema,
  purchaseUpdateSchema,
  purchaseCancelSchema,
  quickSupplierSchema
};
