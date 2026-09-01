(() => {
  'use strict';

  const SESSION_KEY = 'vantixgc_core_session_v1';
  const FOREGROUND_SAFETY_SYNC_MS = 5000;
  const state = {
    calls: [],
    streamAbort: null,
    reconnectTimer: null,
    fallbackTimer: null,
    ringTimer: null,
    audioContext: null,
    paused: false,
    booted: false,
    snapshotSeq: 0
  };

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m]));
  }

  function authHeaders(extra = {}) {
    const session = readSession();
    if (!session?.token || !session?.subdomain) return null;
    return {
      Authorization:`Bearer ${session.token}`,
      'x-tenant-subdomain':session.subdomain,
      ...extra
    };
  }

  function setChannelState(value) {
    document.documentElement.dataset.waiterCallChannel = value;
  }

  function ensureStyles() {
    if (document.getElementById('restaurantWaiterCallStyles')) return;
    const style = document.createElement('style');
    style.id = 'restaurantWaiterCallStyles';
    style.textContent = `
      .wv-call-stack{position:fixed;z-index:170;top:max(10px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);display:grid;gap:8px;width:min(560px,calc(100% - 16px));pointer-events:none}
      .wv-call-card{pointer-events:auto;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:14px;border:2px solid #ef6f24;border-radius:18px;background:#fffaf3;color:#17212b;box-shadow:0 18px 42px rgba(15,23,42,.28);animation:wvCallPulse 1.15s ease-in-out infinite alternate}
      .wv-call-card.general{border-color:#b91c1c;background:#fff6f5}.wv-call-copy{min-width:0}.wv-call-kicker{display:block;margin-bottom:3px;color:#b8430b;font-size:10px;font-weight:950;letter-spacing:.09em}.wv-call-card.general .wv-call-kicker{color:#991b1b}
      .wv-call-copy b{display:block;font-size:20px;line-height:1.05}.wv-call-copy span{display:block;margin-top:4px;color:#64748b;font-size:12px;font-weight:750}.wv-call-action{min-width:112px;min-height:52px;padding:0 14px;border:0;border-radius:13px;background:#168454;color:#fff;font-weight:950}.wv-call-action:disabled{opacity:.55}
      @keyframes wvCallPulse{from{box-shadow:0 14px 34px rgba(15,23,42,.20)}to{box-shadow:0 20px 48px rgba(239,111,36,.34)}}
      @media(max-width:430px){.wv-call-card{grid-template-columns:1fr}.wv-call-action{width:100%}.wv-call-copy b{font-size:18px}}
    `;
    document.head.appendChild(style);
  }

  function ensureRoot() {
    ensureStyles();
    let root = document.getElementById('restaurantWaiterCallStack');
    if (root) return root;
    root = document.createElement('aside');
    root.id = 'restaurantWaiterCallStack';
    root.className = 'wv-call-stack';
    root.setAttribute('aria-live', 'assertive');
    root.setAttribute('aria-label', 'Llamados de mesas');
    document.body.appendChild(root);
    return root;
  }

  function callTitle(call) {
    return call.table?.code || call.table?.name || 'Mesa';
  }

  function render() {
    const root = ensureRoot();
    root.innerHTML = state.calls.map((call) => {
      const general = call.priority === 'GENERAL' || call.escalated;
      const person = Number(call.seatNumber || 0) > 0 ? ` · Persona ${Number(call.seatNumber)}` : '';
      return `<section class="wv-call-card ${general ? 'general' : ''}" data-waiter-call="${esc(call.id)}">
        <div class="wv-call-copy">
          <small class="wv-call-kicker">${general ? 'LLAMADO GENERAL · NECESITA ATENCIÓN' : 'TU MESA TE ESTÁ LLAMANDO'}</small>
          <b>${esc(callTitle(call))}</b>
          <span>El cliente solicitó un mesero${esc(person)}.</span>
        </div>
        <button type="button" class="wv-call-action" data-attend-call="${esc(call.id)}" data-table-id="${esc(call.table?.id || '')}">ATENDER</button>
      </section>`;
    }).join('');
    root.querySelectorAll('[data-attend-call]').forEach((button) => button.addEventListener('click', () => attend(button)));
    updateRinging();
  }

  function warmAudio() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      if (!state.audioContext) state.audioContext = new AudioContext();
      state.audioContext.resume?.().catch(() => {});
    } catch {}
  }

  function beep() {
    try {
      warmAudio();
      const ctx = state.audioContext;
      if (!ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.72);
      gain.connect(ctx.destination);
      for (const [offset, frequency] of [[0, 880], [0.22, 1040], [0.44, 880]]) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(frequency, now + offset);
        osc.connect(gain);
        osc.start(now + offset);
        osc.stop(now + offset + 0.18);
      }
    } catch {}
    try { navigator.vibrate?.([320, 120, 320]); } catch {}
  }

  function ringTick() {
    state.ringTimer = null;
    if (!state.calls.length || state.paused || document.visibilityState === 'hidden') return;
    beep();
    state.ringTimer = setTimeout(ringTick, 4200);
  }

  function updateRinging() {
    if (!state.calls.length || state.paused || document.visibilityState === 'hidden') {
      if (state.ringTimer) clearTimeout(state.ringTimer);
      state.ringTimer = null;
      try { navigator.vibrate?.(0); } catch {}
      return;
    }
    if (!state.ringTimer) ringTick();
  }

  function applySnapshot(snapshot) {
    state.calls = Array.isArray(snapshot?.calls) ? snapshot.calls : [];
    setChannelState('connected');
    render();
  }

  async function fetchSnapshot({ silent = true } = {}) {
    const seq = ++state.snapshotSeq;
    const headers = authHeaders({ Accept:'application/json' });
    if (!headers) {
      setChannelState('waiting-session');
      return false;
    }
    try {
      const response = await fetch('/api/public/restaurante/mesero-dispositivo/llamadas', {
        method:'GET',
        cache:'no-store',
        headers
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.message || body?.message || `HTTP ${response.status}`);
      if (seq !== state.snapshotSeq) return false;
      applySnapshot(body?.data || { calls:[] });
      return true;
    } catch (error) {
      if (seq === state.snapshotSeq) setChannelState('disconnected');
      if (!silent) {
        const message = document.getElementById('wvMessage');
        if (message) message.innerHTML = `<div class="wv-msg err">${esc(error.message || 'No fue posible conectar los llamados de mesa')}</div>`;
      }
      return false;
    }
  }

  async function attend(button) {
    const callId = button?.dataset.attendCall;
    const tableId = button?.dataset.tableId || '';
    const headers = authHeaders({ 'Content-Type':'application/json', Accept:'application/json' });
    if (!callId || !headers) return;
    button.disabled = true;
    button.textContent = 'ATENDIENDO…';
    try {
      const response = await fetch(`/api/public/restaurante/mesero-dispositivo/llamadas/${encodeURIComponent(callId)}/atender`, {
        method:'POST',
        cache:'no-store',
        headers,
        body:'{}'
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.message || body?.message || 'No fue posible atender el llamado');
      state.calls = state.calls.filter((call) => call.id !== callId);
      render();
      const tableButton = tableId ? document.querySelector(`#wvTables .wv-table[data-table="${CSS.escape(tableId)}"]`) : null;
      tableButton?.click();
      fetchSnapshot({ silent:true }).catch(() => {});
    } catch (error) {
      button.disabled = false;
      button.textContent = 'ATENDER';
      const message = document.getElementById('wvMessage');
      if (message) message.innerHTML = `<div class="wv-msg err">${esc(error.message || 'No fue posible atender el llamado')}</div>`;
    }
  }

  function handleSseBlock(block) {
    const lines = block.split(/\r?\n/);
    let eventName = 'message';
    const data = [];
    for (const line of lines) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trim());
    }
    if (eventName === 'snapshot' && data.length) {
      try { applySnapshot(JSON.parse(data.join('\n'))); } catch {}
    }
  }

  async function streamLoop(controller) {
    const headers = authHeaders({ Accept:'text/event-stream' });
    if (!headers) throw new Error('Sesión de mesero no disponible');
    const response = await fetch('/api/v1/restaurante/llamadas-mesero/stream', {
      method:'GET',
      cache:'no-store',
      headers,
      signal:controller.signal
    });
    if (!response.ok || !response.body) throw new Error('Canal de llamados no disponible');
    setChannelState('connected');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!controller.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream:true });
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (block && !block.startsWith(':')) handleSseBlock(block);
      }
    }
  }

  function scheduleReconnect() {
    if (state.paused || state.reconnectTimer || document.visibilityState === 'hidden') return;
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      fetchSnapshot({ silent:true }).catch(() => {});
      startStream();
    }, 3000);
  }

  function startStream() {
    if (state.paused || state.streamAbort || document.visibilityState === 'hidden') return;
    const controller = new AbortController();
    state.streamAbort = controller;
    streamLoop(controller)
      .catch(() => { setChannelState('direct-fallback'); })
      .finally(() => {
        if (state.streamAbort === controller) state.streamAbort = null;
        if (!controller.signal.aborted) scheduleReconnect();
      });
  }

  function stopFallbackSync() {
    if (state.fallbackTimer) clearTimeout(state.fallbackTimer);
    state.fallbackTimer = null;
  }

  function scheduleFallbackSync() {
    if (state.paused || state.fallbackTimer || document.visibilityState === 'hidden' || navigator.onLine === false) return;
    state.fallbackTimer = setTimeout(async () => {
      state.fallbackTimer = null;
      if (state.paused || document.visibilityState === 'hidden') return;
      await fetchSnapshot({ silent:true }).catch(() => false);
      scheduleFallbackSync();
    }, FOREGROUND_SAFETY_SYNC_MS);
  }

  function stopStream() {
    state.streamAbort?.abort();
    state.streamAbort = null;
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
    stopFallbackSync();
    if (state.ringTimer) clearTimeout(state.ringTimer);
    state.ringTimer = null;
    try { navigator.vibrate?.(0); } catch {}
  }

  function pauseChannel() {
    state.paused = true;
    setChannelState('paused');
    stopStream();
  }

  function resumeChannel() {
    state.paused = false;
    ensureRoot();
    fetchSnapshot({ silent:true }).catch(() => {});
    startStream();
    scheduleFallbackSync();
    updateRinging();
  }

  function boot() {
    if (state.booted) return;
    state.booted = true;
    resumeChannel();
  }

  window.addEventListener('pointerdown', warmAudio, { once:true, passive:true });
  window.addEventListener('pagehide', pauseChannel);
  window.addEventListener('pageshow', resumeChannel);
  window.addEventListener('online', resumeChannel);
  window.addEventListener('focus', () => {
    if (document.visibilityState !== 'hidden') resumeChannel();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') pauseChannel();
    else resumeChannel();
  });

  window.VantixGCWaiterCallV4 = Object.freeze({
    version:'4.0.0',
    directDeviceSnapshot:true,
    directDeviceAttend:true,
    ssePrimary:true,
    foregroundSafetySnapshotMs:FOREGROUND_SAFETY_SYNC_MS,
    separateScript:true,
    noSetInterval:true,
    domObserverFree:true
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
