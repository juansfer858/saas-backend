'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const MARKER = 'VANTIX_EDGE_QR_PRODUCT_NOTES_V61';
const target = require.resolve('./offline-qr-self-order');
let source = fs.readFileSync(target, 'utf8');

function requiredReplace(needle, replacement, label) {
  if (!source.includes(needle)) throw new Error(`${MARKER}_${label}_TARGET_MISSING`);
  source = source.replace(needle, () => replacement);
}

// Conserva V54: durante las pruebas no se exige PIN de cuatro dígitos.
const visitSyncGate = "  if (!session.visitCode) throw edgeError(409, 'EDGE_QR_VISIT_NOT_SYNCED', 'La visita de esta mesa todavía no estaba sincronizada cuando se perdió Internet. Pídele al mesero que registre el pedido desde su tablet.');\n";
requiredReplace(visitSyncGate, "  // V54 pruebas: el autopedido directo no depende del PIN sincronizado.\n", 'V54_VISIT_SYNC');

const codeGate = "  const code = String(input.code || '').trim();\n  if (!/^\\d{4}$/.test(code)) throw edgeError(400, 'EDGE_QR_VISIT_CODE_REQUIRED', 'El código debe tener 4 dígitos');\n";
requiredReplace(codeGate, "  const code = String(session.visitCode || '').trim(); // V54: PIN no requerido en pruebas.\n", 'V54_CODE');
requiredReplace('  if (!safeEqual(session.visitCode, code)) {', '  if (false && !safeEqual(session.visitCode, code)) {', 'V54_COMPARE');

const oldInit = "else{$('#auth').classList.remove('hidden');seats()}";
const newInit = "else{try{const d=await api('/autorizar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({seatNumber:seat})});localStorage.setItem(KEY,d.visitToken);ctx=await api('/context');seat=Number(ctx.visit.seatNumber||1);person();$('#menuPanel').classList.remove('hidden');categories();products()}catch(e){document.querySelector('.shell').insertAdjacentHTML('beforeend','<div class=\\\"error\\\">'+escapeHtml(e.message)+'</div>')}}";
requiredReplace(oldInit, newInit, 'V54_BROWSER');

// V61: la infraestructura local ya acepta item.notes (máx. 300). Se agrega la UI
// de nota por producto y se incluye esa nota en el payload del pedido local.
requiredReplace(
  "const basket=new Map();const $=s=>document.querySelector(s);",
  "const basket=new Map();const itemNotes=new Map();const $=s=>document.querySelector(s);",
  'BASKET_NOTES'
);
requiredReplace(
  ".line{display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid #eadfce}.sheet .secondary",
  ".line{display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid #eadfce}.note{display:grid;gap:5px;margin-top:8px}.note small{color:#6f655b;font-weight:900}.note textarea{width:100%;min-height:62px;padding:9px 10px;border:1px solid #d8c9b6;border-radius:11px;background:#fff;font:inherit;line-height:1.35;resize:vertical}.sheet .secondary",
  'NOTE_STYLE'
);
requiredReplace(
  "function setQty(id,q){if(q)basket.set(id,q);else basket.delete(id);products()}",
  "function setQty(id,q){if(q)basket.set(id,q);else{basket.delete(id);itemNotes.delete(id)}products()}",
  'NOTE_ZERO_CLEANUP'
);
requiredReplace(
  "return '<div class=\"line\"><span>'+escapeHtml(row.product.nombre)+' × '+q+'</span><b>'+money(lineTotal(row,q))+'</b></div>'",
  "return '<div class=\"line\"><div><span>'+escapeHtml(row.product.nombre)+' × '+q+'</span><label class=\"note\"><small>Nota para cocina (opcional)</small><textarea maxlength=\"300\" data-note=\"'+escapeHtml(id)+'\" placeholder=\"Ej. sin cebolla, salsa aparte…\">'+escapeHtml(itemNotes.get(id)||'')+'</textarea></label></div><b>'+money(lineTotal(row,q))+'</b></div>'",
  'REVIEW_NOTE'
);
requiredReplace(
  "$('#cancel').onclick=()=>$('#overlay').classList.add('hidden');$('#send').onclick=send}",
  "document.querySelectorAll('[data-note]').forEach(field=>field.addEventListener('input',()=>{const v=String(field.value||'').slice(0,300);if(v.trim())itemNotes.set(field.dataset.note,v);else itemNotes.delete(field.dataset.note)}));$('#cancel').onclick=()=>$('#overlay').classList.add('hidden');$('#send').onclick=send}",
  'NOTE_BIND'
);
requiredReplace(
  "items:[...basket].map(([menuItemId,quantity])=>({menuItemId,quantity})),confirmedTotal:s.total",
  "items:[...basket].map(([menuItemId,quantity])=>({menuItemId,quantity,notes:String(itemNotes.get(menuItemId)||'').trim()||null})),confirmedTotal:s.total",
  'PAYLOAD_NOTES'
);
requiredReplace(
  "basket.clear();products();$('#overlay').innerHTML=",
  "basket.clear();itemNotes.clear();products();$('#overlay').innerHTML=",
  'SUCCESS_CLEAR'
);

source = source.replace("'use strict';", "'use strict';\nconst VANTIX_EDGE_QR_DIRECT_TEST_V54 = true;\nconst VANTIX_EDGE_QR_PRODUCT_NOTES_V61 = true;");
if (!source.includes(MARKER) || !source.includes('data-note') || !source.includes('notes:String(itemNotes.get(menuItemId)')) {
  throw new Error(`${MARKER}_PATCH_NOT_APPLIED`);
}

const patched = new Module(target, module.parent);
patched.filename = target;
patched.paths = Module._nodeModulePaths(path.dirname(target));
require.cache[target] = patched;
patched._compile(source, target);

module.exports = patched.exports;
