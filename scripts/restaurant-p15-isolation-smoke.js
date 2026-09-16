'use strict';

const assert = require('node:assert/strict');

const P15 = Object.freeze({
  httpPort: 8815,
  postgresPort: 55435,
  database: 'vantix_restaurant_p15_lab',
  installDir: String.raw`C:\ProgramData\VantixGC\Restaurant-P15-Lab`,
  installationId: 'HOME-PILOT-P15'
});

const RESERVED = Object.freeze({
  edgeHttpPort: 8788,
  p13HttpPort: 8790,
  p13PostgresPort: 55432,
  p14HttpPort: 8791,
  p14PostgresPort: 55433
});

assert.equal(P15.httpPort, 8815);
assert.equal(P15.postgresPort, 55435);
assert.notEqual(P15.httpPort, RESERVED.edgeHttpPort);
assert.notEqual(P15.httpPort, RESERVED.p13HttpPort);
assert.notEqual(P15.httpPort, RESERVED.p14HttpPort);
assert.notEqual(P15.postgresPort, RESERVED.p13PostgresPort);
assert.notEqual(P15.postgresPort, RESERVED.p14PostgresPort);
assert.match(P15.installDir, /Restaurant-P15-Lab$/);
assert.equal(P15.installationId, 'HOME-PILOT-P15');

console.log('RESTAURANT_P15_ISOLATION_OK');
