(() => {
  'use strict';

  const qrToken = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
  if (!qrToken) return;

  const STORAGE_KEY = `vantixgc_restaurant_visit_${qrToken}`;
  const qrApiPrefix = `/api/public/restaurante/qr/${encodeURIComponent(qrToken)}`;
  const state = {
    activeCall: null,
    submitting: false,
    streamAbort: null,
    reconnectTimer: null,
    stopped: false
  };

  function visitToken() {
    return String(localStorage.getItem(STORAGE_KEY) || '').trim();
  }

  function ensureStyles() {
    if (document.getElementById('restaurantQrWaiterCallStyles')) return;
    const style = document.createElement('style');
    style.id = 'restaurantQrWaiterCallStyles';
    style.textContent = `
      .qrv3-assist-actions{display:grid;grid-template-columns:repeat(2,minmax(128px,1fr));gap:8px;min-width:286px}
      .qrv3-assist-btn{min-height:54px;padding:0 14px;border:1px solid rgba(255,255,255,.34);border-radius:14px;background:transparent;color:#fff;font-weight:900;line-height:1.15}
      .qrv3-assist-btn:hover,.qrv3-assist-btn:focus-visible{background:#fff;color:#181614;outline:none}
      .qrv3-assist-btn.call{border-color:#f28a39;background:rgba(242,138,57,.13)}
      .qrv3-assist-btn.call.active{border-color:#f28a39;background:#ef6f24;color:#fff}
      .qrv3-assist-btn:disabled{cursor:not-allowed;opacity:.78}
      @media(max-width:860px){.qrv3-assist-actions{grid-column:1/-1;width:100%;min-width:0}}
      @media(max-width:380px){.qrv3-assist-actions{grid-template-columns:1fr 1fr}.qrv3-assist-btn{padding:0 8px;font-size:12px}}
    `;
    document.head.appendChild(style);
  }

  function openHelp() {
    const panel = document.getElementById('helpPanel');
    if (!panel) return;
    panel.hidden = false;
    document.body.style.overflow = 'hidden';
    panel.querySelector('[data-close-help]')?.focus({ preventScroll:true });
  }

  function ensureControls() {
    ensureStyles();
    const old = document.getElementById('helpButton');
    let actions = document.getElementById('restaurantAssistActions');
    if (actions) return actions;
    if (!old) return null;

    actions = document.createElement('div');
    actions.id = 'restaurantAssistActions';
    actions.className = 'qrv3-assist-actions';
    actions.innerHTML = `
      <button id="restaurantHelpButton" class="qrv3-assist-btn" type="button">PEDIR AYUDA</button>
      <button id="restaurantCallWaiterButton" class="qrv3-assist-btn call" type="button">LLAMAR MESERO</button>`;
    old.replaceWith(actions);
    actions.querySelector('#restaurantHelpButton')?.addEventListener('click', openHelp);
    actions.querySelector('#restaurantCallWaiterButton')?.addEventListener('click', callWaiter);
    renderCallButton();
    return actions;
  }

  function renderCallButton() {
    const button = document.getElementById('restaurantCallWaiterButton');
    if (!button) return;
    const active = Boolean(state.activeCall);
    button.classList.toggle('active', active);
    button.disabled = state.submitting || active;
    button.setAttribute('aria-busy', state.submitting ? 'true' : 'false');
    button.textContent = state.submitting ? 'LLAMANDO…' : active ? 'MESERO LLAMADO' : 'LLAMAR MESERO';
  }

  function applySnapshot(snapshot) {
    state.activeCall = snapshot?.active ? snapshot.call || null : null;
    renderCallButton();
  }

  async function fetchStatus() {
    const rawToken = visitToken();
    if (!rawToken || state.stopped) return;
    try {
      const response = await window.fetch(`${qrApiPrefix}/llamar-mesero`, {
        cache:'no-store',
        headers:{ Accept:'application/json' }
      });
      if (!response.ok) {
        if ([401,409].includes(response.status)) applySnapshot({ active:false });
        return;
      }
      const body = await response.json().catch(() => ({}));
      applySnapshot(body.data || { active:false });
      startStream();
    } catch {}
  }

  async function callWaiter() {
    if (state.submitting || state.activeCall) return;
    if (!visitToken()) {
      alert('Primero autoriza este teléfono con el código de 4 dígitos de la mesa.');
      return;
    }
    state.submitting = true;
    renderCallButton();
    try {
      const response = await window.fetch(`${qrApiPrefix}/llamar-mesero`, {
        method:'POST',
        cache:'no-store',
        headers:{ 'Content-Type':'application/json', Accept:'application/json' },
        body:'{}'
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.message || body?.message || 'No fue posible llamar al mesero');
      applySnapshot(body.data || { active:true });
      startStream();
    } catch (error) {
      alert(error.message || 'No fue posible llamar al mesero');
    } finally {
      state.submitting = false;
      renderCallButton();
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
    if (eventName === 'visit-ended') {
      applySnapshot({ active:false });
      stopStream();
    }
  }

  async function streamLoop(controller) {
    const response = await window.fetch(`${qrApiPrefix}/llamar-mesero/stream`, {
      method:'GET',
      cache:'no-store',
      headers:{ Accept:'text/event-stream' },
      signal:controller.signal
    });
    if (!response.ok || !response.body) {
      if ([401,409].includes(response.status)) return;
      throw new Error('Canal de llamado no disponible');
    }
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
    if (state.stopped || state.reconnectTimer || !visitToken()) return;
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      startStream();
    }, 3000);
  }

  function startStream() {
    if (state.stopped || state.streamAbort || !visitToken()) return;
    const controller = new AbortController();
    state.streamAbort = controller;
    streamLoop(controller)
      .catch(() => {})
      .finally(() => {
        if (state.streamAbort === controller) state.streamAbort = null;
        if (!controller.signal.aborted) scheduleReconnect();
      });
  }

  function stopStream() {
    state.streamAbort?.abort();
    state.streamAbort = null;
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  function boot() {
    ensureControls();
    if (visitToken()) fetchStatus();
  }

  window.addEventListener('pagehide', () => {
    state.stopped = true;
    stopStream();
  }, { once:true });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
