'use strict';

const { AppError } = require('../../utils/app-error');
const service = require('./restaurant-self-service.service');

const REQUIRED_STEPS = Object.freeze(['BUSINESS', 'TABLES', 'MENU', 'SITE']);

function completedSet(onboarding) {
  return new Set(Array.isArray(onboarding?.completedSteps) ? onboarding.completedSteps : []);
}

async function getOnboarding(tenantId) {
  let data = await service.getOnboarding(tenantId);
  const completed = completedSet(data.onboarding);
  const hasLiveInstallation = Number(data.progress?.installations || 0) > 0;

  if (hasLiveInstallation && !completed.has('SITE')) {
    await service.updateOnboarding(tenantId, {
      completeStep: 'SITE',
      currentStep: 'DONE',
      profile: {
        installationMode: 'EDGE_LOCAL',
        installationState: 'EDGE_ONLINE',
        edgeInstalledAt: new Date().toISOString()
      }
    });
    data = await service.getOnboarding(tenantId);
  }

  return data;
}

async function noteInstallerGenerated(tenantId) {
  return service.updateOnboarding(tenantId, {
    currentStep: 'SITE',
    profile: {
      installationMode: 'PENDING',
      installationState: 'INSTALLER_GENERATED'
    }
  });
}

async function noteInstallerStarted(tenantId, deviceName = null) {
  return service.updateOnboarding(tenantId, {
    currentStep: 'SITE',
    profile: {
      installationMode: 'PENDING',
      installationState: 'INSTALLER_STARTED',
      installerDeviceName: deviceName || null,
      installerStartedAt: new Date().toISOString()
    }
  });
}

async function consumeInstallClaim(rawToken, deviceName = null) {
  const result = await service.consumeInstallClaim(rawToken, deviceName);
  await noteInstallerStarted(result.tenantId, deviceName).catch(() => {});
  return result;
}

async function deferSiteInstallation(tenantId) {
  return service.updateOnboarding(tenantId, {
    completeStep: 'SITE',
    currentStep: 'DONE',
    profile: {
      installationMode: 'CLOUD_ONLY_DEFERRED',
      installationState: 'DEFERRED',
      installationDeferredAt: new Date().toISOString()
    }
  });
}

async function completeOnboarding(tenantId) {
  const data = await getOnboarding(tenantId);
  const completed = completedSet(data.onboarding);
  const missing = REQUIRED_STEPS.filter((step) => !completed.has(step));
  if (missing.length) {
    throw new AppError(
      409,
      missing.includes('SITE')
        ? 'Antes de terminar, instala VantixGC en esta sede o elige explícitamente seguir sólo en la nube por ahora.'
        : 'Completa los pasos anteriores antes de terminar la configuración.',
      'ONBOARDING_REQUIRED_STEPS_PENDING',
      { missing }
    );
  }
  return service.completeOnboarding(tenantId);
}

module.exports = {
  REQUIRED_STEPS,
  getOnboarding,
  noteInstallerGenerated,
  consumeInstallClaim,
  deferSiteInstallation,
  completeOnboarding
};
