'use strict';

const MARKER = 'VANTIX_RESTAURANT_QR_PRODUCT_NOTES_V61';
const HEADER_VALUE = 'v61-item-notes';

function requiredReplace(source, needle, replacement, label) {
  if (!source.includes(needle)) throw new Error(`${MARKER}_${label}_TARGET_NOT_FOUND`);
  return source.replace(needle, () => replacement);
}

function patchQrProductNotesSource(source) {
  let out = String(source || '');
  if (!out || out.includes(MARKER)) return out;

  const stateNeedles = [
    "  const S = { ctx:null, cart:new Map(), filter:'FEATURED', search:'', sending:false };",
    "  const S = { ctx:null, cart:new Map(), filter:'FEATURED', sending:false };"
  ];
  const stateNeedle = stateNeedles.find((needle) => out.includes(needle));
  if (!stateNeedle) throw new Error(`${MARKER}_STATE_TARGET_NOT_FOUND`);
  out = out.replace(stateNeedle, () => `${stateNeedle}\n  const qrProductNotes = new Map();\n  function ensureQrProductNoteStyles() {\n    if (document.getElementById('restaurantQrProductNotesV61Styles')) return;\n    const style = document.createElement('style');\n    style.id = 'restaurantQrProductNotesV61Styles';\n    style.textContent = '.qrv61-note{display:grid;gap:6px;margin-top:10px}.qrv61-note span{font-size:12px;font-weight:900;color:#5f564e}.qrv61-note textarea{width:100%;min-height:64px;resize:vertical;padding:10px 11px;border:1px solid #d8c9b6;border-radius:12px;background:#fff;font:inherit;line-height:1.35;color:#201c18}.qrv61-note textarea:focus{outline:2px solid rgba(239,111,36,.22);border-color:#ef6f24}.qrv61-note small{margin:0;color:#85786c;font-size:11px;font-weight:700}@media(max-width:560px){.qrv61-note textarea{min-height:58px}}';\n    document.head.appendChild(style);\n  }`);

  out = requiredReplace(
    out,
    "  function renderOrderPanel() {\n    const body = $('#orderPanelBody');\n    if (!body) return;",
    "  function renderOrderPanel() {\n    const body = $('#orderPanelBody');\n    if (!body) return;\n    ensureQrProductNoteStyles();",
    'RENDER_STYLE'
  );

  const lineNeedle = `      const item = products().find((row) => row.id === id);\n      if (!item) return '';\n      return \`<div class="qrv3-orderline">\n        <div><b>\${esc(item.product.name)}</b><small>\${money(lineTotal(item, quantity))}</small></div>`;
  const lineReplacement = `      const item = products().find((row) => row.id === id);\n      if (!item) return '';\n      const itemNote = String(qrProductNotes.get(id) || '');\n      return \`<div class="qrv3-orderline">\n        <div><b>\${esc(item.product.name)}</b><small>\${money(lineTotal(item, quantity))}</small><label class="qrv61-note"><span>Nota para cocina (opcional)</span><textarea maxlength="300" data-order-note="\${esc(id)}" placeholder="Ej. sin cebolla, salsa aparte…">\${esc(itemNote)}</textarea><small>Esta nota viaja con este producto a Cocina / Barra.</small></label></div>`;
  out = requiredReplace(out, lineNeedle, lineReplacement, 'ORDER_LINE_NOTE');

  out = requiredReplace(
    out,
    "    $$('[data-order-plus]').forEach((button) => button.addEventListener('click', () => setQuantity(button.dataset.orderPlus, 1)));\n    $$('[data-order-minus]').forEach((button) => button.addEventListener('click', () => setQuantity(button.dataset.orderMinus, -1)));",
    "    $$('[data-order-plus]').forEach((button) => button.addEventListener('click', () => setQuantity(button.dataset.orderPlus, 1)));\n    $$('[data-order-minus]').forEach((button) => button.addEventListener('click', () => setQuantity(button.dataset.orderMinus, -1)));\n    $$('[data-order-note]').forEach((field) => field.addEventListener('input', () => {\n      const value = String(field.value || '').slice(0, 300);\n      if (value.trim()) qrProductNotes.set(field.dataset.orderNote, value);\n      else qrProductNotes.delete(field.dataset.orderNote);\n    }));",
    'ORDER_NOTE_BIND'
  );

  out = requiredReplace(
    out,
    "    if (next > 0) S.cart.set(id, next);\n    else S.cart.delete(id);",
    "    if (next > 0) S.cart.set(id, next);\n    else { S.cart.delete(id); qrProductNotes.delete(id); }",
    'NOTE_CLEANUP_ZERO'
  );

  out = requiredReplace(
    out,
    "      items:[...S.cart.entries()].map(([menuItemId, quantity]) => ({ menuItemId, quantity })),",
    "      items:[...S.cart.entries()].map(([menuItemId, quantity]) => ({ menuItemId, quantity, notes:String(qrProductNotes.get(menuItemId) || '').trim() || null })),",
    'PAYLOAD_NOTES'
  );

  out = requiredReplace(
    out,
    "      S.cart.clear();\n      showSuccess(order);",
    "      S.cart.clear();\n      qrProductNotes.clear();\n      showSuccess(order);",
    'SUCCESS_CLEANUP'
  );

  return `/* ${MARKER} · Cliente QR · nota opcional por producto */\n${out}`;
}

function installRestaurantQrProductNotesV61(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/app/restaurant-qr-ui.js') return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source) {
      const patched = patchQrProductNotesSource(source);
      if (patched !== source) body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
      res.set('X-VantixGC-QR-Product-Notes', HEADER_VALUE);
    }
    return originalSend(body);
  };
  return next();
}

module.exports = { MARKER, HEADER_VALUE, patchQrProductNotesSource, installRestaurantQrProductNotesV61 };
