'use strict';

const assert = require('node:assert/strict');
const {
  PILOT_CONTRACT,
  featureFlagEnabled,
  evaluateRestaurantLocalFirstP14,
  assertRestaurantLocalFirstP14
} = require('../src/modules/restaurant/restaurant-local-first-p14-gate');

const exactPilot = {
  tenantSubdomain: 'demo-restaurante',
  installationId: 'HOME-PILOT-01',
  releaseChannel: 'PILOT',
  operationalMode: 'LOCAL_FIRST'
};

function evaluate(input, enabled = true) {
  return evaluateRestaurantLocalFirstP14(input, {
    RESTAURANT_LOCAL_FIRST_P14_ENABLED: enabled ? 'true' : 'false'
  });
}

function main() {
  assert.equal(Object.isFrozen(PILOT_CONTRACT), true);
  assert.deepEqual(PILOT_CONTRACT, {
    phase: 'P14',
    tenantSubdomain: 'demo-restaurante',
    installationId: 'HOME-PILOT-01',
    releaseChannel: 'PILOT',
    operationalMode: 'LOCAL_FIRST'
  });

  assert.equal(featureFlagEnabled({}), false);
  assert.equal(featureFlagEnabled({ RESTAURANT_LOCAL_FIRST_P14_ENABLED: 'false' }), false);
  assert.equal(featureFlagEnabled({ RESTAURANT_LOCAL_FIRST_P14_ENABLED: 'TRUE' }), true);

  assert.equal(evaluate(exactPilot, false).enabled, false);
  assert.equal(evaluate(exactPilot, false).denialReason, 'FEATURE_FLAG_DISABLED');

  const exact = evaluate(exactPilot, true);
  assert.equal(exact.enabled, true);
  assert.equal(exact.denialReason, null);
  assert.equal(exact.phase, 'P14');

  assert.equal(evaluate({ ...exactPilot, tenantSubdomain: 'demo-core' }).enabled, false);
  assert.equal(evaluate({ ...exactPilot, tenantSubdomain: 'demo-core' }).denialReason, 'TENANT_NOT_ALLOWED');

  assert.equal(evaluate({ ...exactPilot, tenantSubdomain: 'restaurante-real' }).enabled, false);
  assert.equal(evaluate({ ...exactPilot, installationId: 'RESTAURANTE-PROD-01' }).enabled, false);
  assert.equal(evaluate({ ...exactPilot, installationId: 'RESTAURANTE-PROD-01' }).denialReason, 'INSTALLATION_NOT_ALLOWED');

  assert.equal(evaluate({ ...exactPilot, releaseChannel: 'STABLE' }).enabled, false);
  assert.equal(evaluate({ ...exactPilot, releaseChannel: 'STABLE' }).denialReason, 'CHANNEL_NOT_ALLOWED');

  assert.equal(evaluate({ ...exactPilot, operationalMode: 'CLOUD_FIRST' }).enabled, false);
  assert.equal(evaluate({ ...exactPilot, operationalMode: 'CLOUD_FIRST' }).denialReason, 'MODE_NOT_ALLOWED');

  assert.equal(evaluate({}).enabled, false);
  assert.equal(evaluate({}).denialReason, 'TENANT_NOT_ALLOWED');

  const normalized = evaluate({
    tenantSubdomain: ' DEMO-RESTAURANTE ',
    installationId: ' home-pilot-01 ',
    releaseChannel: ' pilot ',
    operationalMode: ' local_first '
  });
  assert.equal(normalized.enabled, true);

  assert.throws(
    () => assertRestaurantLocalFirstP14(
      { ...exactPilot, releaseChannel: 'STABLE' },
      { RESTAURANT_LOCAL_FIRST_P14_ENABLED: 'true' }
    ),
    (error) => error &&
      error.code === 'RESTAURANT_LOCAL_FIRST_P14_DENIED' &&
      error.details?.denialReason === 'CHANNEL_NOT_ALLOWED'
  );

  assert.equal(
    assertRestaurantLocalFirstP14(
      exactPilot,
      { RESTAURANT_LOCAL_FIRST_P14_ENABLED: 'true' }
    ).enabled,
    true
  );

  console.log('P14_LOCAL_FIRST_PILOT_GATE_OK');
}

main();
