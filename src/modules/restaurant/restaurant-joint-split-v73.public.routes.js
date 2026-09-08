'use strict';

// Ensure the already-established flexible service implementation is active before
// the public waiter runtime exposes joint -> individual redistribution.
require('./restaurant-waiter-service-flex-v9');

const MARKER = 'VANTIX_RESTAURANT_JOINT_SPLIT_V73';

const ORIGINAL_ITEM_MARKUP = "    const itemMarkup = all.length ? all.map((item) => `<div class=\"wv-item\"><div><b>${esc(item.quantity)}× ${esc(item.description)}</b><small>${esc(item.station || '')}${item.orderState === 'BORRADOR' ? ' · Por enviar' : ' · Enviado'}${item.notes ? ` · ${esc(item.notes)}` : ''}</small></div><strong>${money(item.lineTotal)}</strong>${item.orderState === 'BORRADOR' ? `<div style=\"grid-column:1/-1;display:flex;gap:6px\"><button type=\"button\" class=\"wv-btn\" style=\"min-height:38px\" data-note=\"${item.id}\">Nota</button>${billingMode() === 'INDIVIDUAL' ? `<select class=\"wv-select\" style=\"min-height:38px\" data-move=\"${item.id}\">${Array.from({length:guestCount()},(_,index)=>index+1).map((seat)=>`<option value=\"${seat}\" ${Number(item.seatNumber)===seat?'selected':''}>Persona ${seat}</option>`).join('')}</select>` : ''}</div>` : ''}</div>`).join('') : '<div class=\"wv-empty\" style=\"padding:12px\">Sin productos todavía.</div>';";

const FLEXIBLE_ITEM_MARKUP = `    const itemMarkup = all.length ? all.map((item) => {
      const seatSelector = billingMode() === 'INDIVIDUAL'
        ? \`<select class="wv-select" style="min-height:38px" data-move="\${item.id}" aria-label="Asignar producto a persona">\${Array.from({length:guestCount()},(_,index)=>index+1).map((seat)=>\`<option value="\${seat}" \${Number(item.seatNumber)===seat?'selected':''}>Persona \${seat}</option>\`).join('')}</select>\`
        : '';
      const noteButton = item.orderState === 'BORRADOR'
        ? \`<button type="button" class="wv-btn" style="min-height:38px" data-note="\${item.id}">Nota</button>\`
        : '';
      const lineActions = noteButton || seatSelector
        ? \`<div style="grid-column:1/-1;display:flex;gap:6px">\${noteButton}\${seatSelector}</div>\`
        : '';
      return \`<div class="wv-item"><div><b>\${esc(item.quantity)}× \${esc(item.description)}</b><small>\${esc(item.station || '')}\${item.orderState === 'BORRADOR' ? ' · Por enviar' : ' · Enviado'}\${item.notes ? \` · \${esc(item.notes)}\` : ''}</small></div><strong>\${money(item.lineTotal)}</strong>\${lineActions}</div>\`;
    }).join('') : '<div class="wv-empty" style="padding:12px">Sin productos todavía.</div>';`;

function patchWaiterRuntime(source) {
  if (typeof source !== 'string' || source.includes(MARKER)) return source;
  if (!source.includes(ORIGINAL_ITEM_MARKUP)) return source;
  return `${source.replace(ORIGINAL_ITEM_MARKUP, FLEXIBLE_ITEM_MARKUP)}\n;/* ${MARKER} */\n`;
}

function installRestaurantJointSplitV73(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/app/restaurant-waiter-runtime-v7.js') return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source) {
      const patched = patchWaiterRuntime(source);
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
    }
    res.set('X-VantixGC-Joint-Split', 'v73-products-to-people');
    return originalSend(body);
  };
  return next();
}

module.exports = { MARKER, patchWaiterRuntime, installRestaurantJointSplitV73 };
