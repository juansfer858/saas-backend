const assert = require('node:assert/strict');
const { prisma } = require('../src/config/prisma');
const { seedTenantDefaults } = require('../src/services/tenant-seed.service');
const { seedPlatformDefaults } = require('../src/services/platform-seed.service');
const salesFiscal = require('../src/modules/commercial/sales-fiscal.service');
const dian = require('../src/modules/platform/dian/dian.service');
const payroll = require('../src/modules/platform/payroll/payroll.service');
const rbac = require('../src/modules/platform/rbac/rbac.service');
const printing = require('../src/modules/platform/printing/printing.service');
const platform = require('../src/modules/platform/saas/platform.service');
const { signAccessToken } = require('../src/utils/jwt');
const { extractTenantBySubdomain } = require('../src/middleware/extract-tenant-by-subdomain');

function n(v) { return Number(v || 0); }
function balanced(journal) { return Math.abs(n(journal.totalDebito) - n(journal.totalCredito)) < 0.005; }

async function createTenant(stamp, suffix) {
  const tenant = await prisma.tenant.create({ data: { nombreEmpresa: `Platform ${suffix} ${stamp}`, subdomain: `platform-${suffix}-${stamp}`, nicho: 'QA', pais: 'CO', moneda: 'COP' } });
  const user = await prisma.user.create({ data: { tenantId: tenant.id, nombre: `Admin ${suffix}`, email: `admin-${suffix}-${stamp}@example.com`, password: 'not-login', rol: 'ADMIN' } });
  await prisma.$transaction(async (tx) => {
    await seedTenantDefaults(tx, tenant);
    await seedPlatformDefaults(tx, tenant, user);
  });
  return { tenant, user };
}

async function middlewareErrorForTenant(subdomain) {
  return new Promise((resolve) => {
    const req = { headers: { host: 'core.example.com', 'x-tenant-subdomain': subdomain } };
    extractTenantBySubdomain(req, {}, (error) => resolve(error || null));
  });
}

async function main() {
  const stamp = Date.now();
  const { tenant, user } = await createTenant(stamp, 'a');
  const other = await createTenant(stamp, 'b');

  // DIAN shared config and numbering: one configuration drives invoice + payroll.
  await dian.saveConfig(tenant.id, user.id, {
    providerCode: 'MOCK_PT', providerName: 'PT habilitación QA', environment: 'HABILITACION',
    invoiceEnabled: true, payrollEnabled: true, contingencyEnabled: true,
    credentials: { apiKey: 'qa-only-not-production' },
    certificateAlias: 'CERT-QA', habilitacionChecklist: { software: true, numeracion: true }
  });
  const publicConfig = await dian.getPublicConfig(tenant.id);
  assert.equal(publicConfig.credentialsConfigured, true);
  assert.equal(Object.prototype.hasOwnProperty.call(publicConfig, 'credentialCiphertext'), false);
  assert.equal(publicConfig.invoiceEnabled, true);
  assert.equal(publicConfig.payrollEnabled, true);

  for (const [documentType, prefix, from, to] of [
    ['DOCUMENTO_EQUIVALENTE_POS', 'POSQA', 1, 999],
    ['FACTURA_ELECTRONICA', 'FVQA', 1, 999],
    ['DOCUMENTO_SOPORTE', 'DSQA', 1, 999],
    ['NOMINA_ELECTRONICA', 'NEQA', 1, 999]
  ]) {
    await dian.saveNumberingRange(tenant.id, { documentType, prefix, rangeFrom: from, rangeTo: to, nextNumber: from, authorizationNumber: `AUTH-${documentType}-${stamp}`, active: true });
  }

  const customer = await prisma.tercero.create({ data: { tenantId: tenant.id, tipo: 'CLIENTE', tipoDocumento: 'NIT', identificacion: `CLI-${stamp}`, nombre: 'Cliente Fiscal QA', razonSocial: 'Cliente Fiscal QA SAS' } });
  const service = await prisma.producto.create({ data: { tenantId: tenant.id, tipo: 'SERVICIO', sku: `SERV-${stamp}`, nombre: 'Servicio Fiscal QA', unidadMedida: 'UND', controlaInventario: false, precio1: 100000, ivaPct: 19, activo: true } });

  // Sale issued + accounting + DIAN outbox are created by one business transaction.
  const sale = await salesFiscal.createSale(tenant.id, user.id, {
    estado: 'EMITIDO', terceroId: customer.id, formaPago: 'CREDITO', documentType: 'DOCUMENTO_EQUIVALENTE_POS',
    sourceId: `PLATFORM-SALE-${stamp}`, detalles: [{ productoId: service.id, cantidad: 1, precioUnitario: 100000, ivaPct: 19 }]
  });
  assert.equal(sale.estado, 'EMITIDO');
  assert.ok(sale.asiento && balanced(sale.asiento));
  assert.equal(sale.asiento.tipoComprobante?.codigo, 'AU');
  assert.ok(sale.dianDocument);
  assert.equal(sale.dianDocument.state, 'PENDIENTE_ENVIO');
  assert.equal(sale.dianDocument.documentType, 'DOCUMENTO_EQUIVALENTE_POS');
  assert.match(sale.dianDocument.fiscalNumber, /^POSQA/);

  const accepted = await dian.processDocument(sale.dianDocument.id);
  assert.equal(accepted.state, 'ACEPTADO');
  assert.equal(accepted.uniqueCodeType, 'CUFE_TEST');
  assert.equal(accepted.attempts[0].result, 'EXITO');

  // External PT outage does not reverse the already-issued business operation.
  await dian.saveConfig(tenant.id, user.id, {
    providerCode: 'MOCK_PT_DOWN', providerName: 'PT caída simulada', environment: 'HABILITACION',
    invoiceEnabled: true, payrollEnabled: true, contingencyEnabled: true,
    certificateAlias: 'CERT-QA'
  });
  const outageSale = await salesFiscal.createSale(tenant.id, user.id, {
    estado: 'EMITIDO', terceroId: customer.id, formaPago: 'CREDITO', documentType: 'DOCUMENTO_EQUIVALENTE_POS',
    sourceId: `PLATFORM-OUTAGE-${stamp}`, detalles: [{ productoId: service.id, cantidad: 1, precioUnitario: 50000, ivaPct: 0 }]
  });
  const contingency = await dian.processDocument(outageSale.dianDocument.id);
  assert.equal(contingency.state, 'CONTINGENCIA');
  const persistedSale = await prisma.comprobanteComercial.findUnique({ where: { id: outageSale.id }, include: { asiento: true } });
  assert.equal(persistedSale.estado, 'EMITIDO');
  assert.ok(persistedSale.asiento);

  await dian.saveConfig(tenant.id, user.id, {
    providerCode: 'MOCK_PT', providerName: 'PT habilitación QA', environment: 'HABILITACION',
    invoiceEnabled: true, payrollEnabled: true, contingencyEnabled: true,
    certificateAlias: 'CERT-QA'
  });

  // RBAC base role + vertical role + per-user override + audit.
  const vendor = await prisma.user.create({ data: { tenantId: tenant.id, nombre: 'Vendedor QA', email: `vendor-${stamp}@example.com`, password: 'not-login', rol: 'VENDEDOR' } });
  let perms = await rbac.effectivePermissions(tenant.id, vendor);
  assert.equal(perms.has('VENTAS.EMITIR'), true);
  assert.equal(perms.has('CONTABILIDAD.REABRIR'), false);
  const verticalRole = await rbac.createRole(tenant.id, user.id, { code: `MESERO_${String(stamp).slice(-6)}`, name: 'Mesero QA', vertical: 'RESTAURANTE' });
  assert.equal(verticalRole.vertical, 'RESTAURANTE');
  await rbac.setUserOverride(tenant.id, user.id, vendor.id, { permissionCode: 'CARTERA.VER', effect: 'ALLOW', reason: 'QA permiso puntual' });
  perms = await rbac.effectivePermissions(tenant.id, vendor);
  assert.equal(perms.has('CARTERA.VER'), true);
  assert.ok(await prisma.rbacAudit.count({ where: { tenantId: tenant.id, targetUserId: vendor.id } }));
  assert.ok(await prisma.auditoriaContable.count({ where: { tenantId: tenant.id, entidad: 'RBAC' } }));

  // Printing: real physical widths in model, tenant default and LAN endpoint validation.
  const printConfig = await printing.saveConfig(tenant.id, user.id, { defaultFormat: 'TERMICA_58', invoicePdfFormat: 'PDF_CARTA', qrMinimumMm: 20, headerText: 'QA', footerText: 'VantixGC' });
  assert.equal(printConfig.defaultFormatSpec.widthMm, 58);
  const ticket = printing.templateContract('TERMICA_58', printConfig.qrMinimumMm);
  assert.equal(ticket.widthMm, 58);
  assert.equal(ticket.qrBlock.widthMm, 20);
  assert.equal(ticket.qrBlock.standaloneOnNarrowTicket, true);
  assert.equal(printConfig.qrRule.legalStatus, 'PENDING_OFFICIAL_ANNEX_SIZE_VERIFICATION');
  const lan = await printing.savePrinter(tenant.id, { name: `Cocina ${stamp}`, transport: 'LAN', role: 'COCINA', host: '192.168.1.50', port: 9100, format: 'TERMICA_80', active: true });
  assert.equal(lan.transport, 'LAN');
  let lanError = null;
  try { await printing.savePrinter(tenant.id, { name: `LAN inválida ${stamp}`, transport: 'LAN', role: 'DOCUMENTOS', active: true }); }
  catch (error) { lanError = error; }
  assert.equal(lanError?.code, 'PRINT_LAN_ENDPOINT_REQUIRED');

  // Payroll: Tercero-backed employee, one AU and one electronic payroll document.
  const employeeThird = await prisma.tercero.create({ data: { tenantId: tenant.id, tipo: 'EMPLEADO', tipoDocumento: 'CC', identificacion: `EMP-${stamp}`, nombre: 'Empleado Nómina QA' } });
  const employee = await payroll.saveEmployee(tenant.id, { terceroId: employeeThird.id, employeeCode: `E-${String(stamp).slice(-6)}`, contractType: 'LABORAL', baseSalary: 3000000, startDate: new Date(), active: true });
  const accountBase = String(stamp).slice(-6);
  const [expenseAccount, payableAccount, contributionAccount] = await prisma.$transaction([
    prisma.cuentaPUC.create({ data: { tenantId: tenant.id, codigo: `51${accountBase}01`, nombre: 'Gasto nómina QA', nivel: 'AUXILIAR', naturaleza: 'DEBITO', permiteMovimiento: true, requiereTercero: false, versionCatalogo: 'CUSTOM', activa: true, clasificacionESF: 'RESULTADO', categoriaResultado: 'GASTO_ADMINISTRACION' } }),
    prisma.cuentaPUC.create({ data: { tenantId: tenant.id, codigo: `25${accountBase}01`, nombre: 'Nómina por pagar QA', nivel: 'AUXILIAR', naturaleza: 'CREDITO', permiteMovimiento: true, requiereTercero: false, versionCatalogo: 'CUSTOM', activa: true, clasificacionESF: 'PASIVO_CORRIENTE' } }),
    prisma.cuentaPUC.create({ data: { tenantId: tenant.id, codigo: `25${accountBase}02`, nombre: 'Aportes nómina QA', nivel: 'AUXILIAR', naturaleza: 'CREDITO', permiteMovimiento: true, requiereTercero: false, versionCatalogo: 'CUSTOM', activa: true, clasificacionESF: 'PASIVO_CORRIENTE' } })
  ]);
  await payroll.saveConfig(tenant.id, user.id, { expenseAccountId: expenseAccount.id, payableAccountId: payableAccount.id, contributionAccountId: contributionAccount.id, transmissionReminderDays: 5 });
  const year = 2098;
  const period = await payroll.createPeriod(tenant.id, user.id, { year, month: 1, frequency: 'MENSUAL', lines: [{ employeeId: employee.id, devengados: { salario: 3000000 }, deducciones: { saludPension: 240000 }, totalDevengado: 3000000, totalDeducido: 240000 }] });
  const generated = await payroll.generatePeriod(tenant.id, user.id, period.id);
  assert.equal(generated.state, 'GENERADO');
  const payrollJournal = await prisma.asientoContable.findUnique({ where: { id: generated.accountingJournalId }, include: { detalles: true, tipoComprobante: true } });
  assert.ok(payrollJournal && balanced(payrollJournal));
  assert.equal(payrollJournal.tipoComprobante.codigo, 'AU');
  const payrollDian = await prisma.dianDocument.findUnique({ where: { id: generated.lines[0].dianDocumentId } });
  assert.equal(payrollDian.documentType, 'NOMINA_ELECTRONICA');
  assert.equal(payrollDian.state, 'PENDIENTE_ENVIO');
  const payrollAccepted = await dian.processDocument(payrollDian.id);
  assert.equal(payrollAccepted.state, 'ACEPTADO');
  assert.equal(payrollAccepted.uniqueCodeType, 'CUNE_TEST');
  const transmitted = await payroll.syncTransmissionState(tenant.id, period.id);
  assert.equal(transmitted.state, 'TRANSMITIDO');

  // Platform SaaS: independent identity/token, tenant suspension, users and progressive rollout.
  const platformPassword = `Platform-QA-${stamp}!`;
  const superAdmin = await platform.bootstrapSuperAdmin({ name: 'Platform QA', email: `platform-${stamp}@example.com`, password: platformPassword });
  const platformSession = await platform.login(superAdmin.email, platformPassword);
  const decoded = platform.verifyPlatformToken(platformSession.token);
  assert.equal(decoded.scope, 'PLATFORM_ADMIN');
  const tenantToken = signAccessToken({ userId: user.id, tenantId: tenant.id, rol: 'ADMIN' });
  let tenantTokenRejected = false;
  try { platform.verifyPlatformToken(tenantToken); } catch (_error) { tenantTokenRejected = true; }
  assert.equal(tenantTokenRejected, true, 'JWT tenant no puede autenticar API de plataforma');

  await platform.setTenantControl(superAdmin.id, tenant.id, { currentVersion: '1.0.0', targetVersion: '1.1.0', rolloutChannel: 'PILOTO', planCode: 'CORE_PRO' });
  await platform.setTenantControl(superAdmin.id, other.tenant.id, { currentVersion: '1.0.0', rolloutChannel: 'ESTABLE', planCode: 'CORE' });
  const controls = await prisma.platformTenantControl.findMany({ where: { tenantId: { in: [tenant.id, other.tenant.id] } } });
  const byTenant = new Map(controls.map((x) => [x.tenantId, x]));
  assert.equal(byTenant.get(tenant.id).targetVersion, '1.1.0');
  assert.equal(byTenant.get(tenant.id).rolloutChannel, 'PILOTO');
  assert.equal(byTenant.get(other.tenant.id).targetVersion, null);
  assert.equal(byTenant.get(other.tenant.id).rolloutChannel, 'ESTABLE');
  const listedUsers = await platform.listTenantUsers(tenant.id);
  assert.ok(listedUsers.users.some((x) => x.id === vendor.id));
  await platform.setUserActive(superAdmin.id, tenant.id, vendor.id, false);
  assert.equal((await prisma.user.findUnique({ where: { id: vendor.id } })).activo, false);

  await platform.setTenantActive(superAdmin.id, tenant.id, false, 'QA suspension');
  const inactive = await middlewareErrorForTenant(tenant.subdomain);
  assert.equal(inactive?.code, 'TENANT_INACTIVE');
  await platform.setTenantActive(superAdmin.id, tenant.id, true, 'QA restore');
  const metrics = await platform.metrics();
  assert.ok(metrics.tenants.total >= 2);
  assert.ok(await prisma.platformAudit.count({ where: { superAdminId: superAdmin.id } }));

  console.log('PLATFORM CORE V1 SMOKE OK');
  console.log(JSON.stringify({
    sharedDianConfig: true,
    saleAtomicOutbox: true,
    contingencyKeepsSale: true,
    rbacGranular: true,
    verticalRole: true,
    print58andLan: true,
    qrExactLegalMinimumStillUnverified: true,
    payrollAuAndDian: true,
    independentPlatformAuth: true,
    tenantSuspension: true,
    progressiveRollout: true,
    realPtAdapter: false
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
