const net = require('node:net');

const ESC = 0x1b;
const GS = 0x1d;

function text(value) {
  return Buffer.from(String(value ?? ''), 'utf8');
}

function buildEscPos(job = {}) {
  const chunks = [Buffer.from([ESC, 0x40])]; // Initialize printer.
  chunks.push(Buffer.from([ESC, 0x61, 0x01])); // Center.
  chunks.push(Buffer.from([ESC, 0x45, 0x01])); // Bold on.
  chunks.push(text(job.title || 'VantixGC'));
  chunks.push(text('\n'));
  chunks.push(Buffer.from([ESC, 0x45, 0x00]));
  chunks.push(Buffer.from([ESC, 0x61, 0x00])); // Left.

  for (const line of job.lines || []) {
    if (typeof line === 'string') chunks.push(text(`${line}\n`));
    else {
      const qty = line.quantity ?? line.qty ?? '';
      const name = line.name ?? line.description ?? '';
      const note = line.note ? ` | ${line.note}` : '';
      chunks.push(text(`${qty ? `${qty} x ` : ''}${name}${note}\n`));
    }
  }
  if (job.footer) chunks.push(text(`\n${job.footer}\n`));
  chunks.push(text('\n\n\n'));
  if (job.cut !== false) chunks.push(Buffer.from([GS, 0x56, 0x00])); // Full cut.
  return Buffer.concat(chunks);
}

function sendRawPrint({ host, port = 9100, buffer, timeoutMs = 5000 }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve({ ok: true, host, port, bytes: buffer.length });
    };
    socket.setTimeout(timeoutMs, () => finish(Object.assign(new Error('Tiempo de espera agotado al imprimir'), { code: 'PRINT_TIMEOUT' })));
    socket.on('error', finish);
    socket.on('connect', () => socket.end(buffer));
    socket.on('close', (hadError) => { if (!hadError) finish(); });
  });
}

async function printJob(target, job) {
  const copies = Math.max(1, Math.min(Number(job.copies || 1), 10));
  const buffer = buildEscPos(job);
  const results = [];
  for (let i = 0; i < copies; i += 1) results.push(await sendRawPrint({ host: target.host, port: target.port || 9100, buffer }));
  return { target: { name: target.name || null, host: target.host, port: target.port || 9100 }, copies, bytesPerCopy: buffer.length, results };
}

async function printBatch(entries) {
  const settled = await Promise.allSettled((entries || []).map((entry) => printJob(entry.target, entry.job)));
  return settled.map((result, index) => result.status === 'fulfilled'
    ? { ok: true, index, data: result.value }
    : { ok: false, index, error: result.reason?.message || String(result.reason), code: result.reason?.code || 'PRINT_ERROR' });
}

module.exports = { buildEscPos, sendRawPrint, printJob, printBatch };
