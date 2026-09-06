'use strict';

process.env.DATABASE_URL ||= 'postgresql://localhost:5432/unused';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const companyService = require('../src/modules/restaurant/restaurant-company-profile.service');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const publicRoutes = read('src/modules/restaurant/restaurant.public.routes.js');
const layer = read('src/modules/restaurant/restaurant-company-admin-advanced.public.routes.js');
const client = read('src/web/restaurant-company-admin-advanced.js');
const companyProfile = read('src/modules/restaurant/restaurant-company-profile.service.js');
const signup = read('src/web/restaurant-signup.html');
const app = read('src/app.js');
const receipt = read('src/modules/restaurant/restaurant-pos-receipt-print.service.js');

// Company identity belongs to global Administration -> Configuración avanzada.
assert.match(layer, /VANTIX_RESTAURANT_COMPANY_ADMIN_ADVANCED_V2/);
assert.match(layer, /\/app\/configuracion-avanzada/);
assert.match(layer, /\/app\/restaurant-company-admin-advanced\.js/);
assert.match(layer, /X-VantixGC-Restaurant-Company-Admin/);
assert.match(publicRoutes, /installCompanyAdminAdvancedAsset/);
assert.match(publicRoutes, /restaurantCompanyAdminAdvancedPublicRouter/);
assert.doesNotMatch(publicRoutes, /installCompanyConfigControlCenterAsset/);
assert.doesNotMatch(publicRoutes, /restaurantCompanyConfigControlCenterPublicRouter/);
assert.match(app, /href:\s*'\/app\/configuracion-avanzada',\s*label:\s*'Configuración avanzada'/);

assert.match(client, /VANTIX_RESTAURANT_COMPANY_ADMIN_ADVANCED_V2/);
assert.match(client, /location\.pathname !== PAGE_PATH/);
assert.match(client, /button\.textContent = 'Empresa'/);
assert.match(client, /Información de la empresa/);
assert.match(client, /Nombre del restaurante \/ empresa/);
assert.match(client, /NIT/);
assert.match(client, /Dirección/);
assert.match(client, /Ciudad \/ municipio/);
assert.match(client, /Departamento/);
assert.match(client, /Teléfono/);
assert.match(client, /Correo electrónico/);
assert.match(client, /prueba de 14 días/);
assert.match(client, /\/api\/v1\/impresion\/empresa/);
assert.match(client, /method:'PUT'/);
assert.match(client, /pertenece a Administración/);
assert.match(client, /No modifica el flujo operativo del Centro de control/);
assert.doesNotMatch(client, /\/api\/[^"]*dian/i, 'company administration must not call DIAN APIs');

// Trial registration already captures the reusable fields.
for (const field of ['restaurantName', 'phone', 'city', 'department', 'email']) {
  assert.match(signup, new RegExp(`name=["']${field}["']`));
}
assert.match(signup, /\/api\/public\/restaurantes\/register/);

// Existing and future demos reuse onboarding + admin email when no explicit company profile exists.
assert.match(companyProfile, /tenantOnboarding\?\.findUnique/);
assert.match(companyProfile, /user\?\.findFirst/);
assert.match(companyProfile, /signup\.phone/);
assert.match(companyProfile, /signup\.city/);
assert.match(companyProfile, /signup\.department/);
assert.match(companyProfile, /signup\.email/);
assert.match(companyProfile, /admin\?\.email/);
assert.match(companyProfile, /tenantOnboarding\?\.update/);
assert.match(companyProfile, /restaurantName:\s*nombreEmpresa/);

const fallback = companyService.normalizeProfile(
  { nombreEmpresa:'Demo del Norte', nit:null },
  null,
  { profile:{
    address:'Carrera 5 # 10-20',
    phone:'3001234567',
    city:'Yarumal',
    department:'Antioquia'
  } },
  { email:'admin@demo.co' }
);
assert.equal(fallback.nombreEmpresa, 'Demo del Norte');
assert.equal(fallback.address, 'Carrera 5 # 10-20');
assert.equal(fallback.phone, '3001234567');
assert.equal(fallback.city, 'Yarumal');
assert.equal(fallback.department, 'Antioquia');
assert.equal(fallback.email, 'admin@demo.co');

const explicitWins = companyService.normalizeProfile(
  { nombreEmpresa:'Demo del Norte', nit:'900111222-3' },
  { address:'Calle 99', city:'Medellín', department:'Antioquia', phone:'6040000000', email:'empresa@demo.co' },
  { profile:{ address:'Dirección antigua', city:'Yarumal', phone:'3001234567' } },
  { email:'admin@demo.co' }
);
assert.equal(explicitWins.address, 'Calle 99');
assert.equal(explicitWins.city, 'Medellín');
assert.equal(explicitWins.phone, '6040000000');
assert.equal(explicitWins.email, 'empresa@demo.co');

// Receipt pipeline remains the same; only its source is now unified.
assert.match(receipt, /companyService\.getCompanyProfile/);
assert.match(receipt, /companyService\.receiptCompanyLines/);
assert.doesNotMatch(receipt, /dianRealEnabled|fiscal gate/i);

console.log('RESTAURANT COMPANY ADMIN SOURCE SMOKE OK', JSON.stringify({
  administrationAdvanced:true,
  controlCenterOperationalOnly:true,
  trialDataReused:true,
  existingDemoFallback:true,
  onboardingSyncedOnEdit:true,
  posReceiptSourceUnified:true,
  dianDecoupled:true
}));
