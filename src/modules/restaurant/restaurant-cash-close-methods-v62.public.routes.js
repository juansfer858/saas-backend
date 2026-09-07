'use strict';

const { prisma } = require('../../config/prisma');
const { decimal, money } = require('../../utils/decimal');
const identity = require('./restaurant-identity.service');

const MARKER = 'VANTIX_RESTAURANT_CASH_CLOSE_METHODS_V62';
const originalCashShiftSummary = identity.cashShiftSummary;

async function cashShiftSummaryV62(tenantId, userId, shiftId) {
  const summary = await originalCashShiftSummary(tenantId, userId, shiftId);
  const rows = Array.isArray(summary?.tables) ? summary.tables : [];
  const sessionIds = rows.map((row) => row.sessionId).filter(Boolean);
  const sessions = sessionIds.length ? await prisma.restaurantTableSession.findMany({
    where: { tenantId, id: { in: sessionIds } },
    select: {
      id: true,
      paymentMethodKind: true,
      paymentMethodLabel: true,
      paymentAccountId: true,
      paymentReference: true
    }
  }) : [];
  const bySession = new Map(sessions.map((row) => [row.id, row]));

  let cashSales = decimal(0);
  let transferSales = decimal(0);
  let cardSales = decimal(0);
  let bankOtherSales = decimal(0);
  let creditSales = decimal(0);

  const enrichedRows = rows.map((row) => {
    const session = bySession.get(row.sessionId) || null;
    const kind = String(session?.paymentMethodKind || '').toUpperCase();
    const amount = decimal(row.total || 0);
    if (kind === 'EFECTIVO') cashSales = cashSales.plus(amount);
    else if (kind === 'TRANSFERENCIA') transferSales = transferSales.plus(amount);
    else if (kind === 'TARJETA') cardSales = cardSales.plus(amount);
    else if (kind === 'CREDITO') creditSales = creditSales.plus(amount);
    else if (row.formaPago === 'EFECTIVO') cashSales = cashSales.plus(amount);
    else if (row.formaPago === 'BANCO') bankOtherSales = bankOtherSales.plus(amount);
    else if (row.formaPago === 'CREDITO') creditSales = creditSales.plus(amount);
    return {
      ...row,
      paymentMethodKind: kind || null,
      paymentMethodLabel: session?.paymentMethodLabel || null,
      paymentAccountId: session?.paymentAccountId || null,
      paymentReference: session?.paymentReference || null
    };
  });

  const electronicSales = transferSales.plus(cardSales).plus(bankOtherSales);
  const previous = summary.paymentBreakdown || {};
  return {
    ...summary,
    tables: enrichedRows,
    paymentBreakdown: {
      ...previous,
      cashSales: money(cashSales).toString(),
      transferSales: money(transferSales).toString(),
      cardSales: money(cardSales).toString(),
      bankOtherSales: money(bankOtherSales).toString(),
      electronicSales: money(electronicSales).toString(),
      creditSales: money(creditSales).toString(),
      exactMethodBreakdown: true
    }
  };
}

// restaurant.routes.js conserva una referencia al mismo objeto exportado. Mutar la
// propiedad aquí actualiza el endpoint /caja/turnos/:id/resumen sin duplicar rutas.
identity.cashShiftSummary = cashShiftSummaryV62;

const runtime = String.raw`
;(()=>{
  'use strict';
  const MARKER='VANTIX_RESTAURANT_CASH_CLOSE_METHODS_V62';
  if(window[MARKER]) return;
  window[MARKER]=Object.freeze({version:'62.0.0',exactTransfer:true,exactCard:true,legacyBankFallback:true,noPolling:true});
  const SESSION_KEY='vantixgc_core_session_v1';
  const SHIFT_KEY='restaurant_cash_shift';
  const STYLE_ID='vantix-cash-close-methods-v62-style';
  let cache=null,cacheShift='',cacheAt=0,burst=0;
  const $=(q,r=document)=>r.querySelector(q);
  const money=(value)=>{let s=null;try{s=JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{}return new Intl.NumberFormat('es-CO',{style:'currency',currency:s?.tenant?.moneda||'COP',maximumFractionDigits:0}).format(Number(value||0))};
  function auth(){try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{return null}}
  function shift(){return localStorage.getItem(SHIFT_KEY)||''}
  function ensureStyle(){if(document.getElementById(STYLE_ID))return;const style=document.createElement('style');style.id=STYLE_ID;style.textContent='.cash-payment-breakdown-v45{display:none!important}.cash-payment-breakdown-v62{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin:4px 0 14px}.cash-payment-card-v62{border:1px solid #d7e1ec;border-radius:13px;background:#fff;padding:12px;display:grid;gap:4px;min-width:0}.cash-payment-card-v62 small{font-size:10px;color:#637997;font-weight:800;text-transform:uppercase;letter-spacing:.03em}.cash-payment-card-v62 b{font-size:20px;color:#10233f;font-weight:950;letter-spacing:-.02em}.cash-payment-card-v62 span{font-size:10px;color:#718096;font-weight:700;line-height:1.35}.cash-payment-card-v62.cash{border-color:#b9decf;background:#f3fbf7}.cash-payment-card-v62.transfer{border-color:#b9d4f5;background:#f2f7ff}.cash-payment-card-v62.card{border-color:#d5c9ef;background:#f8f5ff}.cash-payment-card-v62.credit{border-color:#ead8ae;background:#fffbef}.cash-payment-card-v62.other{grid-column:1/-1;border-style:dashed;background:#fafafa}@media(max-width:850px){.cash-payment-breakdown-v62{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.cash-payment-breakdown-v62{grid-template-columns:1fr}.cash-payment-card-v62{padding:11px}.cash-payment-card-v62 b{font-size:18px}}';document.head.appendChild(style)}
  async function load(force=false){const id=shift(),s=auth();if(!id||!s?.token||!s?.subdomain)return null;const now=Date.now();if(!force&&cache&&cacheShift===id&&now-cacheAt<1200)return cache;const response=await fetch('/api/v1/restaurante/caja/turnos/'+encodeURIComponent(id)+'/resumen',{cache:'no-store',headers:{Authorization:'Bearer '+s.token,'x-tenant-subdomain':s.subdomain}});let body={};try{body=await response.json()}catch{}if(!response.ok)throw new Error(body?.error?.message||body?.message||('HTTP '+response.status));cache=body.data||null;cacheShift=id;cacheAt=Date.now();return cache}
  function render(summary){const panel=$('.cash-close-panel');if(!panel||!summary)return;ensureStyle();const b=summary.paymentBreakdown||{};let root=$('.cash-payment-breakdown-v62',panel);if(!root){root=document.createElement('div');root.className='cash-payment-breakdown-v62';const lines=$('.cash-close-lines',panel);if(lines)panel.insertBefore(root,lines);else panel.prepend(root)}const other=Number(b.bankOtherSales||0);root.innerHTML='<article class="cash-payment-card-v62 cash"><small>Efectivo esperado en caja</small><b>'+money(summary.systemCashExpected)+'</b><span>Ventas en efectivo: '+money(b.cashSales)+' · fondo inicial y movimientos físicos.</span></article>'+'<article class="cash-payment-card-v62 transfer"><small>Transferencias / QR</small><b>'+money(b.transferSales)+'</b><span>Pagos configurados específicamente como transferencia.</span></article>'+'<article class="cash-payment-card-v62 card"><small>Tarjetas</small><b>'+money(b.cardSales)+'</b><span>Pagos configurados específicamente como tarjeta.</span></article>'+'<article class="cash-payment-card-v62 credit"><small>Crédito / cartera</small><b>'+money(b.creditSales)+'</b><span>Ventas que quedaron pendientes por cobrar al cliente.</span></article>'+(other>0?'<article class="cash-payment-card-v62 other"><small>Banco histórico / sin subtipo</small><b>'+money(other)+'</b><span>Cobros antiguos registrados como Banco antes de separar Transferencia y Tarjeta.</span></article>':'');panel.dataset.cashCloseMethods='v62'}
  async function enhance(force=false){if(!shift())return;try{render(await load(force))}catch{}}
  function schedule(force=false){const token=++burst;[0,40,100,220,480,900,1400].forEach((delay)=>setTimeout(()=>{if(token!==burst)return;enhance(force&&delay===0).catch(()=>{})},delay))}
  document.addEventListener('click',(event)=>{if(event.target?.closest?.('#closeShift,[data-tab="caja"],[data-cc-tab="caja"],[data-cash-table],[data-cash-metric],[data-cash-metric-back]'))schedule(true)},true);
  window.addEventListener('vantix:tenant-realtime',()=>{cacheAt=0;schedule(true)});window.addEventListener('vantix:tenant-realtime-ready',()=>schedule(true));window.addEventListener('pageshow',()=>schedule(false));if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>schedule(false),{once:true});else schedule(false);
})();
`;

function installRestaurantCashCloseMethodsV62(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/app/restaurant-ui.js') return next();
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const isBuffer = Buffer.isBuffer(body);
    const source = isBuffer ? body.toString('utf8') : (typeof body === 'string' ? body : null);
    if (source && !source.includes(MARKER)) {
      const patched = `${source}\n;${runtime}\n`;
      body = isBuffer ? Buffer.from(patched, 'utf8') : patched;
    }
    res.set('X-VantixGC-Restaurant-Cash-Close-Methods', 'v62-transfer-card-exact');
    return originalSend(body);
  };
  return next();
}

module.exports = { MARKER, cashShiftSummaryV62, runtime, installRestaurantCashCloseMethodsV62 };
