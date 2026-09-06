const net = require('node:net');
const { listWindowsPrinters, sendWindowsRawPrint } = require('./windows-printer');

const ESC = 0x1b;
const GS = 0x1d;
const ESC_POS_CP850_TABLE = 2;
const CP850_EXTENDED = '\u00c7\u00fc\u00e9\u00e2\u00e4\u00e0\u00e5\u00e7\u00ea\u00eb\u00e8\u00ef\u00ee\u00ec\u00c4\u00c5\u00c9\u00e6\u00c6\u00f4\u00f6\u00f2\u00fb\u00f9\u00ff\u00d6\u00dc\u00f8\u00a3\u00d8\u00d7\u0192\u00e1\u00ed\u00f3\u00fa\u00f1\u00d1\u00aa\u00ba\u00bf\u00ae\u00ac\u00bd\u00bc\u00a1\u00ab\u00bb\u2591\u2592\u2593\u2502\u2524\u00c1\u00c2\u00c0\u00a9\u2563\u2551\u2557\u255d\u00a2\u00a5\u2510\u2514\u2534\u252c\u251c\u2500\u253c\u00e3\u00c3\u255a\u2554\u2569\u2566\u2560\u2550\u256c\u00a4\u00f0\u00d0\u00ca\u00cb\u00c8\u0131\u00cd\u00ce\u00cf\u2518\u250c\u2588\u2584\u00a6\u00cc\u2580\u00d3\u00df\u00d4\u00d2\u00f5\u00d5\u00b5\u00fe\u00de\u00da\u00db\u00d9\u00fd\u00dd\u00af\u00b4\u00ad\u00b1\u2017\u00be\u00b6\u00a7\u00f7\u00b8\u00b0\u00a8\u00b7\u00b9\u00b3\u00b2\u25a0\u00a0';
const CP850_REVERSE = new Map(Array.from(CP850_EXTENDED, (char, index) => [char, 0x80 + index]));
const RESTAURANT_COMMAND_LARGE_V2 = 'RESTAURANT_COMMAND_LARGE_V2';
const RESTAURANT_POS_RECEIPT_TYPE = 'RESTAURANT_POS_V1';
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

function encodeCp850(value) {
  const source = String(value ?? '').normalize('NFC');
  const bytes = [];
  for (const char of source) {
    const point = char.codePointAt(0);
    if (point <= 0x7f) {
      bytes.push(point);
      continue;
    }
    const encoded = CP850_REVERSE.get(char);
    if (encoded !== undefined) {
      bytes.push(encoded);
      continue;
    }
    const decomposed = char.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    let wroteAscii = false;
    if (decomposed && decomposed !== char) {
      const ascii = Array.from(decomposed).filter((candidate) => candidate.codePointAt(0) <= 0x7f);
      if (ascii.length) {
        for (const candidate of ascii) bytes.push(candidate.codePointAt(0));
        wroteAscii = true;
      }
    }
    if (!wroteAscii) bytes.push(0x3f);
  }
  return Buffer.from(bytes);
}

function selectCp850() {
  return Buffer.from([ESC, 0x74, ESC_POS_CP850_TABLE]);
}

function text(value) {
  return encodeCp850(value);
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
  const chunks = [Buffer.from([ESC, 0x40]), selectCp850()];
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
  const chunks = [Buffer.from([ESC, 0x40]), selectCp850()];
  const isRestaurantPos = String(job.receiptType || '').trim().toUpperCase() === RESTAURANT_POS_RECEIPT_TYPE;
  chunks.push(align(1));
  chunks.push(bold(true));
  if (isRestaurantPos) chunks.push(size(0x11));
  chunks.push(text(job.title || 'VantixGC'));
  chunks.push(text('\n'));
  if (isRestaurantPos) chunks.push(size(0x00));
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
  ESC_POS_CP850_TABLE,
  encodeCp850,
  selectCp850,
  RESTAURANT_COMMAND_LARGE_V2,
  RESTAURANT_POS_RECEIPT_TYPE,
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
