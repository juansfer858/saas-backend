'use strict';

process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';

const assert = require('node:assert/strict');
const http = require('node:http');
const { app } = require('../src/app');

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
    const response = await getText(`http://127.0.0.1:${port}/app/restaurant-ui.js?v=v60-regression`);
    assert.equal(response.status, 200, `restaurant-ui.js HTTP ${response.status}`);
    const source = response.body;

    assert.equal(response.headers['x-vantixgc-global-product-search'], 'v57-all-menu');
    assert.equal(response.headers['x-vantixgc-account-attention'], 'v58-account-attention');
    assert.equal(response.headers['x-vantixgc-table-enable'], 'v56-order-first');
    assert.match(source, /VANTIX_RESTAURANT_GLOBAL_PRODUCT_SEARCH_V57/);
    assert.match(source, /\$\$\('\[data-waiter-category\]'\)\.forEach/);

    const lines = source.split(/\r?\n/);
    const singleDollar = [];
    for (let i = 0; i < lines.length; i += 1) {
      const text = lines[i];
      if (/(^|[^$])\$\([^\n]*\)\.forEach/.test(text)) {
        singleDollar.push({ line:i + 1, text:text.slice(0, 500) });
      }
    }
    assert.deepEqual(singleDollar, [], `El asset final todavía contiene $().forEach: ${JSON.stringify(singleDollar)}`);

    console.log('RESTAURANT PC MESERO V60 FINAL ASSET FOREACH CONTRACT OK', JSON.stringify({
      bytes:Buffer.byteLength(source),
      categoryBinding:'$$',
      singleDollarForEach:0,
      v57:response.headers['x-vantixgc-global-product-search'],
      v58:response.headers['x-vantixgc-account-attention'],
      tableEnable:response.headers['x-vantixgc-table-enable']
    }));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exit(1); });
