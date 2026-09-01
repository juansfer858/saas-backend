(() => {
  'use strict';

  if (window.VantixGCQrRealtimeV1) return;
  const qrToken = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
  if (!qrToken) return;
  const state = { controller:null, reconnectTimer:null, running:false, stopped:false, attempt:0 };
  const endpoint = `/api/public/restaurante/qr/${encodeURIComponent(qrToken)}/realtime`;

  function parseBlock(block) {
    const lines = block.split(/\r?\n/);
    let eventName = 'message';
    const data = [];
    for (const line of lines) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trim());
    }
    if (!data.length) return;
    let payload;
    try { payload = JSON.parse(data.join('\n')); } catch { return; }
    if (eventName === 'change' || eventName === 'ready') {
      window.dispatchEvent(new CustomEvent('vantix:restaurant-visit-realtime', { detail:payload }));
    }
  }

  async function stream(controller) {
    const response = await window.fetch(endpoint, { cache:'no-store', headers:{ Accept:'text/event-stream' }, signal:controller.signal });
    if (response.status === 401 || response.status === 409) throw new Error('VISIT_NOT_ACTIVE');
    if (!response.ok || !response.body) throw new Error(`HTTP_${response.status}`);
    state.attempt = 0;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!controller.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream:true }).replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (block && !block.startsWith(':')) parseBlock(block);
      }
    }
  }

  function clearReconnect() { if (state.reconnectTimer) clearTimeout(state.reconnectTimer); state.reconnectTimer = null; }
  function pause() { clearReconnect(); state.controller?.abort(); state.controller=null; state.running=false; }
  function scheduleReconnect() {
    if (state.stopped || state.reconnectTimer || document.visibilityState === 'hidden' || navigator.onLine === false) return;
    state.attempt += 1;
    const wait = Math.min(8000, 700 * Math.pow(1.6, Math.min(state.attempt, 7)));
    state.reconnectTimer = setTimeout(() => { state.reconnectTimer=null; start(); }, wait);
  }
  function start() {
    if (state.running || state.stopped || document.visibilityState === 'hidden' || navigator.onLine === false) return;
    state.running=true;
    const controller=new AbortController(); state.controller=controller;
    stream(controller).catch((error) => { if (error?.message === 'VISIT_NOT_ACTIVE') state.stopped=true; })
      .finally(() => { if(state.controller===controller)state.controller=null; state.running=false; if(!controller.signal.aborted)scheduleReconnect(); });
  }
  function resume() { if (!state.stopped) { clearReconnect(); start(); } }

  window.addEventListener('pagehide', pause);
  window.addEventListener('pageshow', resume);
  window.addEventListener('online', resume);
  window.addEventListener('offline', pause);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' ? pause() : resume());

  window.VantixGCQrRealtimeV1 = Object.freeze({ version:'1.0.0', transport:'SSE+PG_NOTIFY', resume, pause });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();
