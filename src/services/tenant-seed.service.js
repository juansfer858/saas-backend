const {
  getPucTemplate,
  getPucVersion,
  ACCOUNTING_MAPPING_CODES
} = require('../seeds/puc-templates');

/**
 * Inicializa un tenant nuevo con los datos universales mínimos del ERP.
 *
 * La rutina es idempotente: puede ejecutarse de nuevo para reparar/completar
 * el seed sin duplicar cuentas, mapeos, caja o cliente genérico.
 */
async function seedTenantDefaults(tx, tenant) {
  const template = getPucTemplate(tenant.pais);
  const versionCatalogo = getPucVersion(tenant.pais);
  const accountByCode = new Map();

  for (const item of template) {
    const parent = item.parent ? accountByCode.get(item.parent) : null;

    const account = await tx.cuentaPUC.upsert({
      where: {
        tenantId_codigo: {
          tenantId: tenant.id,
          codigo: item.codigo
        }
      },
      create: {
        tenantId: tenant.id,
        codigo: item.codigo,
        codigoReferencia: item.codigo,
        nombre: item.nombre,
        nivel: item.nivel,
        naturaleza: item.naturaleza,
        parentId: parent?.id || null,
        permiteMovimiento: Boolean(item.permiteMovimiento),
        requiereTercero: Boolean(item.requiereTercero),
        versionCatalogo
      },
      update: {
        codigoReferencia: item.codigo,
        nombre: item.nombre,
        nivel: item.nivel,
        naturaleza: item.naturaleza,
        parentId: parent?.id || null,
        permiteMovimiento: Boolean(item.permiteMovimiento),
        requiereTercero: Boolean(item.requiereTercero),
        versionCatalogo,
        activa: true
      }
    });

    accountByCode.set(item.codigo, account);
  }

  for (const [clave, codigo] of Object.entries(ACCOUNTING_MAPPING_CODES)) {
    const account = accountByCode.get(codigo);
    if (!account) continue;

    await tx.mapeoContable.upsert({
      where: {
        tenantId_clave: {
          tenantId: tenant.id,
          clave
        }
      },
      create: {
        tenantId: tenant.id,
        clave,
        cuentaId: account.id
      },
      update: {
        cuentaId: account.id
      }
    });
  }

  const cashAccount = accountByCode.get(ACCOUNTING_MAPPING_CODES.CAJA_GENERAL);

  await tx.cajaBanco.upsert({
    where: {
      tenantId_nombre: {
        tenantId: tenant.id,
        nombre: 'Caja General'
      }
    },
    create: {
      tenantId: tenant.id,
      tipo: 'CAJA',
      nombre: 'Caja General',
      cuentaContableId: cashAccount?.id || null,
      saldoActual: 0
    },
    update: {
      tipo: 'CAJA',
      cuentaContableId: cashAccount?.id || null,
      activo: true
    }
  });

  await tx.tercero.upsert({
    where: {
      tenantId_identificacion: {
        tenantId: tenant.id,
        identificacion: '222222222222'
      }
    },
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
    update: {
      tipo: 'CLIENTE',
      nombre: 'Cliente Mayoría / Cuantías Incompletas',
      razonSocial: 'Cliente Mayoría / Cuantías Incompletas',
      activo: true
    }
  });

  return {
    versionCatalogo,
    cuentas: accountByCode.size,
    mapeos: Object.keys(ACCOUNTING_MAPPING_CODES).length,
    cajaGeneral: true,
    clienteGenerico: true
  };
}

module.exports = { seedTenantDefaults };
