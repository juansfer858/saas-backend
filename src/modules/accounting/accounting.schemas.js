const { z } = require('zod');

const clasificacionESF = z.enum(['ACTIVO_CORRIENTE', 'ACTIVO_NO_CORRIENTE', 'PASIVO_CORRIENTE', 'PASIVO_NO_CORRIENTE', 'PATRIMONIO', 'RESULTADO', 'ORDEN']);
const categoriaResultado = z.enum(['INGRESO_OPERACIONAL', 'COSTO_VENTAS', 'GASTO_ADMINISTRACION', 'GASTO_VENTAS', 'INGRESO_NO_OPERACIONAL', 'GASTO_NO_OPERACIONAL', 'IMPUESTO_RENTA']);

const accountSchema = z.object({
  codigo: z.string().trim().min(1).max(30),
  nombre: z.string().trim().min(2).max(180),
  nivel: z.enum(['CLASE', 'GRUPO', 'CUENTA', 'SUBCUENTA', 'AUXILIAR']),
  naturaleza: z.enum(['DEBITO', 'CREDITO']),
  parentId: z.string().uuid().optional().nullable(),
  permiteMovimiento: z.boolean().default(false),
  requiereTercero: z.boolean().default(false),
  clasificacionESF: clasificacionESF.optional().nullable(),
  categoriaResultado: categoriaResultado.optional().nullable(),
  activa: z.boolean().default(true)
});

const journalLineSchema = z.object({
  cuentaId: z.string().uuid(),
  terceroId: z.string().uuid().optional().nullable(),
  tarifaIvaId: z.string().uuid().optional().nullable(),
  conceptoRetencionId: z.string().uuid().optional().nullable(),
  concepto: z.string().trim().max(300).optional().nullable(),
  debito: z.coerce.number().min(0).default(0),
  credito: z.coerce.number().min(0).default(0)
});

const journalSchema = z.object({
  fecha: z.coerce.date().optional(),
  concepto: z.string().trim().min(2).max(300),
  tipoComprobanteId: z.string().uuid().optional().nullable(),
  referenciaExterna: z.string().trim().max(120).optional().nullable(),
  referencia: z.string().trim().max(120).optional().nullable(),
  detalles: z.array(journalLineSchema).min(2)
});

const voucherTypeSchema = z.object({
  codigo: z.string().trim().min(1).max(12),
  nombre: z.string().trim().min(2).max(120),
  consecutivoPorPeriodo: z.boolean().default(true),
  activo: z.boolean().default(true)
});
const updateVoucherTypeSchema = voucherTypeSchema.partial().refine((v) => Object.keys(v).length > 0, { message: 'Debe enviar al menos un cambio' });

const reverseSchema = z.object({ motivo: z.string().trim().min(3).max(500) });

const configSchema = z.object({
  tasaImpuestoRenta: z.coerce.number().min(0).max(100).optional(),
  cuentaImpuestoRentaId: z.string().uuid().optional().nullable(),
  cuentaImpuestoRentaPorPagarId: z.string().uuid().optional().nullable(),
  cuentaUtilidadEjercicioId: z.string().uuid().optional().nullable(),
  cuentaPerdidaEjercicioId: z.string().uuid().optional().nullable()
}).refine((v) => Object.keys(v).length > 0, { message: 'Debe enviar al menos un cambio' });

const vatSchema = z.object({
  codigo: z.string().trim().min(1).max(20),
  nombre: z.string().trim().min(2).max(120),
  porcentaje: z.coerce.number().min(0).max(100),
  categoria: z.enum(['GRAVADO', 'EXENTO', 'EXCLUIDO']),
  cuentaGeneradoId: z.string().uuid().optional().nullable(),
  cuentaDescontableId: z.string().uuid().optional().nullable(),
  activa: z.boolean().default(true)
});

const retentionSchema = z.object({
  codigo: z.string().trim().min(1).max(30),
  nombre: z.string().trim().min(2).max(160),
  tipo: z.enum(['RETEFUENTE', 'RETEICA', 'RETEIVA']),
  porcentaje: z.coerce.number().min(0).max(100),
  baseMinima: z.coerce.number().min(0).default(0),
  cuentaId: z.string().uuid(),
  naturaleza: z.enum(['PAGAR', 'COBRAR']).default('PAGAR'),
  automatico: z.boolean().default(false),
  activo: z.boolean().default(true)
});

const taxCalculationSchema = z.object({
  terceroId: z.string().uuid().optional().nullable(),
  tipoOperacion: z.enum(['COMPRA', 'VENTA']),
  base: z.coerce.number().min(0),
  tarifaIvaId: z.string().uuid().optional().nullable(),
  conceptosRetencionIds: z.array(z.string().uuid()).optional()
});

const assetSchema = z.object({
  codigo: z.string().trim().min(1).max(40),
  nombre: z.string().trim().min(2).max(180),
  terceroId: z.string().uuid().optional().nullable(),
  valorAdquisicion: z.coerce.number().positive(),
  valorResidual: z.coerce.number().min(0).default(0),
  fechaCompra: z.coerce.date(),
  fechaInicioDepreciacion: z.coerce.date().optional(),
  vidaUtilMeses: z.coerce.number().int().min(1).max(1200),
  cuentaActivoId: z.string().uuid(),
  cuentaDepAcumuladaId: z.string().uuid(),
  cuentaGastoDepreciacionId: z.string().uuid()
});

const depreciationSchema = z.object({ anio: z.coerce.number().int().min(1900).max(2200), mes: z.coerce.number().int().min(1).max(12) });

const statementEntrySchema = z.object({
  fecha: z.coerce.date(),
  descripcion: z.string().trim().min(1).max(300),
  referencia: z.string().trim().max(120).optional().nullable(),
  tipo: z.enum(['DEBITO', 'CREDITO']),
  valor: z.coerce.number().positive()
});

const reconciliationSchema = z.object({
  cajaBancoId: z.string().uuid(),
  fechaCorte: z.coerce.date(),
  saldoExtracto: z.coerce.number(),
  partidas: z.array(statementEntrySchema).max(5000).optional().default([])
});

const matchEntrySchema = z.object({ movimientoTesoreriaId: z.string().uuid().optional().nullable() });

const supportSchema = z.object({
  nombre: z.string().trim().min(1).max(180),
  mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  base64: z.string().min(4)
});

module.exports = {
  accountSchema,
  journalSchema,
  journalLineSchema,
  voucherTypeSchema,
  updateVoucherTypeSchema,
  reverseSchema,
  configSchema,
  vatSchema,
  retentionSchema,
  taxCalculationSchema,
  assetSchema,
  depreciationSchema,
  reconciliationSchema,
  matchEntrySchema,
  supportSchema
};
