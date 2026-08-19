const { z } = require('zod');

const thirdPartySchema = z.object({
  tipo: z.enum(['CLIENTE', 'PROVEEDOR', 'EMPLEADO', 'CLIENTE_PROVEEDOR', 'OTRO']).default('CLIENTE'),
  tipoDocumento: z.string().trim().min(1).max(20),
  identificacion: z.string().trim().min(3).max(40),
  nombre: z.string().trim().min(2).max(160),
  razonSocial: z.string().trim().max(200).optional().nullable(),
  direccion: z.string().trim().max(250).optional().nullable(),
  telefono: z.string().trim().max(50).optional().nullable(),
  email: z.string().trim().email().max(254).optional().nullable(),
  cupoCredito: z.coerce.number().min(0).default(0),
  diasPlazo: z.coerce.number().int().min(0).max(3650).default(0),
  responsableIva: z.boolean().default(false),
  sujetoRetefuente: z.boolean().default(false),
  sujetoReteIca: z.boolean().default(false),
  sujetoReteIva: z.boolean().default(false),
  activo: z.boolean().default(true)
});

const updateThirdPartySchema = thirdPartySchema.partial();

module.exports = { thirdPartySchema, updateThirdPartySchema };
