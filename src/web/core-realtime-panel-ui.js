(() => {
  'use strict';

  if (window.VantixGCCoreRealtimeUi) return;
  let refreshTimer = null;
  let pendingEvent = null;
  let live = false;

  function ensurePill() {
    let pill = document.getElementById('coreRealtimePill');
    if (pill) return pill;
    const topbar = document.querySelector('.topbar');
    if (!topbar) return null;
    pill = document.createElement('span');
    pill.id = 'coreRealtimePill';
    pill.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:10px;padding:5px 9px;border:1px solid #cfd8d3;border-radius:999px;background:#f8faf9;color:#61706a;font-size:10px;font-weight:800;letter-spacing:.05em;white-space:nowrap';
    pill.innerHTML = '<span style="width:7px;height:7px;border-radius:50%;background:#94a3b8"></span> SINCRONIZANDO';
    const tenant = topbar.querySelector('.tenant,.core-shell-tenant');
    tenant?.parentElement?.appendChild(pill);
    return pill;
  }

  function setLive(value) {
    live = Boolean(value);
    const pill = ensurePill();
    if (!pill) return;
    pill.innerHTML = `<span style="width:7px;height:7px;border-radius:50%;background:${live ? '#118a57' : '#94a3b8'}"></span>${live ? ' EN VIVO' : ' RECONECTANDO'}`;
    pill.style.color = live ? '#0d6b43' : '#61706a';
  }

  function activeEdit() {
    if (document.querySelector('.modal-back,.modal[open],dialog[open]')) return true;
    const node = document.activeElement;
    return Boolean(node && ['INPUT','TEXTAREA','SELECT'].includes(node.tagName));
  }

  function relevantForCurrentPage(event) {
    const path = location.pathname;
    const topics = new Set(Array.isArray(event?.topics) ? event.topics : []);
    if (path.startsWith('/app/tesoreria')) return topics.has('treasury') || topics.has('restaurant.account') || topics.has('restaurant');
    if (path.startsWith('/app/dashboard')) return true;
    if (path.startsWith('/app/ventas')) return topics.has('commercial') || topics.has('treasury') || topics.has('restaurant');
    if (path.startsWith('/app/inventario')) return topics.has('inventory') || topics.has('restaurant.order') || topics.has('restaurant');
    if (path.startsWith('/app/cartera')) return topics.has('portfolio') || topics.has('commercial') || topics.has('treasury');
    if (path.startsWith('/app/contabilidad')) return topics.has('accounting') || topics.has('treasury') || topics.has('commercial') || topics.has('restaurant.account');
    return false;
  }

  function runRefresh() {
    refreshTimer = null;
    const event = pendingEvent;
    pendingEvent = null;
    if (!event || !relevantForCurrentPage(event)) return;
    if (activeEdit()) {
      pendingEvent = event;
      refreshTimer = setTimeout(runRefresh, 700);
      return;
    }
    if (typeof window.render === 'function') {
      Promise.resolve(window.render()).catch(() => {});
      return;
    }
    window.dispatchEvent(new CustomEvent('vantix:core-realtime-refresh', { detail:event }));
  }

  function queueRefresh(event) {
    pendingEvent = event;
    if (refreshTimer) return;
    refreshTimer = setTimeout(runRefresh, 90);
  }

  window.addEventListener('vantix:tenant-realtime-ready', () => {
    setLive(true);
    queueRefresh({ topics:['restaurant','treasury','commercial','accounting','inventory','portfolio'], meta:{ source:'reconnect' } });
  });
  window.addEventListener('vantix:tenant-realtime', (event) => {
    setLive(true);
    queueRefresh(event.detail || {});
  });
  window.addEventListener('offline', () => setLive(false));

  window.VantixGCCoreRealtimeUi = Object.freeze({ version:'1.0.0', live:() => live, refresh:queueRefresh });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensurePill, { once:true });
  else ensurePill();
})();
