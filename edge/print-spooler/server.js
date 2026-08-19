const http = require('node:http');
const { printJob, printBatch } = require('./escpos');

const HOST = process.env.SPOOLER_HOST || '127.0.0.1';
const PORT = Number(process.env.SPOOLER_PORT || 18787);
const TOKEN = process.env.SPOOLER_SHARED_TOKEN || '';
const MAX_BODY = 1024 * 1024;

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function authorized(req) {
  if (!TOKEN) return true;
  return req.headers['x-vantix-print-token'] === TOKEN;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Trabajo de impresión demasiado grande'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(Object.assign(new Error('JSON inválido'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function validateTarget(target) {
  if (!target || !target.host) throw Object.assign(new Error('Destino LAN requerido'), { status: 400 });
  const port = Number(target.port || 9100);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Object.assign(new Error('Puerto LAN inválido'), { status: 400 });
  return { ...target, port };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok: true, service: 'VantixGC Local ESC-POS Spooler', internetRequired: false });
    if (!authorized(req)) return json(res, 401, { ok: false, error: 'Token de impresión inválido' });

    if (req.method === 'POST' && req.url === '/print') {
      const body = await readJson(req);
      const target = validateTarget(body.target);
      return json(res, 200, { ok: true, data: await printJob(target, body.job || {}) });
    }

    if (req.method === 'POST' && req.url === '/print/batch') {
      const body = await readJson(req);
      if (!Array.isArray(body.entries) || !body.entries.length) return json(res, 400, { ok: false, error: 'entries es obligatorio' });
      const entries = body.entries.map((entry) => ({ target: validateTarget(entry.target), job: entry.job || {} }));
      const results = await printBatch(entries);
      return json(res, results.every((x) => x.ok) ? 200 : 207, { ok: results.every((x) => x.ok), results });
    }

    return json(res, 404, { ok: false, error: 'Ruta no encontrada' });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, error: error.message, code: error.code || 'SPOOLER_ERROR' });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => console.log(`VantixGC Local ESC-POS Spooler ${HOST}:${PORT}`));
}

module.exports = { server, readJson, validateTarget };
