const { z } = require('zod');

const branchId = z.string().trim().min(1).max(120).optional().nullable();

const scheduleRuleSchema = z.object({
  userId: z.string().uuid(),
  branchId,
  dayOfWeek: z.coerce.number().int().min(0).max(6),
  startMinute: z.coerce.number().int().min(0).max(1439),
  endMinute: z.coerce.number().int().min(1).max(1440),
  timeZone: z.string().trim().min(1).max(80).default('America/Bogota'),
  validFrom: z.coerce.date().optional().nullable(),
  validUntil: z.coerce.date().optional().nullable(),
  active: z.boolean().optional()
}).superRefine((value, ctx) => {
  if (value.endMinute <= value.startMinute) ctx.addIssue({ code: 'custom', path: ['endMinute'], message: 'endMinute debe ser mayor que startMinute' });
  if (value.validFrom && value.validUntil && value.validUntil < value.validFrom) ctx.addIssue({ code: 'custom', path: ['validUntil'], message: 'validUntil debe ser posterior a validFrom' });
  try { new Intl.DateTimeFormat('en-US', { timeZone: value.timeZone }).format(new Date()); }
  catch { ctx.addIssue({ code: 'custom', path: ['timeZone'], message: 'Zona horaria IANA inválida' }); }
});

const scheduleBlockSchema = z.object({
  userId: z.string().uuid(),
  branchId,
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  reason: z.string().trim().max(500).optional().nullable()
}).superRefine((value, ctx) => {
  if (value.endsAt <= value.startsAt) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'endsAt debe ser posterior a startsAt' });
});

const availabilitySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  serviceCatalogId: z.string().uuid(),
  assignedUserId: z.string().uuid().optional(),
  branchId: z.string().trim().min(1).max(120).optional(),
  stepMinutes: z.coerce.number().int().min(5).max(60).default(15)
});

const appointmentSchema = z.object({
  customerThirdPartyId: z.string().uuid(),
  bikeId: z.string().uuid().optional().nullable(),
  serviceCatalogId: z.string().uuid(),
  assignedUserId: z.string().uuid(),
  branchId,
  startsAt: z.coerce.date(),
  source: z.enum(['INTERNAL', 'RIDER_PORTAL', 'WHATSAPP']).default('INTERNAL'),
  status: z.enum(['PENDING', 'CONFIRMED']).optional(),
  customerNotes: z.string().trim().max(1200).optional().nullable(),
  internalNotes: z.string().trim().max(1200).optional().nullable()
});

const rescheduleSchema = z.object({
  startsAt: z.coerce.date(),
  assignedUserId: z.string().uuid().optional(),
  serviceCatalogId: z.string().uuid().optional(),
  branchId
});

const cancelSchema = z.object({
  reason: z.string().trim().min(1).max(600),
  source: z.enum(['INTERNAL', 'RIDER_PORTAL', 'WHATSAPP']).default('INTERNAL')
});

function parse(schema, payload) {
  const result = schema.safeParse(payload);
  if (!result.success) {
    const error = new Error('Datos de agenda Bike inválidos');
    error.statusCode = 400;
    error.code = 'BIKE_AGENDA_VALIDATION_ERROR';
    error.details = result.error.flatten();
    throw error;
  }
  return result.data;
}

module.exports = {
  scheduleRuleSchema,
  scheduleBlockSchema,
  availabilitySchema,
  appointmentSchema,
  rescheduleSchema,
  cancelSchema,
  parse
};
