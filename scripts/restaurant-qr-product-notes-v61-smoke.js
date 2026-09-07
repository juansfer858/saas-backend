'use strict';

process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
process.env.JWT_SECRET ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.EDGE_AUTH_SECRET ||= 'edge-auth-secret-0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.TENANT_BASE_DOMAIN ||= 'example.com';
process.env.TENANT_PLATFORM_SUBDOMAINS ||= 'core';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { app } = require('../src/app');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function getText(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status:res.statusCode, headers:res.headers, body }));
    }).on('error', reject);
  });
}

(async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const port = server.address().port;
    const response = await getText(`http://127.0.0.1:${port}/app/restaurant-qr-ui.js?v=v61-notes`);
    assert.equal(response.status, 200);
    assert.equal(response.headers['x-vantixgc-qr-product-notes'], 'v61-item-notes');
    assert.equal(response.headers['x-vantixgc-global-product-search'], 'v57-all-menu');
    assert.equal(response.headers['x-vantixgc-table-enable'], 'v56-order-first');
    const source = response.body;
    assert.match(source, /VANTIX_RESTAURANT_QR_PRODUCT_NOTES_V61/);
    assert.match(source, /Nota para cocina \(opcional\)/);
    assert.match(source, /data-order-note/);
    assert.match(source, /maxlength="300"/);
    assert.match(source, /notes:String\(qrProductNotes\.get\(menuItemId\)/);
    assert.match(source, /VANTIX_RESTAURANT_GLOBAL_PRODUCT_SEARCH_V57/);
    assert.match(source, /VANTIX_RESTAURANT_TABLE_ENABLE_V56/);

    const publicBase = read('src/modules/restaurant/restaurant.public.routes.base.js');
    const service = read('src/modules/restaurant/restaurant.service.js');
    assert.match(publicBase, /notes: z\.string\(\)\.trim\(\)\.max\(300\)\.optional\(\)\.nullable\(\)/);
    assert.match(service, /notes: line\.request\.notes \|\| null/);
    assert.match(service, /notes: item\.notes \|\| null/);

    const edgePatch = read('edge/agent/offline-qr-self-order-v61.js');
    const edgeEntry = read('edge/agent/restaurant-entry-v2.js');
    const edgeBase = read('edge/agent/offline-qr-self-order.js');
    const version = JSON.parse(read('edge/version.json'));
    assert.match(edgeBase, /EDGE_QR_ITEM_NOTE_TOO_LONG/);
    assert.match(edgeBase, /notes: notes \|\| null/);
    assert.match(edgePatch, /VANTIX_EDGE_QR_PRODUCT_NOTES_V61/);
    assert.match(edgePatch, /Nota para cocina \(opcional\)/);
    assert.match(edgePatch, /data-note/);
    assert.match(edgePatch, /notes:String\(itemNotes\.get\(menuItemId\)/);
    assert.match(edgePatch, /VANTIX_EDGE_QR_DIRECT_TEST_V54/);
    assert.match(edgeEntry, /require\('\.\/offline-qr-self-order-v61'\)/);
    assert.doesNotMatch(edgeEntry, /require\('\.\/offline-qr-self-order-v54'\)/);
    assert.equal(version.version, '2.1.14-qr-product-notes.1');

    console.log('RESTAURANT QR PRODUCT NOTES V61 CLOUD + EDGE + KDS PAYLOAD CONTRACT OK');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exit(1); });
