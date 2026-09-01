(() => {
  'use strict';

  if (window.VantixGCWaiterQrOrderAlertV25) return;

  const SESSION_KEY = 'vantixgc_core_session_v1';
  const SEEN_KEY = 'vantixgc_waiter_qr_order_alert_seen_v25';
  const FALLBACK_MS = 20_000;
  const state = {
    alerts:new Map(),
    pending:new Map(),
    audioContext:null,
    destroyed:false
  };

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
  }

  function authHeaders(extra = {}) {
    const session = readSession();
    if (!session?.token || !session?.subdomain) return null;
    return { Authorization:`Bearer ${session.token}`, 'x-tenant-subdomain':session.subdomain, ...extra };
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m]));
  }

  function money(value) {
    const session = readSession();
    return new Intl.NumberFormat('es-CO', { style:'currency', currency:session?.tenant?.moneda || 'COP', maximumFractionDigits:0 }).format(Number(value || 0));
  }

  function readSeen() {
    try {
      const raw = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const next = {};
      for (const [key, at] of Object.entries(raw || {})) if (Number(at) >= cutoff) next[key] = Number(at);
      return next;
    } catch { return {}; }
  }

  function wasSeen(orderId) { return Boolean(readSeen()[orderId]); }
  function markSeen(orderId) {
    if (!orderId) return;
    const seen = readSeen();
    seen[orderId] = Date.now();
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch {}
  }

  async function api(path) {
    const headers = authHeaders({ Accept:'application/json' });
    if (!headers) throw new Error('Sesión de mesero no disponible');
    const response = await fetch(path, { cache:'no-store', headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.message || body?.message || `HTTP ${response.status}`);
    return body.data;
  }

  function ensureUi() {
    if (!document.getElementById('restaurantWaiterQrOrderAlertStyles')) {
      const style = document.createElement('style');
      style.id = 'restaurantWaiterQrOrderAlertStyles';
      style.textContent = `
        .wv-qr-order-stack{position:fixed;z-index:168;top:max(92px,calc(env(safe-area-inset-top) + 92px));left:50%;transform:translateX(-50%);display:grid;gap:8px;width:min(560px,calc(100% - 16px));pointer-events:none}
        .wv-qr-order-card{pointer-events:auto;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:14px;border:2px solid #2563eb;border-radius:18px;background:#eff6ff;color:#17212b;box-shadow:0 18px 42px rgba(15,23,42,.26)}
        .wv-qr-order-card.escalated{border-color:#7c3aed;background:#f5f3ff}
        .wv-qr-order-kicker{display:block;margin-bottom:3px;color:#1d4ed8;font-size:10px;font-weight:950;letter-spacing:.09em}.wv-qr-order-card.escalated .wv-qr-order-kicker{color:#6d28d9}
        .wv-qr-order-copy{min-width:0}.wv-qr-order-copy b{display:block;font-size:20px;line-height:1.05}.wv-qr-order-copy span{display:block;margin-top:4px;color:#475569;font-size:12px;font-weight:750}.wv-qr-order-copy small.summary{display:block;margin-top:5px;color:#334155;font-size:11px;line-height:1.35}
        .wv-qr-order-action{min-width:126px;min-height:52px;padding:0 14px;border:0;border-radius:13px;background:#1d4ed8;color:#fff;font-weight:950}.wv-qr-order-card.escalated .wv-qr-order-action{background:#6d28d9}
        @media(max-width:430px){.wv-qr-order-card{grid-template-columns:1fr}.wv-qr-order-action{width:100%}.wv-qr-order-copy b{font-size:18px}}
      `;
      document.head.appendChild(style);
    }
    let root = document.getElementById('restaurantWaiterQrOrderAlertStack');
    if (!root) {
      root = document.createElement('aside');
      root.id = 'restaurantWaiterQrOrderAlertStack';
      root.className = 'wv-qr-order-stack';
      root.setAttribute('aria-live', 'assertive');
      root.setAttribute('aria-label', 'Pedidos nuevos desde QR');
      document.body.appendChild(root);
    }
    return root;
  }

  function itemSummary(order) {
    const items = Array.isArray(order?.items) ? order.items : [];
    const parts = items.slice(0, 2).map((item) => `${Number(item.quantity || 0)}× ${item.description || 'Producto'}`);
    if (items.length > 2) parts.push(`+${items.length - 2} más`);
    return parts.join(' · ');
  }

  function seatLabel(order) {
    const seats = [...new Set((order?.items || []).map((item) => Number(item.seatNumber || 0)).filter((value) => value > 0))];
    return seats.length === 1 ? ` · Persona ${seats[0]}` : '';
  }

  function render() {
    const root = ensureUi();
    const rows = [...state.alerts.values()].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    root.innerHTML = rows.map((row) => `
      <section class="wv-qr-order-card ${row.escalated ? 'escalated' : ''}" data-qr-order-alert="${esc(row.order.id)}">
        <div class="wv-qr-order-copy">
          <small class="wv-qr-order-kicker">${row.escalated ? 'PEDIDO QR · APOYO GENERAL' : 'NUEVO PEDIDO DESDE QR'}</small>
          <b>${esc(row.table.code || row.table.name || 'Mesa')}${esc(seatLabel(row.order))}</b>
          <span>${Number(row.order.items?.length || 0)} producto(s) · ${money(row.order.total)}</span>
          <small class="summary">${esc(itemSummary(row.order))}</small>
        </div>
        <button type="button" class="wv-qr-order-action" data-open-qr-order="${esc(row.order.id)}" data-table-id="${esc(row.table.id)}" data-zone-id="${esc(row.table.zoneId || '')}">ABRIR MESA</button>
      </section>`).join('');
    root.querySelectorAll('[data-open-qr-order]').forEach((button) => button.addEventListener('click', () => openAlert(button)));
  }

  function warmAudio() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      if (!state.audioContext) state.audioContext = new AudioContext();
      state.audioContext.resume?.().catch(() => {});
    } catch {}
  }

  function notifyOnce() {
    try {
      warmAudio();
      const ctx = state.audioContext;
      if (ctx?.state === 'running') {
        const now = ctx.currentTime;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.15, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
        gain.connect(ctx.destination);
        for (const [offset, frequency] of [[0, 740], [0.18, 980]]) {
          const osc = ctx.createOscillator();
          osc.frequency.setValueAtTime(frequency, now + offset);
          osc.connect(gain);
          osc.start(now + offset);
          osc.stop(now + offset + 0.15);
        }
      }
    } catch {}
    try { navigator.vibrate?.([220, 80, 220]); } catch {}
  }

  function selectTable(tableId, zoneId) {
    const clickTable = () => document.querySelector(`#wvTables .wv-table[data-table="${CSS.escape(tableId)}"]`)?.click();
    const zone = document.getElementById('wvZone');
    if (zone && zoneId && zone.value !== zoneId) {
      zone.value = zoneId;
      zone.dispatchEvent(new Event('change', { bubbles:true }));
      setTimeout(clickTable, 120);
      setTimeout(clickTable, 350);
      return;
    }
    clickTable();
  }

  function openAlert(button) {
    const orderId = button?.dataset.openQrOrder || '';
    const tableId = button?.dataset.tableId || '';
    const zoneId = button?.dataset.zoneId || '';
    if (orderId) {
      markSeen(orderId);
      state.alerts.delete(orderId);
      const pending = state.pending.get(orderId);
      if (pending) clearTimeout(pending);
      state.pending.delete(orderId);
      render();
    }
    if (tableId) selectTable(tableId, zoneId);
  }

  async function hydrate(detail) {
    const refs = detail?.refs || {};
    const sessionId = refs.sessionId;
    const tableId = refs.tableId;
    if (!sessionId || !tableId) return null;
    const [tables, orders] = await Promise.all([
      api('/api/v1/restaurante/mesas'),
      api(`/api/v1/restaurante/pedidos?sessionId=${encodeURIComponent(sessionId)}&limit=50`)
    ]);
    const table = (Array.isArray(tables) ? tables : []).find((row) => row.id === tableId);
    if (!table?.activeSession || table.activeSession.id !== sessionId) return null;
    const rows = (Array.isArray(orders) ? orders : []).filter((order) => order.source === 'QR');
    const order = refs.orderId ? rows.find((row) => row.id === refs.orderId) : rows[0];
    if (!order || wasSeen(order.id)) return null;
    return { table, order, createdAt:detail.at || order.creadoEn || new Date().toISOString(), escalated:false };
  }

  function show(row, escalated) {
    if (!row?.order?.id || wasSeen(row.order.id) || state.alerts.has(row.order.id)) return;
    state.pending.delete(row.order.id);
    state.alerts.set(row.order.id, { ...row, escalated:Boolean(escalated) });
    render();
    notifyOnce();
  }

  async function handleRealtime(detail) {
    if (state.destroyed) return;
    const topics = Array.isArray(detail?.topics) ? detail.topics : [];
    if (!topics.includes('restaurant.order')) return;
    if (detail?.meta?.source !== 'restaurant-public-qr') return;
    if (!String(detail?.meta?.path || '').includes('/pedidos')) return;
    let row;
    try { row = await hydrate(detail); } catch { return; }
    if (!row) return;
    const session = readSession();
    const openerId = row.table.activeSession?.openedByUserId || null;
    const currentUserId = session?.user?.id || null;
    if (!openerId || openerId === currentUserId) {
      show(row, false);
      return;
    }
    if (state.pending.has(row.order.id) || state.alerts.has(row.order.id)) return;
    const createdAt = new Date(row.createdAt || Date.now()).getTime();
    const elapsed = Number.isFinite(createdAt) ? Math.max(0, Date.now() - createdAt) : 0;
    const wait = Math.max(0, FALLBACK_MS - elapsed);
    const timer = setTimeout(() => {
      state.pending.delete(row.order.id);
      if (!state.destroyed && !wasSeen(row.order.id)) show(row, true);
    }, wait);
    state.pending.set(row.order.id, timer);
  }

  window.addEventListener('vantix:tenant-realtime', (event) => { handleRealtime(event.detail || {}).catch(() => {}); });
  window.addEventListener('pointerdown', warmAudio, { once:true, passive:true });
  window.addEventListener('beforeunload', () => {
    state.destroyed = true;
    for (const timer of state.pending.values()) clearTimeout(timer);
    state.pending.clear();
  }, { once:true });

  ensureUi();
  window.VantixGCWaiterQrOrderAlertV25 = Object.freeze({
    version:'25.0.0',
    realtime:true,
    source:'QR',
    primaryOpenedByWaiter:true,
    fallbackAllWaitersAfterMs:FALLBACK_MS,
    noPeriodicPolling:true
  });
})();
