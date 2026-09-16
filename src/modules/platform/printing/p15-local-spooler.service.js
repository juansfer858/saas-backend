'use strict';

const http = require('node:http');

function text(value) { return String(value ?? '').trim(); }
function enabled(env = process.env) { return text(env.VANTIX_P15_LOCAL_RUNTIME).toLowerCase() === 'true'; }

function postJson(url, body, headers = {}, timeoutMs = 8000) {
  const target = new URL(url);
  const payload = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request({
      method: 'POST',
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      headers: {
        'content-type': 'application/json',
        'content-length': payload.length,
        ...headers
      },
      timeout: timeoutMs
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed = {};
        try { parsed = raw ? JSON.parse(raw) : {}; } catch {}
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed);
        const error = new Error(parsed.error || `Spooler local HTTP ${res.statusCode}`);
        error.code = parsed.code || 'P15_LOCAL_SPOOLER_HTTP_ERROR';
        error.status = res.statusCode;
        reject(error);
      });
    });
    req.once('timeout', () => req.destroy(Object.assign(new Error('Spooler local no respondió a tiempo'), { code: 'P15_LOCAL_SPOOLER_TIMEOUT' })));
    req.once('error', reject);
    req.end(payload);
  });
}

async function dispatchDirectedJobs(directed, env = process.env) {
  if (!enabled(env)) return null;
  const entries = Array.isArray(directed?.entries) ? directed.entries : [];
  if (!entries.length) return { ok: true, skipped: 'NO_LOCAL_PRINT_ENTRIES', results: [] };
  const port = Number(env.P15_PRINT_PORT || 18815);
  const token = text(env.P15_PRINT_TOKEN);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('P15_PRINT_PORT inválido.');
  if (!token) throw new Error('P15_PRINT_TOKEN no configurado para impresión local.');
  const response = await postJson(`http://127.0.0.1:${port}/print/batch`, { entries }, { 'x-vantix-print-token': token });
  if (!response?.ok) {
    const error = new Error('Uno o más trabajos de impresión local fallaron.');
    error.code = 'P15_LOCAL_PRINT_BATCH_FAILED';
    error.details = response;
    throw error;
  }
  return response;
}

module.exports = { enabled, postJson, dispatchDirectedJobs };
