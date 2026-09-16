const { z } = require('zod');

const optionalText = z.string().trim().min(1).max(500).optional().nullable();

const createBikeSchema = z.object({
  customerThirdPartyId: z.string().uuid(),
  branchId: z.string().trim().min(1).max(120).optional().nullable(),
  code: z.string().trim().min(1).max(60),
  serial: z.string().trim().min(1).max(120).optional().nullable(),
  brand: z.string().trim().min(1).max(120),
  model: z.string().trim().min(1).max(120),
  bikeType: z.string().trim().min(1).max(80).optional().nullable(),
  year: z.coerce.number().int().min(1900).max(2200).optional().nullable(),
  frameSize: z.string().trim().min(1).max(40).optional().nullable(),
  color: z.string().trim().min(1).max(80).optional().nullable(),
  odometerKm: z.coerce.number().min(0).optional().nullable(),
  notes: optionalText,
  metadata: z.record(z.string(), z.any()).optional().nullable()
});

const updateBikeSchema = createBikeSchema.partial().omit({ customerThirdPartyId: true, code: true }).extend({
  customerThirdPartyId: z.string().uuid().optional(),
  code: z.string().trim().min(1).max(60).optional(),
  status: z.enum(['ACTIVE', 'IN_WORKSHOP', 'SOLD', 'INACTIVE']).optional()
});

const createServiceSchema = z.object({
  code: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(100),
  estimatedMinutes: z.coerce.number().int().min(5).max(1440),
  basePrice: z.coerce.number().min(0),
  active: z.boolean().optional(),
  metadata: z.record(z.string(), z.any()).optional().nullable()
});

const updateServiceSchema = createServiceSchema.partial();

function parse(schema, payload) {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const error = new Error('Datos Bike inválidos');
    error.statusCode = 400;
    error.code = 'BIKE_VALIDATION_ERROR';
    error.details = parsed.error.flatten();
    throw error;
  }
  return parsed.data;
}

module.exports = {
  createBikeSchema,
  updateBikeSchema,
  createServiceSchema,
  updateServiceSchema,
  parse
};
