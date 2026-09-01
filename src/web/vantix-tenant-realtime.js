(() => {
  'use strict';

  if (window.VantixGCTenantRealtime) return;
  const SESSION_KEY = 'vantixgc_core_session_v1';
  const state = { controller:null, reconnectTimer:null, stopped:false, running:false, attempt:0, lastEventAt:null };

  function session() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  }

  function headers() {
    const current = session();
    if (!current?.token || !current?.subdomain) return null;
    return {
      Authorization:`Bearer ${current.token}`,
      'x-tenant-subdomain':current.subdomain,
      Accept:'text/event-stream'
    };
  }

  function dispatch(name, detail) {
    state.lastEventAt = new Date().toISOString();
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

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
    if (eventName === 'change') dispatch('vantix:tenant-realtime', payload);
    else if (eventName === 'ready') dispatch('vantix:tenant-realtime-ready', payload);
  }

  async function readStream(controller) {
    const requestHeaders = headers();
    if (!requestHeaders) throw new Error('SESSION_UNAVAILABLE');
    const response = await fetch('/api/v1/realtime/stream', {
      cache:'no-store',
      headers:requestHeaders,
      signal:controller.signal
    });
    if (response.status === 401 || response.status === 403) throw new Error('SESSION_REJECTED');
    if (!response.ok || !response.body) throw new Error(`REALTIME_HTTP_${response.status}`);
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

  function clearReconnect() {
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  function scheduleReconnect() {
    if (state.stopped || state.reconnectTimer || document.visibilityState === 'hidden' || navigator.onLine === false) return;
    state.attempt += 1;
    const delay = Math.min(8000, 600 * Math.pow(1.65, Math.min(state.attempt, 7)));
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      start();
    }, delay);
  }

  function stop() {
    state.stopped = true;
    clearReconnect();
    state.controller?.abort();
    state.controller = null;
    state.running = false;
  }

  function pause() {
    clearReconnect();
    state.controller?.abort();
    state.controller = null;
    state.running = false;
  }

  function start() {
    if (state.running || document.visibilityState === 'hidden' || navigator.onLine === false || !headers()) return;
    state.stopped = false;
    state.running = true;
    const controller = new AbortController();
    state.controller = controller;
    readStream(controller)
      .catch((error) => {
        if (error?.message === 'SESSION_REJECTED') state.stopped = true;
      })
      .finally(() => {
        if (state.controller === controller) state.controller = null;
        state.running = false;
        if (!controller.signal.aborted) scheduleReconnect();
      });
  }

  function resume() {
    state.stopped = false;
    clearReconnect();
    start();
  }

  window.addEventListener('pagehide', pause);
  window.addEventListener('pageshow', resume);
  window.addEventListener('online', resume);
  window.addEventListener('offline', pause);
  window.addEventListener('focus', () => { if (document.visibilityState !== 'hidden') resume(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') pause();
    else resume();
  });

  window.VantixGCTenantRealtime = Object.freeze({
    version:'1.0.0',
    transport:'SSE+PG_NOTIFY',
    start:resume,
    stop,
    state:() => ({ connected:state.running, lastEventAt:state.lastEventAt, attempt:state.attempt })
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', resume, { once:true });
  else resume();
})();
