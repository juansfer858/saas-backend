const { prisma } = require('../../config/prisma');

let ready = null;

async function ensureRuntimeTables(client = prisma) {
  if (!ready || client !== prisma) {
    const work = async () => {
      await client.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "ConfiguracionIntegracion" (
          "tenantId" TEXT PRIMARY KEY REFERENCES "Tenant"("id") ON DELETE CASCADE,
          "metodoCosteo" TEXT NOT NULL DEFAULT 'PROMEDIO_PONDERADO',
          "exigirTerceroVentas" BOOLEAN NOT NULL DEFAULT TRUE,
          "exigirTerceroCompras" BOOLEAN NOT NULL DEFAULT TRUE,
          "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "ConfiguracionIntegracion_metodoCosteo_check"
            CHECK ("metodoCosteo" IN ('PROMEDIO_PONDERADO','PEPS'))
        )
      `);
      await client.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "TerceroOperacion" (
          "terceroId" TEXT PRIMARY KEY REFERENCES "Tercero"("id") ON DELETE CASCADE,
          "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
          "condicionPagoDefault" TEXT NOT NULL DEFAULT 'PERSONALIZADO',
          "vendedorAsignadoId" TEXT NULL REFERENCES "User"("id") ON DELETE SET NULL,
          "responsableRetener" BOOLEAN NOT NULL DEFAULT FALSE,
          "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "TerceroOperacion_condicion_check"
            CHECK ("condicionPagoDefault" IN ('CONTADO','CREDITO_30','CREDITO_60','PERSONALIZADO'))
        )
      `);
      await client.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "TerceroOperacion_tenantId_idx" ON "TerceroOperacion" ("tenantId")');
      return true;
    };
    if (client === prisma) ready = work().catch((error) => { ready = null; throw error; });
    else return work();
  }
  return ready;
}

async function getIntegrationConfig(tenantId, client = prisma) {
  await ensureRuntimeTables(client);
  await client.$executeRawUnsafe(
    `INSERT INTO "ConfiguracionIntegracion" ("tenantId") VALUES ($1) ON CONFLICT ("tenantId") DO NOTHING`,
    tenantId
  );
  const rows = await client.$queryRawUnsafe(
    `SELECT "tenantId", "metodoCosteo", "exigirTerceroVentas", "exigirTerceroCompras", "actualizadoEn"
       FROM "ConfiguracionIntegracion" WHERE "tenantId" = $1`,
    tenantId
  );
  return rows[0];
}

async function updateIntegrationConfig(tenantId, input, client = prisma) {
  await getIntegrationConfig(tenantId, client);
  const current = await getIntegrationConfig(tenantId, client);
  const metodo = input.metodoCosteo || current.metodoCosteo;
  const ventas = input.exigirTerceroVentas ?? current.exigirTerceroVentas;
  const compras = input.exigirTerceroCompras ?? current.exigirTerceroCompras;
  const rows = await client.$queryRawUnsafe(
    `UPDATE "ConfiguracionIntegracion"
       SET "metodoCosteo"=$2, "exigirTerceroVentas"=$3, "exigirTerceroCompras"=$4, "actualizadoEn"=CURRENT_TIMESTAMP
     WHERE "tenantId"=$1
     RETURNING "tenantId", "metodoCosteo", "exigirTerceroVentas", "exigirTerceroCompras", "actualizadoEn"`,
    tenantId, metodo, ventas, compras
  );
  return rows[0];
}

async function getThirdPartyOperation(tenantId, terceroId, client = prisma) {
  await ensureRuntimeTables(client);
  const rows = await client.$queryRawUnsafe(
    `SELECT "terceroId", "tenantId", "condicionPagoDefault", "vendedorAsignadoId", "responsableRetener", "actualizadoEn"
       FROM "TerceroOperacion" WHERE "tenantId"=$1 AND "terceroId"=$2`,
    tenantId, terceroId
  );
  return rows[0] || {
    terceroId,
    tenantId,
    condicionPagoDefault: 'PERSONALIZADO',
    vendedorAsignadoId: null,
    responsableRetener: false,
    actualizadoEn: null
  };
}

async function updateThirdPartyOperation(tenantId, terceroId, input, client = prisma) {
  await ensureRuntimeTables(client);
  const tercero = await client.tercero.findFirst({ where: { id: terceroId, tenantId, activo: true } });
  if (!tercero) return null;
  if (input.vendedorAsignadoId) {
    const seller = await client.user.findFirst({ where: { id: input.vendedorAsignadoId, tenantId, activo: true } });
    if (!seller) return null;
  }
  const current = await getThirdPartyOperation(tenantId, terceroId, client);
  const condition = input.condicionPagoDefault || current.condicionPagoDefault;
  const sellerId = input.vendedorAsignadoId === undefined ? current.vendedorAsignadoId : input.vendedorAsignadoId;
  const retainer = input.responsableRetener ?? current.responsableRetener;
  const rows = await client.$queryRawUnsafe(
    `INSERT INTO "TerceroOperacion" ("terceroId","tenantId","condicionPagoDefault","vendedorAsignadoId","responsableRetener","actualizadoEn")
       VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)
     ON CONFLICT ("terceroId") DO UPDATE SET
       "condicionPagoDefault"=EXCLUDED."condicionPagoDefault",
       "vendedorAsignadoId"=EXCLUDED."vendedorAsignadoId",
       "responsableRetener"=EXCLUDED."responsableRetener",
       "actualizadoEn"=CURRENT_TIMESTAMP
     RETURNING "terceroId", "tenantId", "condicionPagoDefault", "vendedorAsignadoId", "responsableRetener", "actualizadoEn"`,
    terceroId, tenantId, condition, sellerId, retainer
  );
  return rows[0];
}

module.exports = {
  ensureRuntimeTables,
  getIntegrationConfig,
  updateIntegrationConfig,
  getThirdPartyOperation,
  updateThirdPartyOperation
};
