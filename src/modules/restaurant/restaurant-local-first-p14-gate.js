'use strict';

const PILOT_CONTRACT = Object.freeze({
  phase: 'P14',
  tenantSubdomain: 'demo-restaurante',
  installationId: 'HOME-PILOT-01',
  releaseChannel: 'PILOT',
  operationalMode: 'LOCAL_FIRST'
});

function normalize(value) {
  return String(value || '').trim();
}

function normalizeUpper(value) {
  return normalize(value).toUpperCase();
}

function featureFlagEnabled(env = process.env) {
  return normalize(env.RESTAURANT_LOCAL_FIRST_P14_ENABLED).toLowerCase() === 'true';
}

function resolveDenialReason(checks) {
  if (!checks.featureFlag) return 'FEATURE_FLAG_DISABLED';
  if (!checks.tenant) return 'TENANT_NOT_ALLOWED';
  if (!checks.installation) return 'INSTALLATION_NOT_ALLOWED';
  if (!checks.channel) return 'CHANNEL_NOT_ALLOWED';
  if (!checks.mode) return 'MODE_NOT_ALLOWED';
  return null;
}

function evaluateRestaurantLocalFirstP14(input = {}, env = process.env) {
  const tenantSubdomain = normalize(input.tenantSubdomain).toLowerCase();
  const installationId = normalizeUpper(input.installationId);
  const releaseChannel = normalizeUpper(input.releaseChannel);
  const operationalMode = normalizeUpper(input.operationalMode);

  const checks = Object.freeze({
    featureFlag: featureFlagEnabled(env),
    tenant: tenantSubdomain === PILOT_CONTRACT.tenantSubdomain,
    installation: installationId === PILOT_CONTRACT.installationId,
    channel: releaseChannel === PILOT_CONTRACT.releaseChannel,
    mode: operationalMode === PILOT_CONTRACT.operationalMode
  });

  const denialReason = resolveDenialReason(checks);

  return Object.freeze({
    enabled: denialReason === null,
    denialReason,
    phase: PILOT_CONTRACT.phase,
    contract: PILOT_CONTRACT,
    requested: Object.freeze({
      tenantSubdomain,
      installationId,
      releaseChannel,
      operationalMode
    }),
    checks
  });
}

function assertRestaurantLocalFirstP14(input = {}, env = process.env) {
  const result = evaluateRestaurantLocalFirstP14(input, env);
  if (result.enabled) return result;

  const error = new Error(`P14 local-first denied: ${result.denialReason}`);
  error.code = 'RESTAURANT_LOCAL_FIRST_P14_DENIED';
  error.details = result;
  throw error;
}

module.exports = {
  PILOT_CONTRACT,
  featureFlagEnabled,
  evaluateRestaurantLocalFirstP14,
  assertRestaurantLocalFirstP14
};
