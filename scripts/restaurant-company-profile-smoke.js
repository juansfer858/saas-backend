'use strict';

process.env.DATABASE_URL ||= 'postgresql://localhost:5432/unused';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const companyService = require('../src/modules/restaurant/restaurant-company-profile.service');

(async () => {
  const normalized = companyService.normalizeProfile(
    { nombreEmpresa:' Restaurante Central ', nit:' 901234567-8 ' },
    { address:' Calle 1 # 2-3 ', city:' Yarumal ', department:' Antioquia ', phone:' 3001234567 ', email:' caja@restaurante.co ' }
  );
  assert.equal(normalized.nombreEmpresa, 'Restaurante Central');
  assert.equal(normalized.nit, '901234567-8');
  assert.equal(normalized.address, 'Calle 1 # 2-3');
  assert.equal(normalized.city, 'Yarumal');
  assert.equal(normalized.department, 'Antioquia');
  assert.equal(normalized.phone, '3001234567');
  assert.equal(normalized.email, 'caja@restaurante.co');

  const lines = companyService.receiptCompanyLines(normalized);
  assert.deepEqual(lines, [
    'NIT: 901234567-8',
    'Dirección: Calle 1 # 2-3',
    'Yarumal · Antioquia',
    'Tel: 3001234567',
    'caja@restaurante.co'
  ]);

  const readClient = {
    tenant:{ findUnique:async () => ({ nombreEmpresa:'Restaurante Central', nit:'901234567-8' }) },
    restaurantCompanyProfile:{ findUnique:async () => ({ address:'Calle 1', city:'Yarumal', department:'Antioquia', phone:null, email:null }) }
  };
  const loaded = await companyService.getCompanyProfile('tenant-1', readClient);
  assert.equal(loaded.nombreEmpresa, 'Restaurante Central');
  assert.equal(loaded.address, 'Calle 1');

  const writes = { tenant:null, profile:null };
  const tx = {
    tenant:{ update:async (args) => { writes.tenant = args; return { nombreEmpresa:args.data.nombreEmpresa, nit:args.data.nit }; } },
    restaurantCompanyProfile:{ upsert:async (args) => { writes.profile = args; return { tenantId:'tenant-1', ...args.create }; } }
  };
  const writeClient = { $transaction:async (callback) => callback(tx) };
  const saved = await companyService.updateCompanyProfile('tenant-1', {
    nombreEmpresa:'Nuevo Nombre',
    nit:'900111222-3',
    address:'Carrera 10 # 20-30',
    city:'Medellín',
    department:'Antioquia',
    phone:'6041234567',
    email:'admin@nuevo.co'
  }, writeClient);
  assert.equal(writes.tenant.where.id, 'tenant-1');
  assert.equal(writes.tenant.data.nombreEmpresa, 'Nuevo Nombre');
  assert.equal(writes.tenant.data.nit, '900111222-3');
  assert.equal(writes.profile.where.tenantId, 'tenant-1');
  assert.equal(writes.profile.create.address, 'Carrera 10 # 20-30');
  assert.equal(saved.email, 'admin@nuevo.co');

  const prismaSchema = fs.readFileSync('prisma/restaurant-company-profile-v1.prisma', 'utf8');
  assert.match(prismaSchema, /model RestaurantCompanyProfile/);
  assert.match(prismaSchema, /tenantId\s+String\s+@unique/);
  assert.match(prismaSchema, /address\s+String\?/);

  const routes = fs.readFileSync('src/modules/platform/printing/printing.routes.js', 'utf8');
  assert.match(routes, /router\.get\('\/empresa'/);
  assert.match(routes, /router\.put\('\/empresa'/);
  assert.match(routes, /CONFIGURACION\.EDITAR/);

  const ui = fs.readFileSync('src/web/restaurant-admin-config-ui.js', 'utf8');
  assert.match(ui, /Información de la empresa/);
  assert.match(ui, /rncCompanyNit/);
  assert.match(ui, /rncCompanyAddress/);
  assert.match(ui, /rncCompanyCity/);
  assert.match(ui, /rncCompanyDepartment/);
  assert.match(ui, /rncCompanyPhone/);
  assert.match(ui, /rncCompanyEmail/);
  assert.match(ui, /\/api\/v1\/impresion\/empresa/);
  assert.match(ui, /no activa DIAN/);
  assert.match(ui, /no genera factura electrónica/);

  const receiptSource = fs.readFileSync('src/modules/restaurant/restaurant-pos-receipt-print.service.js', 'utf8');
  assert.match(receiptSource, /companyService\.getCompanyProfile/);
  assert.match(receiptSource, /companyService\.receiptCompanyLines/);
  assert.doesNotMatch(receiptSource, /dianRealEnabled|fiscal gate/i);

  const runtimeSchema = fs.readFileSync('scripts/ensure-restaurant-runtime-schema.js', 'utf8');
  assert.match(runtimeSchema, /RestaurantCompanyProfile/);
  assert.match(runtimeSchema, /companyProfile/);

  console.log('RESTAURANT COMPANY PROFILE SMOKE OK', JSON.stringify({
    centralTenantIdentity:true,
    companyContactProfile:true,
    adminAdvancedConfig:true,
    posReceiptIdentity:true,
    runtimeSchemaSelfHeal:true,
    dianIndependent:true,
    edgeUpgradeRequired:false
  }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
