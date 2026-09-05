const net = require('node:net');
const { listWindowsPrinters, sendWindowsRawPrint } = require('./windows-printer');

const ESC = 0x1b;
const GS = 0x1d;
const RESTAURANT_COMMAND_LARGE_V2 = 'RESTAURANT_COMMAND_LARGE_V2';
const DEFAULT_COMMAND_LAYOUT = Object.freeze({
  itemAlign: 'CENTER',
  noteAlign: 'CENTER',
  seatAlign: 'CENTER',
  headerSize: 'DOUBLE',
  itemSize: 'TALL',
  noteSize: 'TALL',
  showTopTime: false,
  showBottomDateTime: true,
  showTrace: true,
  showSeat: true,
  separatorStyle: 'DOUBLE',
  blankLinesBetweenItems: 1
});

function text(value) {
  return Buffer.from(String(value ?? ''), 'utf8');
}

function align(value) {
  return Buffer.from([ESC, 0x61, value]);
}

function bold(enabled) {
  return Buffer.from([ESC, 0x45, enabled ? 0x01 : 0x00]);
}

function size(value) {
  return Buffer.from([GS, 0x21, value]);
}

function commandDateTime(value) {
  if (!value) return { date: '', time: '' };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: '', time: '' };
  return {
    date: new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date),
    time: new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true }).format(date)
  };
}

function layoutEnum(value, allowed, fallback) {
  const normalized = String(value || '').trim().toUpperCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizeCommandLayout(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    itemAlign: layoutEnum(input.itemAlign, ['LEFT', 'CENTER'], DEFAULT_COMMAND_LAYOUT.itemAlign),
    noteAlign: layoutEnum(input.noteAlign, ['LEFT', 'CENTER'], DEFAULT_COMMAND_LAYOUT.noteAlign),
    seatAlign: layoutEnum(input.seatAlign, ['LEFT', 'CENTER'], DEFAULT_COMMAND_LAYOUT.seatAlign),
    headerSize: layoutEnum(input.headerSize, ['NORMAL', 'DOUBLE'], DEFAULT_COMMAND_LAYOUT.headerSize),
    itemSize: layoutEnum(input.itemSize, ['NORMAL', 'TALL', 'DOUBLE'], DEFAULT_COMMAND_LAYOUT.itemSize),
    noteSize: layoutEnum(input.noteSize, ['NORMAL', 'TALL', 'DOUBLE'], DEFAULT_COMMAND_LAYOUT.noteSize),
    showTopTime: input.showTopTime === undefined ? DEFAULT_COMMAND_LAYOUT.showTopTime : Boolean(input.showTopTime),
    showBottomDateTime: input.showBottomDateTime === undefined ? DEFAULT_COMMAND_LAYOUT.showBottomDateTime : Boolean(input.showBottomDateTime),
    showTrace: input.showTrace === undefined ? DEFAULT_COMMAND_LAYOUT.showTrace : Boolean(input.showTrace),
    showSeat: input.showSeat === undefined ? DEFAULT_COMMAND_LAYOUT.showSeat : Boolean(input.showSeat),
    separatorStyle: layoutEnum(input.separatorStyle, ['DOUBLE', 'SINGLE', 'NONE'], DEFAULT_COMMAND_LAYOUT.separatorStyle),
    blankLinesBetweenItems: Math.max(0, Math.min(2, Number.isFinite(Number(input.blankLinesBetweenItems)) ? Math.trunc(Number(input.blankLinesBetweenItems)) : DEFAULT_COMMAND_LAYOUT.blankLinesBetweenItems))
  };
}

function alignCode(value) {
  return String(value).toUpperCase() === 'CENTER' ? 1 : 0;
}

function sizeCode(value) {
  const normalized = String(value || '').toUpperCase();
  if (normalized === 'DOUBLE') return 0x11;
  if (normalized === 'TALL') return 0x01;
  return 0x00;
}

function commandSeparator(format, style) {
  if (style === 'NONE') return '';
  const length = format === 'TERMICA_58' ? 24 : 32;
  return (style === 'SINGLE' ? '-' : '=').repeat(length);
}

function buildRestaurantCommandLargeV2(job = {}) {
  const chunks = [Buffer.from([ESC, 0x40])];
  const layout = normalizeCommandLayout(job.layout);
  const format = String(job.paperFormat || 'TERMICA_80').toUpperCase();
  const separator = commandSeparator(format, layout.separatorStyle);
  const table = String(job.tableLabel || job.title || 'MESA').replace(/^COMANDA\s*[·-]?\s*/i, '').trim().toUpperCase();
  const station = String(job.stationLabel || 'COCINA').trim().toUpperCase();
  const when = commandDateTime(job.createdAt);

  chunks.push(align(1), bold(true), size(sizeCode(layout.headerSize)));
  chunks.push(text(`${table}\n`));
  chunks.push(text(`${station}\n`));
  chunks.push(size(0x00), bold(false));
  if (separator) chunks.push(text(`${separator}\n`));
  if (layout.showTopTime && when.time) {
    chunks.push(align(1), bold(true), text(`${when.time}\n`), bold(false));
    if (separator) chunks.push(text(`${separator}\n`));
  }
  chunks.push(text('\n'));

  for (const line of job.lines || []) {
    if (typeof line === 'string') {
      chunks.push(align(alignCode(layout.itemAlign)), bold(true), size(sizeCode(layout.itemSize)), text(`${String(line).toUpperCase()}\n`), size(0x00), bold(false));
      chunks.push(text('\n'.repeat(layout.blankLinesBetweenItems + 1)));
      continue;
    }
    const quantity = line.quantity ?? line.qty ?? '';
    const name = String(line.name ?? line.description ?? '').trim().toUpperCase();
    if (!name) continue;
    chunks.push(align(alignCode(layout.itemAlign)), bold(true), size(sizeCode(layout.itemSize)));
    chunks.push(text(`${quantity ? `${quantity} x ` : ''}${name}\n`));
    chunks.push(size(0x00), bold(false));

    const note = String(line.note ?? line.notes ?? '').trim();
    if (note) {
      chunks.push(align(alignCode(layout.noteAlign)), bold(true), size(sizeCode(layout.noteSize)));
      chunks.push(text(`*** ${note.toUpperCase()} ***\n`));
      chunks.push(size(0x00), bold(false));
    }
    const seat = String(line.seatLabel || (line.seatNumber ? `PERSONA ${line.seatNumber}` : '')).trim();
    if (layout.showSeat && seat) {
      chunks.push(align(alignCode(layout.seatAlign)), bold(true));
      chunks.push(text(`>>> ${seat.toUpperCase()} <<<\n`));
      chunks.push(bold(false));
    }
    chunks.push(text('\n'.repeat(layout.blankLinesBetweenItems + 1)));
  }

  chunks.push(align(1), size(0x00), bold(false));
  if (separator) chunks.push(text(`${separator}\n`));
  if (layout.showTrace && job.traceLabel) chunks.push(text(`${String(job.traceLabel).toUpperCase()}\n`));
  if (layout.showBottomDateTime && (when.date || when.time)) chunks.push(text(`${[when.date, when.time].filter(Boolean).join(' · ')}\n`));
  chunks.push(size(0x00), bold(false), align(0));
  chunks.push(text('\n\n\n'));
  if (job.cut !== false) chunks.push(Buffer.from([GS, 0x56, 0x00]));
  return Buffer.concat(chunks);
}

function buildGenericEscPos(job = {}) {
  const chunks = [Buffer.from([ESC, 0x40])];
  chunks.push(align(1));
  chunks.push(bold(true));
  chunks.push(text(job.title || 'VantixGC'));
  chunks.push(text('\n'));
  chunks.push(bold(false));
  chunks.push(align(0));

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
  if (job.cut !== false) chunks.push(Buffer.from([GS, 0x56, 0x00]));
  return Buffer.concat(chunks);
}

function buildEscPos(job = {}) {
  if (job.template === RESTAURANT_COMMAND_LARGE_V2) return buildRestaurantCommandLargeV2(job);
  return buildGenericEscPos(job);
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
      else resolve({ ok: true, transport: 'LAN', host, port, bytes: buffer.length });
    };
    socket.setTimeout(timeoutMs, () => finish(Object.assign(new Error('Tiempo de espera agotado al imprimir'), { code: 'PRINT_TIMEOUT' })));
    socket.on('error', finish);
    socket.on('connect', () => socket.end(buffer));
    socket.on('close', (hadError) => { if (!hadError) finish(); });
  });
}

function targetTransport(target = {}) {
  return String(target.transport || 'LAN').trim().toUpperCase();
}

async function sendToTarget(target, buffer) {
  const transport = targetTransport(target);
  if (transport === 'WINDOWS') {
    return sendWindowsRawPrint({ printerName: target.host || target.queueName, buffer });
  }
  if (transport !== 'LAN') {
    throw Object.assign(new Error(`Transporte de impresión Edge no soportado: ${transport}`), { code: 'PRINT_TRANSPORT_UNSUPPORTED' });
  }
  return sendRawPrint({ host: target.host, port: target.port || 9100, buffer });
}

async function printJob(target, job) {
  const copies = Math.max(1, Math.min(Number(job.copies || 1), 10));
  const buffer = buildEscPos(job);
  const results = [];
  for (let i = 0; i < copies; i += 1) results.push(await sendToTarget(target, buffer));
  const transport = targetTransport(target);
  return {
    ok: true,
    target: {
      name: target.name || null,
      transport,
      host: target.host || null,
      port: transport === 'LAN' ? Number(target.port || 9100) : null,
      queueName: transport === 'WINDOWS' ? String(target.host || target.queueName || '') : null
    },
    copies,
    bytesPerCopy: buffer.length,
    results
  };
}

async function printBatch(entries) {
  const settled = await Promise.allSettled((entries || []).map((entry) => printJob(entry.target, entry.job)));
  return settled.map((result, index) => result.status === 'fulfilled'
    ? { ok: true, index, data: result.value }
    : { ok: false, index, error: result.reason?.message || String(result.reason), code: result.reason?.code || 'PRINT_ERROR' });
}

module.exports = {
  RESTAURANT_COMMAND_LARGE_V2,
  DEFAULT_COMMAND_LAYOUT,
  normalizeCommandLayout,
  buildRestaurantCommandLargeV2,
  buildEscPos,
  sendRawPrint,
  targetTransport,
  sendToTarget,
  listWindowsPrinters,
  sendWindowsRawPrint,
  printJob,
  printBatch
};