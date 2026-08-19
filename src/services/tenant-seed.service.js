const {
  getPucTemplate,
  getPucVersion,
  ACCOUNTING_MAPPING_CODES
} = require('../seeds/puc-templates');

const DEFAULT_VOUCHER_TYPES = [
  ['CI', 'Comprobante de Ingreso', true],
  ['CE', 'Comprobante de Egreso', true],
  ['CA', 'Comprobante de Ajuste', true],
  ['ND', 'Nota Débito', true],
  ['NC', 'Nota Crédito', true],
  ['NM', 'Nómina', true],
  ['AU', 'Asiento Automático', true],
  ['RV', 'Reversión Contable', true],
  ['CC', 'Cierre Contable', true],
  ['DP', 'Depreciación', true]
];

async function seedTenantDefaults(tx, tenant) {
  const template = getPucTemplate(tenant.pais);
  const versionCatalogo = getPucVersion(tenant.pais);
  const accountByCode = new Map();

  for (const item of template) {
    const parent = item.parent ? accountByCode.get(item.parent) : null;
    const common = {
      codigoReferencia: item.codigo,
      nombre: item.nombre,
      nivel: item.nivel,
      naturaleza: item.naturaleza,
      parentId: parent?.id || null,
      permiteMovimiento: Boolean(item.permiteMovimiento),
      requiereTercero: Boolean(item.requiereTercero),
      clasificacionESF: item.clasificacionESF || null,
      categoriaResultado: item.categoriaResultado || null,
      versionCatalogo,
      activa: true
    };

    const account = await tx.cuentaPUC.upsert({
      where: { tenantId_codigo: { tenantId: tenant.id, codigo: item.codigo } },
      create: { tenantId: tenant.id, codigo: item.codigo, ...common },
      update: common
    });
    accountByCode.set(item.codigo, account);
  }

  for (const [clave, codigo] of Object.entries(ACCOUNTING_MAPPING_CODES)) {
    const account = accountByCode.get(codigo);
    if (!account) continue;
    await tx.mapeoContable.upsert({
      where: { tenantId_clave: { tenantId: tenant.id, clave } },
      create: { tenantId: tenant.id, clave, cuentaId: account.id },
      update: { cuentaId: account.id }
    });
  }

  const cashAccount = accountByCode.get(ACCOUNTING_MAPPING_CODES.CAJA_GENERAL);
  await tx.cajaBanco.upsert({
    where: { tenantId_nombre: { tenantId: tenant.id, nombre: 'Caja General' } },
    create: { tenantId: tenant.id, tipo: 'CAJA', nombre: 'Caja General', cuentaContableId: cashAccount?.id || null, saldoActual: 0 },
    update: { tipo: 'CAJA', cuentaContableId: cashAccount?.id || null, activo: true }
  });

  await tx.tercero.upsert({
    where: { tenantId_identificacion: { tenantId: tenant.id, identificacion: '222222222222' } },
    create: {
      tenantId: tenant.id,
      tipo: 'CLIENTE',
      tipoDocumento: 'NIT',
      identificacion: '222222222222',
      nombre: 'Cliente Mayoría / Cuantías Incompletas',
      razonSocial: 'Cliente Mayoría / Cuantías Incompletas',
      cupoCredito: 0,
      diasPlazo: 0
    },
    update: { tipo: 'CLIENTE', nombre: 'Cliente Mayoría / Cuantías Incompletas', razonSocial: 'Cliente Mayoría / Cuantías Incompletas', activo: true }
  });

  for (const [codigo, nombre, sistema] of DEFAULT_VOUCHER_TYPES) {
    await tx.tipoComprobanteContable.upsert({
      where: { tenantId_codigo: { tenantId: tenant.id, codigo } },
      create: { tenantId: tenant.id, codigo, nombre, sistema, activo: true, consecutivoPorPeriodo: true },
      update: { nombre, sistema, activo: true }
    });
  }

  const impuestoRenta = accountByCode.get(ACCOUNTING_MAPPING_CODES.IMPUESTO_RENTA_GASTO);
  const impuestoRentaPorPagar = accountByCode.get(ACCOUNTING_MAPPING_CODES.IMPUESTO_RENTA_POR_PAGAR);
  const utilidad = accountByCode.get(ACCOUNTING_MAPPING_CODES.UTILIDAD_EJERCICIO);
  const perdida = accountByCode.get(ACCOUNTING_MAPPING_CODES.PERDIDA_EJERCICIO);

  await tx.configuracionContable.upsert({
    where: { tenantId: tenant.id },
    create: {
      tenantId: tenant.id,
      tasaImpuestoRenta: 0,
      cuentaImpuestoRentaId: impuestoRenta?.id || null,
      cuentaImpuestoRentaPorPagarId: impuestoRentaPorPagar?.id || null,
      cuentaUtilidadEjercicioId: utilidad?.id || null,
      cuentaPerdidaEjercicioId: perdida?.id || null
    },
    update: {
      cuentaImpuestoRentaId: impuestoRenta?.id || null,
      cuentaImpuestoRentaPorPagarId: impuestoRentaPorPagar?.id || null,
      cuentaUtilidadEjercicioId: utilidad?.id || null,
      cuentaPerdidaEjercicioId: perdida?.id || null
    }
  });

  const ivaGenerado = accountByCode.get(ACCOUNTING_MAPPING_CODES.IMPUESTO_VENTA);
  const ivaDescontable = accountByCode.get(ACCOUNTING_MAPPING_CODES.IMPUESTO_COMPRA);
  const ivaTemplates = [
    ['IVA19', 'IVA 19%', 19, 'GRAVADO'],
    ['IVA5', 'IVA 5%', 5, 'GRAVADO'],
    ['IVA0', 'IVA 0%', 0, 'GRAVADO'],
    ['EXENTO', 'Exento de IVA', 0, 'EXENTO'],
    ['EXCLUIDO', 'Excluido de IVA', 0, 'EXCLUIDO']
  ];
  for (const [codigo, nombre, porcentaje, categoria] of ivaTemplates) {
    await tx.tarifaIVA.upsert({
      where: { tenantId_codigo: { tenantId: tenant.id, codigo } },
      create: { tenantId: tenant.id, codigo, nombre, porcentaje, categoria, cuentaGeneradoId: ivaGenerado?.id || null, cuentaDescontableId: ivaDescontable?.id || null, activa: true },
      update: { nombre, categoria, cuentaGeneradoId: ivaGenerado?.id || null, cuentaDescontableId: ivaDescontable?.id || null }
    });
  }

  const retentionTemplates = [
    ['RTF-COMPRAS', 'Retención en la fuente - compras', 'RETEFUENTE', '236540'],
    ['RIVA', 'Retención de IVA', 'RETEIVA', '236705'],
    ['RICA', 'Retención de ICA', 'RETEICA', '236805']
  ];
  for (const [codigo, nombre, tipo, cuentaCodigo] of retentionTemplates) {
    const cuenta = accountByCode.get(cuentaCodigo);
    if (!cuenta) continue;
    await tx.conceptoRetencion.upsert({
      where: { tenantId_codigo: { tenantId: tenant.id, codigo } },
      create: {
        tenantId: tenant.id,
        codigo,
        nombre,
        tipo,
        porcentaje: 0,
        baseMinima: 0,
        cuentaId: cuenta.id,
        naturaleza: 'PAGAR',
        automatico: false,
        activo: false
      },
      update: { nombre, tipo, cuentaId: cuenta.id }
    });
  }

  return {
    versionCatalogo,
    cuentas: accountByCode.size,
    mapeos: Object.keys(ACCOUNTING_MAPPING_CODES).length,
    tiposComprobante: DEFAULT_VOUCHER_TYPES.length,
    tarifasIva: ivaTemplates.length,
    cajaGeneral: true,
    clienteGenerico: true
  };
}

module.exports = { seedTenantDefaults, DEFAULT_VOUCHER_TYPES };
