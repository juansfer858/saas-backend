const { getPucTemplate, ACCOUNTING_MAPPING_CODES } = require('../seeds/puc-templates');

async function seedTenantDefaults(tx, tenant) {
  const template = getPucTemplate(tenant.pais);
  const accountByCode = new Map();

  for (const item of template) {
    const parent = item.parent ? accountByCode.get(item.parent) : null;

    const account = await tx.cuentaPUC.create({
      data: {
        tenantId: tenant.id,
        codigo: item.codigo,
        nombre: item.nombre,
        nivel: item.nivel,
        naturaleza: item.naturaleza,
        parentId: parent?.id || null,
        permiteMovimiento: Boolean(item.permiteMovimiento)
      }
    });

    accountByCode.set(item.codigo, account);
  }

  for (const [clave, codigo] of Object.entries(ACCOUNTING_MAPPING_CODES)) {
    const account = accountByCode.get(codigo);
    if (!account) continue;

    await tx.mapeoContable.create({
      data: {
        tenantId: tenant.id,
        clave,
        cuentaId: account.id
      }
    });
  }

  const cashAccount = accountByCode.get(ACCOUNTING_MAPPING_CODES.CAJA_GENERAL);

  await tx.cajaBanco.create({
    data: {
      tenantId: tenant.id,
      tipo: 'CAJA',
      nombre: 'Caja General',
      cuentaContableId: cashAccount?.id || null,
      saldoActual: 0
    }
  });

  await tx.tercero.create({
    data: {
      tenantId: tenant.id,
      tipo: 'CLIENTE',
      tipoDocumento: 'NIT',
      identificacion: '222222222222',
      nombre: 'Cliente Mayoría / Cuantías Incompletas',
      razonSocial: 'Cliente Mayoría / Cuantías Incompletas',
      cupoCredito: 0,
      diasPlazo: 0
    }
  });
}

module.exports = { seedTenantDefaults };
