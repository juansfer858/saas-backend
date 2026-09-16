const { z } = require('zod');

const createWorkOrderSchema = z.object({
  bikeId: z.string().uuid(),
  branchId: z.string().trim().min(1).max(120).optional().nullable(),
  assignedUserId: z.string().uuid().optional().nullable(),
  customerRequest: z.string().trim().max(1200).optional().nullable(),
  intakeNotes: z.string().trim().max(2000).optional().nullable(),
  estimatedReadyAt: z.coerce.date().optional().nullable()
});

const findingSchema = z.object({
  system: z.string().trim().min(1).max(120),
  condition: z.string().trim().min(1).max(160),
  severity: z.enum(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('INFO'),
  finding: z.string().trim().min(1).max(1500),
  recommendation: z.string().trim().max(1500).optional().nullable(),
  visibleToRider: z.boolean().default(true)
});

const workOrderItemSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('SERVICE'),
    serviceCatalogId: z.string().uuid(),
    quantity: z.coerce.number().positive().default(1),
    unitPrice: z.coerce.number().min(0).optional()
  }),
  z.object({
    type: z.literal('PART'),
    productId: z.string().uuid(),
    quantity: z.coerce.number().positive().default(1),
    unitPrice: z.coerce.number().min(0).optional(),
    description: z.string().trim().max(300).optional()
  })
]);

const authorizeItemSchema = z.object({
  authorizedBy: z.string().trim().min(1).max(120).default('INTERNAL')
});

const rejectItemSchema = z.object({
  reason: z.string().trim().min(1).max(600)
});

const finalTestSchema = z.object({
  checklist: z.record(z.string(), z.any()),
  approved: z.boolean(),
  notes: z.string().trim().max(1200).optional().nullable()
});

const billingDraftSchema = z.object({
  formaPago: z.enum(['EFECTIVO', 'BANCO', 'CREDITO']),
  cajaBancoId: z.string().uuid().optional().nullable(),
  documentType: z.enum(['FACTURA_ELECTRONICA', 'DOCUMENTO_EQUIVALENTE_POS']).default('DOCUMENTO_EQUIVALENTE_POS'),
  notas: z.string().trim().max(1000).optional().nullable()
}).superRefine((value, ctx) => {
  if (value.formaPago !== 'CREDITO' && !value.cajaBancoId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['cajaBancoId'],
      message: 'La venta de contado requiere caja o banco'
    });
  }
});

const cancelSchema = z.object({
  reason: z.string().trim().min(1).max(800)
});

function parse(schema, payload) {
  const result = schema.safeParse(payload);
  if (!result.success) {
    const error = new Error('Datos de taller Bike inválidos');
    error.statusCode = 400;
    error.code = 'BIKE_WORKSHOP_VALIDATION_ERROR';
    error.details = result.error.flatten();
    throw error;
  }
  return result.data;
}

module.exports = {
  createWorkOrderSchema,
  findingSchema,
  workOrderItemSchema,
  authorizeItemSchema,
  rejectItemSchema,
  finalTestSchema,
  billingDraftSchema,
  cancelSchema,
  parse
};
