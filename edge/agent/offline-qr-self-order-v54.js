'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const target = require.resolve('./offline-qr-self-order');
let source = fs.readFileSync(target, 'utf8');

const visitSyncGate = "  if (!session.visitCode) throw edgeError(409, 'EDGE_QR_VISIT_NOT_SYNCED', 'La visita de esta mesa todavía no estaba sincronizada cuando se perdió Internet. Pídele al mesero que registre el pedido desde su tablet.');\n";
if (!source.includes(visitSyncGate)) throw new Error('VANTIX_EDGE_QR_DIRECT_V54_VISIT_SYNC_GATE_MISSING');
source = source.replace(visitSyncGate, "  // V54 pruebas: el autopedido directo no depende del PIN sincronizado.\n");

const codeGate = "  const code = String(input.code || '').trim();\n  if (!/^\\d{4}$/.test(code)) throw edgeError(400, 'EDGE_QR_VISIT_CODE_REQUIRED', 'El código debe tener 4 dígitos');\n";
if (!source.includes(codeGate)) throw new Error('VANTIX_EDGE_QR_DIRECT_V54_CODE_GATE_MISSING');
source = source.replace(codeGate, "  const code = String(session.visitCode || '').trim(); // V54: PIN no requerido en pruebas.\n");

const compareGate = '  if (!safeEqual(session.visitCode, code)) {';
if (!source.includes(compareGate)) throw new Error('VANTIX_EDGE_QR_DIRECT_V54_COMPARE_GATE_MISSING');
source = source.replace(compareGate, '  if (false && !safeEqual(session.visitCode, code)) {');

const oldInit = "else{$('#auth').classList.remove('hidden');seats()}";
const newInit = "else{try{const d=await api('/autorizar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({seatNumber:seat})});localStorage.setItem(KEY,d.visitToken);ctx=await api('/context');seat=Number(ctx.visit.seatNumber||1);person();$('#menuPanel').classList.remove('hidden');categories();products()}catch(e){document.querySelector('.shell').insertAdjacentHTML('beforeend','<div class=\\\"error\\\">'+escapeHtml(e.message)+'</div>')}}";
if (!source.includes(oldInit)) throw new Error('VANTIX_EDGE_QR_DIRECT_V54_BROWSER_GATE_MISSING');
source = source.replace(oldInit, newInit);

source = source.replace("'use strict';", "'use strict';\nconst VANTIX_EDGE_QR_DIRECT_TEST_V54 = true;");
if (!source.includes('VANTIX_EDGE_QR_DIRECT_TEST_V54')) throw new Error('VANTIX_EDGE_QR_DIRECT_V54_PATCH_NOT_APPLIED');

const patched = new Module(target, module.parent);
patched.filename = target;
patched.paths = Module._nodeModulePaths(path.dirname(target));
require.cache[target] = patched;
patched._compile(source, target);

module.exports = patched.exports;
