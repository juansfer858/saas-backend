(() => {
  'use strict';

  if (window.VantixGCQrRealtimeV1) return;
  const qrToken = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
  if (!qrToken) return;

  const visitEndpoint = `/api/public/restaurante/qr/${encodeURIComponent(qrToken)}/realtime`;
  const presenceEndpoint = `/api/public/restaurante/qr/${encodeURIComponent(qrToken)}/visita/realtime`;
  const makeChannel = () => ({ controller:null, reconnectTimer:null, running:false, attempt:0 });
  const state = {
    presence:makeChannel(),
    visit:makeChannel(),
    tableOpen:null,
    waitingForAuthorization:false,
    destroyed:false
  };

  function parseBlock(kind, block) {
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

    if (kind === 'presence' && (eventName === 'ready' || eventName === 'availability')) {
      state.tableOpen = Boolean(payload?.open);
      window.dispatchEvent(new CustomEvent('vantix:restaurant-table-availability', { detail:payload }));
      if (state.tableOpen) startVisit();
      else {
        state.waitingForAuthorization = false;
        pauseChannel('visit');
      }
      return;
    }

    if (kind === 'visit' && (eventName === 'change' || eventName === 'ready')) {
      window.dispatchEvent(new CustomEvent('vantix:restaurant-visit-realtime', { detail:payload }));
    }
  }

  async function stream(kind, endpoint, controller) {
    const response = await window.fetch(endpoint, {
      cache:'no-store',
      headers:{ Accept:'text/event-stream' },
      signal:controller.signal
    });
    if (kind === 'visit' && (response.status === 401 || response.status === 409)) throw new Error('VISIT_NOT_AUTHORIZED');
    if (!response.ok || !response.body) throw new Error(`HTTP_${response.status}`);
    state[kind].attempt = 0;
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
        if (block && !block.startsWith(':')) parseBlock(kind, block);
      }
    }
  }

  function clearReconnect(kind) {
    const channel = state[kind];
    if (channel.reconnectTimer) clearTimeout(channel.reconnectTimer);
    channel.reconnectTimer = null;
  }

  function pauseChannel(kind) {
    const channel = state[kind];
    clearReconnect(kind);
    channel.controller?.abort();
    channel.controller = null;
    channel.running = false;
  }

  function scheduleReconnect(kind) {
    const channel = state[kind];
    if (state.destroyed || channel.reconnectTimer || document.visibilityState === 'hidden' || navigator.onLine === false) return;
    if (kind === 'visit' && (state.tableOpen === false || state.waitingForAuthorization)) return;
    channel.attempt += 1;
    const wait = Math.min(8000, 700 * Math.pow(1.6, Math.min(channel.attempt, 7)));
    channel.reconnectTimer = setTimeout(() => {
      channel.reconnectTimer = null;
      kind === 'presence' ? startPresence() : startVisit();
    }, wait);
  }

  function startChannel(kind, endpoint) {
    const channel = state[kind];
    if (channel.running || state.destroyed || document.visibilityState === 'hidden' || navigator.onLine === false) return;
    if (kind === 'visit' && (state.tableOpen === false || state.waitingForAuthorization)) return;
    channel.running = true;
    const controller = new AbortController();
    channel.controller = controller;
    stream(kind, endpoint, controller)
      .catch((error) => {
        if (kind === 'visit' && error?.message === 'VISIT_NOT_AUTHORIZED') state.waitingForAuthorization = true;
      })
      .finally(() => {
        if (channel.controller === controller) channel.controller = null;
        channel.running = false;
        if (!controller.signal.aborted) scheduleReconnect(kind);
      });
  }

  function startPresence() { startChannel('presence', presenceEndpoint); }
  function startVisit() { startChannel('visit', visitEndpoint); }

  function pause() {
    pauseChannel('presence');
    pauseChannel('visit');
  }

  function resume() {
    if (state.destroyed) return;
    clearReconnect('presence');
    startPresence();
    if (state.tableOpen !== false && !state.waitingForAuthorization) {
      clearReconnect('visit');
      startVisit();
    }
  }

  window.addEventListener('vantix:restaurant-visit-authorized', () => {
    state.waitingForAuthorization = false;
    clearReconnect('visit');
    pauseChannel('visit');
    startVisit();
  });
  window.addEventListener('pagehide', pause);
  window.addEventListener('pageshow', resume);
  window.addEventListener('online', resume);
  window.addEventListener('offline', pause);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' ? pause() : resume());
  window.addEventListener('beforeunload', () => { state.destroyed = true; pause(); }, { once:true });

  window.VantixGCQrRealtimeV1 = Object.freeze({
    version:'1.1.0',
    transport:'SSE+PG_NOTIFY',
    tablePresenceBeforeAuthorization:true,
    automaticOpenClose:true,
    resume,
    pause
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startPresence, { once:true });
  else startPresence();
})();
