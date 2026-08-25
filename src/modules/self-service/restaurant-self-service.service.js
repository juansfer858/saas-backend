'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { prisma } = require('../../config/prisma');
const { AppError } = require('../../utils/app-error');
const { signAccessToken } = require('../../utils/jwt');
const { seedTenantDefaults } = require('../../services/tenant-seed.service');
const { seedPlatformDefaults } = require('../../services/platform-seed.service');
const { slugBase } = require('../platform/saas/platform-tenant-provisioning.service');
const verticalEntitlements = require('../platform/verticals/vertical-entitlement.service');
const edgeService = require('../edge/edge.service');

const TRIAL_DAYS = Math.min(Math.max(Number(process.env.RESTAURANT_TRIAL_DAYS) || 14, 1), 60);
const INSTALL_CLAIM_MINUTES = Math.min(Math.max(Number(process.env.EDGE_INSTALL_CLAIM_MINUTES) || 30, 5), 240);
const INSTALL_SOURCE_COMMIT = '40634cc4f6812686644ccb7109be283806f74e66';
const RESERVED_SUBDOMAINS = new Set(['www', 'api', 'app', 'core', 'platform', 'admin', 'demo', 'status', 'edge', 'restaurantes']);

function selfServiceEnabled() {
  return String(process.env.RESTAURANT_SELF_SERVICE_ENABLED || 'true').toLowerCase() !== 'false';
}

function requireSelfServiceEnabled() {
  if (!selfServiceEnabled()) throw new AppError(503, 'El registro autoservicio de VantixGC Restaurantes está temporalmente pausado', 'RESTAURANT_SELF_SERVICE_DISABLED');
}

function tokenHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

async function allocateSubdomain(tx, businessName) {
  const raw = slugBase(businessName);
  const base = RESERVED_SUBDOMAINS.has(raw) ? `rest-${raw}` : raw;
  for (let index = 0; index < 1000; index += 1) {
    const suffix = index === 0 ? '' : `-${index + 1}`;
    const candidate = `${base.slice(0, 63 - suffix.length)}${suffix}`;
    const exists = await tx.tenant.findUnique({ where: { subdomain: candidate }, select: { id: true } });
    if (!exists) return candidate;
  }
  throw new AppError(409, 'No fue posible reservar un subdominio para el restaurante', 'SELF_SERVICE_SUBDOMAIN_EXHAUSTED');
}

function subscriptionView(row) {
  if (!row) return null;
  const now = Date.now();
  const trialEndsAt = new Date(row.trialEndsAt).getTime();
  const effectiveState = row.state === 'TRIAL' && trialEndsAt <= now ? 'TRIAL_EXPIRED' : row.state;
  return {
    ...row,
    effectiveState,
    trialDays: TRIAL_DAYS,
    daysRemaining: effectiveState === 'TRIAL' ? Math.max(0, Math.ceil((trialEndsAt - now) / 86400000)) : 0,
    billingEnabled: false,
    enforcementMode: 'PRE_BILLING'
  };
}

async function registerRestaurant(input) {
  requireSelfServiceEnabled();
  const passwordHash = await bcrypt.hash(input.password, 12);
  const trialStartedAt = new Date();
  const trialEndsAt = new Date(trialStartedAt.getTime() + TRIAL_DAYS * 86400000);

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      const subdomain = await allocateSubdomain(tx, input.restaurantName);
      const tenant = await tx.tenant.create({
        data: {
          nombreEmpresa: input.restaurantName,
          nicho: 'RESTAURANTE',
          subdomain,
          pais: input.country || 'CO',
          moneda: input.currency || 'COP',
          activo: true
        }
      });
      const admin = await tx.user.create({
        data: {
          tenantId: tenant.id,
          nombre: input.adminName,
          email: input.email,
          password: passwordHash,
          rol: 'ADMIN',
          activo: true
        },
        select: { id: true, tenantId: true, nombre: true, email: true, rol: true, activo: true, creadoEn: true }
      });

      await seedTenantDefaults(tx, tenant);
      await seedPlatformDefaults(tx, tenant, admin);
      await tx.restaurantConfig.upsert({ where: { tenantId: tenant.id }, create: { tenantId: tenant.id }, update: {} });
      await verticalEntitlements.activateWithClient(tx, tenant.id, 'RESTAURANT', {
        source: 'PUBLIC_SELF_SERVICE', metadata: { trial: true, channel: 'WEB' }
      });
      const subscription = await tx.saasSubscription.create({
        data: {
          tenantId: tenant.id,
          productCode: 'RESTAURANT',
          planCode: 'TRIAL',
          state: 'TRIAL',
          trialStartedAt,
          trialEndsAt,
          metadata: { source: 'PUBLIC_SELF_SERVICE', trialDays: TRIAL_DAYS }
        }
      });
      const onboarding = await tx.tenantOnboarding.create({
        data: {
          tenantId: tenant.id,
          verticalCode: 'RESTAURANT',
          state: 'IN_PROGRESS',
          currentStep: 'BUSINESS',
          profile: {
            restaurantName: input.restaurantName,
            phone: input.phone || null,
            city: input.city || null,
            department: input.department || null,
            country: input.country || 'CO'
          },
          completedSteps: []
        }
      });
      await tx.platformTenantControl.update({
        where: { tenantId: tenant.id },
        data: { planCode: 'RESTAURANT_TRIAL', rolloutChannel: 'PILOTO' }
      });
      return { tenant, admin, subscription, onboarding };
    });
  } catch (error) {
    if (error?.code === 'P2002') throw new AppError(409, 'Ese correo o dato de registro ya está en uso para este alta', 'SELF_SERVICE_UNIQUE_CONFLICT');
    throw error;
  }

  const token = signAccessToken({ userId: created.admin.id, tenantId: created.tenant.id, rol: created.admin.rol });
  return {
    session: {
      token,
      subdomain: created.tenant.subdomain,
      tenant: {
        id: created.tenant.id,
        nombreEmpresa: created.tenant.nombreEmpresa,
        pais: created.tenant.pais,
        moneda: created.tenant.moneda,
        nicho: created.tenant.nicho
      },
      user: created.admin
    },
    subscription: subscriptionView(created.subscription),
    onboarding: created.onboarding,
    next: '/app/onboarding'
  };
}

async function getSubscription(tenantId) {
  return subscriptionView(await prisma.saasSubscription.findUnique({ where: { tenantId } }));
}

async function getOnboarding(tenantId) {
  const [onboarding, subscription, tables, menuItems, installations] = await Promise.all([
    prisma.tenantOnboarding.findUnique({ where: { tenantId } }),
    prisma.saasSubscription.findUnique({ where: { tenantId } }),
    prisma.restaurantTable.count({ where: { tenantId, active: true } }),
    prisma.restaurantMenuItem.count({ where: { tenantId, active: true } }),
    prisma.edgeInstallation.count({ where: { tenantId } })
  ]);
  if (!onboarding) throw new AppError(404, 'Onboarding no encontrado para este tenant', 'ONBOARDING_NOT_FOUND');
  return { onboarding, subscription: subscriptionView(subscription), progress: { tables, menuItems, installations } };
}

function completedSet(row) {
  return new Set(Array.isArray(row?.completedSteps) ? row.completedSteps : []);
}

async function updateOnboarding(tenantId, input) {
  const current = await prisma.tenantOnboarding.findUnique({ where: { tenantId } });
  if (!current) throw new AppError(404, 'Onboarding no encontrado', 'ONBOARDING_NOT_FOUND');
  const completed = completedSet(current);
  if (input.completeStep) completed.add(String(input.completeStep).toUpperCase());
  const profile = input.profile ? { ...(current.profile || {}), ...input.profile } : current.profile;
  return prisma.tenantOnboarding.update({
    where: { tenantId },
    data: { currentStep: input.currentStep || current.currentStep, profile, completedSteps: [...completed] }
  });
}

async function configureTables(tenantId, countValue) {
  const count = Math.min(Math.max(Number(countValue) || 0, 1), 50);
  await prisma.$transaction(async (tx) => {
    for (let i = 1; i <= count; i += 1) {
      const code = `M${i}`;
      await tx.restaurantTable.upsert({
        where: { tenantId_code: { tenantId, code } },
        create: {
          tenantId, code, name: `Mesa ${i}`, seats: 4,
          posX: 30 + ((i - 1) % 4) * 155,
          posY: 35 + Math.floor((i - 1) / 4) * 120,
          active: true
        },
        update: { name: `Mesa ${i}`, active: true }
      });
    }
  });
  await updateOnboarding(tenantId, { completeStep: 'TABLES', currentStep: 'MENU' });
  return { tables: await prisma.restaurantTable.count({ where: { tenantId, active: true } }) };
}

const STARTER_MENU = Object.freeze([
  { sku: 'TRIAL-HAMB', name: 'Hamburguesa de la casa', price: 22000, category: 'FUERTES', station: 'COCINA' },
  { sku: 'TRIAL-PAPAS', name: 'Papas de entrada', price: 9000, category: 'ENTRADAS', station: 'COCINA' },
  { sku: 'TRIAL-LIMONADA', name: 'Limonada natural', price: 7000, category: 'BEBIDAS', station: 'BARRA' },
  { sku: 'TRIAL-POSTRE', name: 'Postre de la casa', price: 10000, category: 'POSTRES', station: 'POSTRES' }
]);

async function seedStarterMenu(tenantId) {
  await prisma.$transaction(async (tx) => {
    for (let index = 0; index < STARTER_MENU.length; index += 1) {
      const item = STARTER_MENU[index];
      const product = await tx.producto.upsert({
        where: { tenantId_sku: { tenantId, sku: item.sku } },
        create: {
          tenantId, tipo: 'PRODUCTO', sku: item.sku, nombre: item.name,
          unidadMedida: 'UND', controlaInventario: true, stockActual: 100,
          costoPromedio: 0, precio1: item.price, ivaPct: 0, impoconsumoPct: 8, activo: true
        },
        update: { nombre: item.name, precio1: item.price, impoconsumoPct: 8, activo: true }
      });
      await tx.restaurantMenuItem.upsert({
        where: { tenantId_productId: { tenantId, productId: product.id } },
        create: {
          tenantId, productId: product.id, category: item.category, station: item.station,
          requiresRecipe: false, active: true, sortOrder: (index + 1) * 10
        },
        update: { category: item.category, station: item.station, requiresRecipe: false, active: true, sortOrder: (index + 1) * 10 }
      });
    }
  });
  await updateOnboarding(tenantId, { completeStep: 'MENU', currentStep: 'SITE' });
  return { menuItems: await prisma.restaurantMenuItem.count({ where: { tenantId, active: true } }) };
}

async function skipStarterMenu(tenantId) {
  await updateOnboarding(tenantId, { completeStep: 'MENU', currentStep: 'SITE' });
  return { skipped: true };
}

async function completeOnboarding(tenantId) {
  const row = await prisma.tenantOnboarding.findUnique({ where: { tenantId } });
  if (!row) throw new AppError(404, 'Onboarding no encontrado', 'ONBOARDING_NOT_FOUND');
  const completed = completedSet(row);
  for (const step of ['BUSINESS', 'TABLES', 'MENU', 'SITE']) completed.add(step);
  return prisma.tenantOnboarding.update({
    where: { tenantId },
    data: { state: 'COMPLETED', currentStep: 'DONE', completedSteps: [...completed], completedAt: new Date() }
  });
}

async function createInstallClaim(tenantId, userId, input = {}) {
  const subscription = await getSubscription(tenantId);
  if (!subscription) throw new AppError(409, 'Este tenant no tiene suscripción SaaS inicializada', 'SUBSCRIPTION_REQUIRED');
  if (!(await verticalEntitlements.hasVertical(tenantId, 'RESTAURANT'))) {
    throw new AppError(403, 'VantixGC Restaurantes no está activo para este tenant', 'RESTAURANT_VERTICAL_REQUIRED');
  }
  const raw = crypto.randomBytes(32).toString('base64url');
  const pointCode = String(input.pointCode || 'SEDE-PRINCIPAL').trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '-').slice(0, 50) || 'SEDE-PRINCIPAL';
  const name = String(input.name || 'Sede principal').trim().slice(0, 100) || 'Sede principal';
  const expiresAt = new Date(Date.now() + INSTALL_CLAIM_MINUTES * 60000);
  await prisma.edgeInstallClaim.create({
    data: { tenantId, userId, pointCode, name, tokenHash: tokenHash(raw), expiresAt, metadata: { source: 'ONBOARDING' } }
  });
  return { token: raw, expiresAt, pointCode, name, downloadPath: `/api/public/restaurantes/instalador/${encodeURIComponent(raw)}.cmd` };
}

async function consumeInstallClaim(rawToken, deviceName = null) {
  requireSelfServiceEnabled();
  const hash = tokenHash(rawToken);
  const claim = await prisma.edgeInstallClaim.findUnique({ where: { tokenHash: hash } });
  if (!claim) throw new AppError(404, 'Claim de instalación inválido', 'EDGE_INSTALL_CLAIM_NOT_FOUND');
  if (claim.edgeAgentId || claim.consumedAt) throw new AppError(409, 'Este instalador ya fue utilizado', 'EDGE_INSTALL_CLAIM_CONSUMED');
  if (claim.expiresAt <= new Date()) throw new AppError(410, 'Este instalador venció. Genera uno nuevo desde VantixGC.', 'EDGE_INSTALL_CLAIM_EXPIRED');
  const reserved = await prisma.edgeInstallClaim.updateMany({
    where: { id: claim.id, consumedAt: null, edgeAgentId: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date(), metadata: { ...(claim.metadata || {}), deviceName: deviceName || null } }
  });
  if (reserved.count !== 1) throw new AppError(409, 'El claim de instalación ya está siendo utilizado', 'EDGE_INSTALL_CLAIM_BUSY');
  try {
    const agent = await edgeService.provisionAgent(claim.tenantId, claim.userId, {
      name: claim.name, pointCode: claim.pointCode, softwareVersion: 'SELF_SERVICE_UNIVERSAL'
    });
    await prisma.edgeInstallClaim.update({ where: { id: claim.id }, data: { edgeAgentId: agent.id } });
    return { tenantId: claim.tenantId, edgeAgentId: agent.id, edgeKey: agent.edgeKey, pointCode: agent.pointCode, name: agent.name };
  } catch (error) {
    await prisma.edgeInstallClaim.updateMany({ where: { id: claim.id, edgeAgentId: null }, data: { consumedAt: null } }).catch(() => {});
    throw error;
  }
}

function safePs(value) {
  return String(value || '').replace(/'/g, "''");
}

function installerPowerShell(rawToken, coreBaseUrl) {
  const token = safePs(rawToken);
  const core = safePs(coreBaseUrl.replace(/\/$/, ''));
  return `$ErrorActionPreference = 'Stop'\n$CoreBaseUrl = '${core}'\n$ClaimToken = '${token}'\n$Commit = '${INSTALL_SOURCE_COMMIT}'\n$Temp = Join-Path $env:TEMP ('vantixgc-' + [guid]::NewGuid().ToString('N'))\nNew-Item -ItemType Directory -Force -Path $Temp | Out-Null\ntry {\n  Write-Host '[1/5] Descargando VantixGC Edge Universal...' -ForegroundColor Cyan\n  $RepoZip = Join-Path $Temp 'repo.zip'\n  Invoke-WebRequest -UseBasicParsing -Uri (\"https://github.com/juansfer858/saas-backend/archive/$Commit.zip\") -OutFile $RepoZip\n  Expand-Archive -LiteralPath $RepoZip -DestinationPath $Temp -Force\n  $Repo = Get-ChildItem -LiteralPath $Temp -Directory | Where-Object { $_.Name -like 'saas-backend-*' } | Select-Object -First 1\n  if (-not $Repo) { throw 'No fue posible preparar el paquete VantixGC.' }\n  $Edge = Join-Path $Repo.FullName 'edge'\n  Write-Host '[2/5] Preparando runtime local...' -ForegroundColor Cyan\n  $NodeZip = Join-Path $Temp 'node.zip'\n  Invoke-WebRequest -UseBasicParsing -Uri 'https://nodejs.org/dist/v22.23.2/node-v22.23.2-win-x64.zip' -OutFile $NodeZip\n  $NodeDir = Join-Path $Temp 'node'\n  Expand-Archive -LiteralPath $NodeZip -DestinationPath $NodeDir -Force\n  $NodeExe = Get-ChildItem -LiteralPath $NodeDir -Filter node.exe -Recurse | Select-Object -First 1\n  if (-not $NodeExe) { throw 'No fue posible preparar Node.js local.' }\n  New-Item -ItemType Directory -Force -Path (Join-Path $Edge 'runtime') | Out-Null\n  Copy-Item -LiteralPath $NodeExe.FullName -Destination (Join-Path $Edge 'runtime\\node.exe') -Force\n  Write-Host '[3/5] Vinculando esta sede...' -ForegroundColor Cyan\n  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Edge 'supervisor\\install-windows.ps1') -CoreBaseUrl $CoreBaseUrl -InstallClaimToken $ClaimToken\n  if ($LASTEXITCODE -ne 0) { throw \"El instalador VantixGC terminó con código $LASTEXITCODE.\" }\n  Write-Host '[4/5] Verificando Centro de Control...' -ForegroundColor Cyan\n  Start-Sleep -Seconds 3\n  $Status = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:8788/api/status' -TimeoutSec 10\n  Write-Host ('Estado: ' + $Status.mode + ' · Conectado: ' + $Status.connected) -ForegroundColor Green\n  Write-Host '[5/5] VantixGC Restaurantes está listo.' -ForegroundColor Green\n  Start-Process 'http://127.0.0.1:8788/app/centro-de-control'\n} finally {\n  Remove-Item -LiteralPath $Temp -Recurse -Force -ErrorAction SilentlyContinue\n}\n`;
}

function installerCmd(rawToken, coreBaseUrl) {
  const base = coreBaseUrl.replace(/\/$/, '');
  const psUrl = `${base}/api/public/restaurantes/instalador/${encodeURIComponent(rawToken)}.ps1`;
  return `@echo off\r\nsetlocal\r\nset \"VANTIX_PS1=%TEMP%\\VantixGC_Restaurantes_Instalar.ps1\"\r\necho Descargando instalador VantixGC Restaurantes...\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"Invoke-WebRequest -UseBasicParsing -Uri '${psUrl}' -OutFile '%VANTIX_PS1%'\"\r\nif errorlevel 1 goto :error\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File \"%VANTIX_PS1%\"\r\nif errorlevel 1 goto :error\r\ndel /q \"%VANTIX_PS1%\" >nul 2>&1\r\necho.\r\necho Instalacion VantixGC finalizada.\r\npause\r\nexit /b 0\r\n:error\r\necho.\r\necho No fue posible completar la instalacion.\r\npause\r\nexit /b 1\r\n`;
}

module.exports = {
  TRIAL_DAYS,
  INSTALL_CLAIM_MINUTES,
  INSTALL_SOURCE_COMMIT,
  selfServiceEnabled,
  registerRestaurant,
  getSubscription,
  getOnboarding,
  updateOnboarding,
  configureTables,
  seedStarterMenu,
  skipStarterMenu,
  completeOnboarding,
  createInstallClaim,
  consumeInstallClaim,
  installerPowerShell,
  installerCmd
};
