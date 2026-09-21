'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { prisma } = require('../src/config/prisma');
const { ensureRestaurantDemoTenant } = require('./ensure-restaurant-demo-tenant');
const accounting = require('../src/modules/accounting/accounting.service');
const accountingIntegration = require('../src/modules/accounting/accounting-integration.service');
const companyProfile = require('../src/modules/restaurant/restaurant-company-profile.service');

function inlineScripts(source) {
  return [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

async function main() {
  const demo = await ensureRestaurantDemoTenant();
  const tenant = await prisma.tenant.findUnique({ where:{ id:demo.tenantId }, select:{ nombreEmpresa:true, subdomain:true } });
  assert.ok(tenant, 'demo-restaurante tenant missing');

  const [accounts, journals, integration, company] = await Promise.all([
    accounting.listAccounts(demo.tenantId, { limit: 3000 }),
    accounting.listJournals(demo.tenantId, { pageSize: 20 }),
    accountingIntegration.integrationStatus(demo.tenantId),
    companyProfile.getCompanyProfile(demo.tenantId)
  ]);

  assert.ok(Array.isArray(accounts), 'Contabilidad debe leer el PUC del tenant');
  assert.ok(Array.isArray(journals.items), 'Contabilidad debe leer el Libro Diario');
  assert.ok(integration && typeof integration === 'object', 'Estado de integración contable no disponible');
  assert.equal(company.nombreEmpresa, tenant.nombreEmpresa, 'Configuración avanzada debe leer la empresa del mismo tenant');

  const hierarchicalTrial = await accounting.getTrialBalance(demo.tenantId, { jerarquia:true, incluirCeros:true });
  assert.equal(hierarchicalTrial.jerarquia, true, 'Copia Restaurante debe poder pedir Balance de Prueba jerárquico');
  assert.ok(hierarchicalTrial.cuentas.some((row)=>row.hasChildren), 'Balance jerárquico debe incluir cuentas padre');
  assert.ok(hierarchicalTrial.cuentas.some((row)=>Number(row.depth||0)>0), 'Balance jerárquico debe incluir cuentas hijas');

  const accountingHtml = fs.readFileSync('src/web/restaurant-v2-accounting-core-v1.html', 'utf8');
  const configHtml = fs.readFileSync('src/web/restaurant-v2-advanced-config-core-v1.html', 'utf8');
  const publicRoutes = fs.readFileSync('src/modules/restaurant/restaurant-core-copies-v1.public.routes.js', 'utf8');
  const accountingGuard = fs.readFileSync('src/web/restaurant-v2-accounting-runtime-guard-v1.js', 'utf8');
  const notificationsCopy = fs.readFileSync('src/web/restaurant-v2-notifications-config-v1.js', 'utf8');
  const publicAggregator = fs.readFileSync('src/modules/restaurant/restaurant.public.routes.js', 'utf8');
  const nav = fs.readFileSync('src/web/restaurant-v2-native-control-p11.js', 'utf8');

  assert.match(accountingHtml, /VANTIX_RESTAURANT_ACCOUNTING_CORE_COPY_V1/);
  assert.match(accountingHtml, /\/api\/v1\/contabilidad\/cuentas/);
  assert.match(accountingHtml, /\/api\/v1\/contabilidad\/asientos/);
  assert.match(accountingHtml, /\/api\/v1\/contabilidad\/reportes/);
  assert.match(accountingHtml, /restaurant-v2-accounting-runtime-guard-v1\.js\?v=v1/);
  assert.match(accountingHtml, /\.sidebar,\.topbar\{display:none!important\}/);
  assert.match(accountingHtml, /demo-restaurante/);

  assert.match(accountingHtml, /Mostrar jerarquía completa/);
  assert.match(accountingHtml, /Incluir cuentas sin movimiento/);
  assert.match(accountingHtml, /Saldo anterior/);
  assert.match(accountingHtml, /Saldo final/);
  assert.match(accountingHtml, /jerarquia:\$\('#hierarchy'\)/);
  assert.match(accountingHtml, /incluirCeros:\$\('#includeZeros'\)/);
  assert.match(accountingHtml, /reportAccountCell/);

  assert.match(configHtml, /VANTIX_RESTAURANT_ADVANCED_CONFIG_CORE_COPY_V1/);
  assert.match(configHtml, /Configuración avanzada/);
  assert.match(configHtml, /data-tab="dian"/);
  assert.match(configHtml, /data-tab="roles"/);
  assert.match(configHtml, /data-tab="print"/);
  assert.match(configHtml, /data-tab="payroll"/);
  assert.match(configHtml, /restaurant-v2-notifications-config-v1\.js\?v=v1/);
  assert.match(configHtml, /restaurant-company-admin-advanced\.js\?v=2/);
  assert.match(configHtml, /restaurant-audit-log-c84\.js\?v=84/);
  assert.match(configHtml, /\.side,\.top\{display:none!important\}/);
  assert.match(configHtml, /demo-restaurante/);

  for (const source of [accountingHtml, configHtml]) {
    for (const script of inlineScripts(source)) {
      assert.doesNotThrow(() => new Function(script), 'La copia de UI debe compilar sin errores de JavaScript');
    }
  }

  assert.match(publicRoutes, /\/app\/restaurante-v2\/contabilidad/);
  assert.match(publicRoutes, /\/app\/restaurante-v2\/configuracion-avanzada/);
  assert.match(publicRoutes, /restaurant-v2-accounting-runtime-guard-v1\.js/);
  assert.match(publicRoutes, /restaurant-v2-notifications-config-v1\.js/);
  assert.match(accountingGuard, /VANTIX_RESTAURANT_ACCOUNTING_RUNTIME_GUARD_COPY_V1/);
  assert.match(notificationsCopy, /VANTIX_RESTAURANT_NOTIFICATIONS_CONFIG_COPY_V1/);
  assert.doesNotThrow(() => new Function(accountingGuard), 'El guard contable copiado debe compilar');
  assert.doesNotThrow(() => new Function(notificationsCopy), 'La UI de notificaciones copiada debe compilar');
  assert.match(publicAggregator, /restaurantCoreCopiesV1PublicRouter/);

  assert.match(nav, /contabilidad:\{ label:'Contabilidad'/);
  assert.match(nav, /configuracionAvanzada:\{ label:'Configuración avanzada'/);
  assert.match(nav, /group:'finance'/);
  assert.match(nav, /Finanzas y sistema/);
  assert.match(nav, /\['contabilidad','configuracionAvanzada'\]\.includes\(key\) && session\.subdomain !== DEMO_RESTAURANTE/);

  console.log('RESTAURANT_CORE_COPIES_V1=PASS');
  console.log('ACCOUNTING_ENGINE_CONNECTION=PASS');
  console.log('ACCOUNTING_HIERARCHY_PARENT_CHILD=PASS');
  console.log('ADVANCED_CONFIG_CONNECTION=PASS');
  console.log('ACCOUNTING_ACCOUNTS=' + accounts.length);
  console.log('ACCOUNTING_JOURNALS=' + journals.items.length);
  console.log('ACCOUNTING_MAPPING_READY=' + String(Boolean(integration.ready)));
  console.log('COMPANY_PROFILE=' + company.nombreEmpresa);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
