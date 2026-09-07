'use strict';

process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';

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
    const response = await getText(`http://127.0.0.1:${port}/app/restaurant-ui.js?v=v60-diagnostic`);
    if (response.status !== 200) throw new Error(`restaurant-ui.js HTTP ${response.status}`);
    const source = response.body;
    console.log('ASSET_BYTES', Buffer.byteLength(source));
    console.log('HEADERS', JSON.stringify({
      v57:response.headers['x-vantixgc-global-product-search'] || null,
      v58:response.headers['x-vantixgc-account-attention'] || null,
      tableEnable:response.headers['x-vantixgc-table-enable'] || null
    }));

    const lines = source.split(/\r?\n/);
    const hits = [];
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].includes('.forEach')) {
        hits.push({ line:i + 1, text:lines[i].slice(0, 500) });
      }
    }
    console.log('FOREACH_LINES', JSON.stringify(hits, null, 2));

    const singleDollar = [];
    for (let i = 0; i < lines.length; i += 1) {
      const text = lines[i];
      if (/(^|[^$])\$\([^\n]*\)\.forEach/.test(text)) singleDollar.push({ line:i + 1, text:text.slice(0, 500) });
    }
    console.log('SINGLE_DOLLAR_FOREACH', JSON.stringify(singleDollar, null, 2));
    if (!singleDollar.length) console.log('NO_LITERAL_SINGLE_DOLLAR_FOREACH');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exit(1); });
