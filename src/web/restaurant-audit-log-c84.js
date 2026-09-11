(() => {
  'use strict';

  const MARKER = 'VANTIX_RESTAURANT_AUDIT_LOG_C84';
  const BUSINESS_MARKER = 'VANTIX_RESTAURANT_BUSINESS_AUDIT_C85';
  const SESSION_KEY = 'vantixgc_core_session_v1';
  const PAGE_PATH = '/app/configuracion-avanzada';
  const ENDPOINT = '/api/v1/restaurante/auditoria/v84?limit=200';
  if (window[MARKER] || location.pathname !== PAGE_PATH) return;
  window[MARKER] = Object.freeze({ version:'84.1.0', surface:'ADMIN_ADVANCED', readOnly:true });
  window[BUSINESS_MARKER] = Object.freeze({ version:'85.0.0', surface:'ADMIN_ADVANCED', readOnly:true, businessChanges:true });

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'
  }[char]));

  function session() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  }

  function isRestaurantTenant() {
    const niche = String(session()?.tenant?.nicho || '').toUpperCase();
    return ['RESTAURANTE','RESTAURANT'].includes(niche)
      || document.documentElement.dataset.coreRestaurantAccess === '1';
  }

  async function api(path) {
    const current = session();
    if (!current?.token || !current?.subdomain) throw new Error('Sesión no disponible');
    const response = await fetch(path, {
      cache:'no-store',
      headers:{
        Authorization:`Bearer ${current.token}`,
        'x-tenant-subdomain':current.subdomain
      }
    });
    let body = {};
    try { body = await response.json(); } catch {}
    if (response.status === 401) {
      localStorage.removeItem(SESSION_KEY);
      location.replace('/app');
      throw new Error('Sesión vencida');
    }
    if (!response.ok) throw new Error(body?.error?.message || body?.message || `HTTP ${response.status}`);
    return body.data;
  }

  function ensureStyles() {
    if (document.getElementById('restaurantAuditLogC84Styles')) return;
    const style = document.createElement('style');
    style.id = 'restaurantAuditLogC84Styles';
    style.textContent = `
      .rca-audit-note{padding:12px 14px;border:1px solid #b7dfc8;border-radius:10px;background:#f0f9f4;color:#365d49;font-size:12px;line-height:1.45;margin-bottom:14px}
      .rca-audit-list{display:grid;gap:10px}
      .rca-audit-row{border:1px solid #d7dde1;border-radius:11px;background:#fff;padding:12px 14px}
      .rca-audit-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
      .rca-audit-title{font-weight:850;color:#18221d;font-size:13px}
      .rca-audit-date{font-size:11px;color:#667085;white-space:nowrap}
      .rca-audit-meta{font-size:11px;color:#667085;line-height:1.5;margin-top:6px}
      .rca-audit-module{display:inline-block;padding:2px 7px;border-radius:999px;background:#eef2f6;color:#344054;font-size:10px;font-weight:800;margin-right:6px}
      .rca-audit-reason{font-size:12px;color:#344054;margin-top:7px;padding:8px 10px;background:#f8fafc;border-radius:8px}
      .rca-audit-details{margin-top:8px;font-size:11px;color:#667085}
      .rca-audit-details pre{white-space:pre-wrap;word-break:break-word;background:#0f172a;color:#e2e8f0;padding:10px;border-radius:8px;max-height:220px;overflow:auto}
      @media(max-width:700px){.rca-audit-top{display:block}.rca-audit-date{margin-top:4px}}
    `;
    document.head.appendChild(style);
  }

  function auditMarkup(data = {}) {
    const items = Array.isArray(data.items) ? data.items : [];
    const rows = items.map((item) => {
      const who = item.user?.name || item.user?.email || 'Usuario';
      const when = item.at ? new Date(item.at).toLocaleString('es-CO') : 'Fecha no disponible';
      const metadata = item.metadata ? esc(JSON.stringify(item.metadata, null, 2)) : '';
      return `<div class="rca-audit-row">
        <div class="rca-audit-top">
          <div><div class="rca-audit-title">${item.module ? `<span class="rca-audit-module">${esc(item.module)}</span>` : ''}${esc(item.label || item.action || 'Actividad')}</div><div class="rca-audit-meta">${esc(who)}${item.user?.role ? ` · ${esc(item.user.role)}` : ''} · ${esc(item.entity || '')}</div></div>
          <div class="rca-audit-date">${esc(when)}</div>
        </div>
        ${item.reason ? `<div class="rca-audit-reason"><strong>Motivo:</strong> ${esc(item.reason)}</div>` : ''}
        ${metadata ? `<details class="rca-audit-details"><summary>Ver detalle del cambio</summary><pre>${metadata}</pre></details>` : ''}
      </div>`;
    }).join('');

    return `<div class="panel" data-restaurant-audit-log="${MARKER}" data-business-audit="${BUSINESS_MARKER}">
      <div class="ph">
        <div><strong>Auditoría / Registro de actividad</strong><div class="muted" style="font-size:12px;margin-top:4px">Historial administrativo del restaurante. Esta vista es sólo lectura.</div></div>
        <span class="badge ok">AUDITORÍA</span>
      </div>
      <div class="pb">
        <div class="rca-audit-note"><strong>Este historial no se elimina con Limpieza de pruebas.</strong> Además de reinicios y limpiezas, registra cambios reales de negocio en Carta, ventas, Caja/Tesorería, clientes, inventario, empleados, pagos, seguridad y configuración. No registra clics, consultas ni eventos técnicos repetitivos.</div>
        <div class="rca-audit-list">${rows || '<div class="muted">Aún no hay registros de auditoría para mostrar.</div>'}</div>
      </div>
    </div>`;
  }

  async function loadAudit() {
    const view = document.getElementById('view');
    if (!view) return;
    view.innerHTML = '<div class="panel"><div class="pb">Cargando auditoría…</div></div>';
    try {
      const data = await api(ENDPOINT);
      view.innerHTML = auditMarkup(data || {});
    } catch (error) {
      view.innerHTML = `<div class="error">${esc(error.message)}</div>`;
    }
  }

  function activateAuditTab(button) {
    document.querySelectorAll('.tabs .tab').forEach((tab) => tab.classList.remove('active'));
    button.classList.add('active');
    loadAudit();
  }

  function install(attempt = 0) {
    if (!isRestaurantTenant()) {
      if (attempt < 30) setTimeout(() => install(attempt + 1), 100);
      return;
    }
    ensureStyles();
    const tabs = document.querySelector('.tabs');
    if (!tabs) {
      if (attempt < 40) setTimeout(() => install(attempt + 1), 100);
      return;
    }
    if (tabs.querySelector('[data-restaurant-audit-tab]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab';
    button.dataset.restaurantAuditTab = 'c84';
    button.textContent = 'Auditoría';
    button.addEventListener('click', () => activateAuditTab(button));
    const cleanup = tabs.querySelector('[data-restaurant-test-reset-tab]');
    if (cleanup) cleanup.insertAdjacentElement('afterend', button);
    else tabs.appendChild(button);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => install(), { once:true });
  else install();
})();
