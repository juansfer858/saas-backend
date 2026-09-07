'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/web/restaurant-qr-realtime-ui.js', 'utf8');

async function runCase({ visualText, presenceOpen }) {
  let reloads = 0;
  const events = [];
  let presenceServed = false;
  const location = {
    pathname:'/r/qa-table-token',
    reload() { reloads += 1; }
  };
  const accountStrip = { textContent:visualText };
  const documentElement = { dataset:{} };
  const document = {
    readyState:'complete',
    visibilityState:'visible',
    documentElement,
    querySelector(selector) { return selector === '#accountStrip' ? accountStrip : null; },
    addEventListener() {}
  };
  const window = {
    location,
    addEventListener() {},
    dispatchEvent(event) { events.push({ type:event.type, detail:event.detail }); },
    fetch:async (url) => {
      if (String(url).includes('/visita/realtime')) {
        if (presenceServed) return new Response('', { status:200 });
        presenceServed = true;
        return new Response(`event: ready\ndata: ${JSON.stringify({ open:presenceOpen, guestCount:presenceOpen ? 2 : 0, accountRequested:false })}\n\n`, {
          status:200,
          headers:{ 'Content-Type':'text/event-stream' }
        });
      }
      return new Response('', { status:401 });
    }
  };

  const context = {
    window,
    location,
    document,
    navigator:{ onLine:true },
    console,
    Response,
    AbortController,
    TextDecoder,
    decodeURIComponent,
    CustomEvent:class CustomEvent {
      constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
    },
    setTimeout:() => 1,
    clearTimeout:() => {}
  };
  vm.runInNewContext(source, context, { filename:'restaurant-qr-realtime-ui.js' });
  await new Promise((resolve) => global.setTimeout(resolve, 25));
  return { reloads, events, dataset:documentElement.dataset, api:window.VantixGCQrRealtimeV1 };
}

async function main() {
  assert.match(source, /automaticVisualRefresh:true/);
  assert.match(source, /initialStateRaceReconciled:true/);
  assert.match(source, /function renderedTableOpen\(\)/);
  assert.match(source, /function scheduleVisualSync\(expectedOpen\)/);
  assert.match(source, /window\.location\.reload\(\)/);

  const openMismatch = await runCase({
    visualText:'Mesa pendiente de apertura CERRADA',
    presenceOpen:true
  });
  assert.equal(openMismatch.reloads, 1, 'mesa abierta por realtime debe sacar automáticamente al QR de la vista CERRADA');
  assert.equal(openMismatch.dataset.qrVisualRealtime, 'refreshing');
  assert.equal(openMismatch.events.some((event) => event.type === 'vantix:restaurant-table-availability' && event.detail?.open === true), true);

  const closeMismatch = await runCase({
    visualText:'Mesa activa · pedido directo a producción Cuenta actual $ 35.000',
    presenceOpen:false
  });
  assert.equal(closeMismatch.reloads, 1, 'pago final/cierre debe llevar automáticamente al QR a la vista cerrada');

  const closedMatch = await runCase({
    visualText:'Mesa pendiente de apertura CERRADA',
    presenceOpen:false
  });
  assert.equal(closedMatch.reloads, 0, 'estado cerrado ya sincronizado no debe recargar');

  const openMatch = await runCase({
    visualText:'Mesa activa · pedido directo a producción Cuenta actual $ 0',
    presenceOpen:true
  });
  assert.equal(openMatch.reloads, 0, 'estado abierto ya sincronizado no debe recargar');
  assert.equal(openMatch.api?.automaticVisualRefresh, true);
  assert.equal(openMatch.api?.initialStateRaceReconciled, true);

  console.log('RESTAURANT QR VISUAL REALTIME V26 SMOKE OK');
  console.log(JSON.stringify({
    closedToOpenAutomatic:true,
    openToClosedAutomatic:true,
    initialReadyComparedWithRenderedState:true,
    noReloadWhenAlreadySynchronized:true,
    manualRefreshRequired:false
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
