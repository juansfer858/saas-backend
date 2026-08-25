(() => {
  'use strict';

  const SESSION_KEY = 'vantixgc_core_session_v1';
  const ORIGIN_KEY = 'vantixgc_core_origin_v1';
  const DASHBOARD_PATH = '/app/dashboard';
  const ANALYTICS_ENDPOINT = '/api/v1/comercial/ventas/dashboard';
  let analytics = null;
  let decorated = false;

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  }

  function titleCase(value) {
    return String(value || 'CORE')
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/(^|\s)\S/g, (m) => m.toUpperCase());
  }

  function localMonthStart() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}-01`;
  }

  function rememberOrigin(target) {
    try {
      const session = readSession();
      const targetUrl = new URL(target, window.location.origin);
      if (!targetUrl.pathname.startsWith('/app/')) return;
      sessionStorage.setItem(ORIGIN_KEY, JSON.stringify({
        tenant: session?.subdomain || '',
        from: `${window.location.pathname}${window.location.search}${window.location.hash}`,
        fromLabel: 'Dashboard',
        targetPath: targetUrl.pathname.replace(/\/$/, '') || '/app',
        createdAt: Date.now()
      }));
    } catch {}
  }

  function navigate(path) {
    rememberOrigin(path);
    window.location.href = path;
  }

  async function apiData(path) {
    const session = readSession();
    if (!session?.token || !session?.subdomain) throw new Error('Sesión no disponible');
    const response = await fetch(path, {
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${session.token}`,
        'x-tenant-subdomain': session.subdomain
      }
    });
    let body = {};
    try { body = await response.json(); } catch {}
    if (!response.ok) throw new Error(body?.error?.message || body?.message || `Error HTTP ${response.status}`);
    return body.data;
  }

  function makeActionable(element, action, label) {
    if (!element || element.dataset.coreActionable === '1') return;
    element.dataset.coreActionable = '1';
    element.tabIndex = 0;
    element.setAttribute('role', 'button');
    if (label) element.setAttribute('aria-label', label);
    element.classList.add('core-dash-actionable');
    element.addEventListener('click', (event) => {
      if (event.target.closest('button,a,input,select')) return;
      action();
    });
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        action();
      }
    });
  }

  function closeReportModal() {
    document.getElementById('coreDashboardReportModal')?.remove();
  }

  async function downloadReport(format) {
    const session = readSession();
    if (!session?.token || !session?.subdomain) return;
    const button = document.querySelector(`[data-dashboard-report-download="${format}"]`);
    const original = button?.textContent;
    if (button) {
      button.disabled = true;
      button.textContent = 'Generando…';
    }
    try {
      const offset = new Date().getTimezoneOffset();
      const response = await fetch(`/api/v1/comercial/ventas/dashboard/exportar?formato=${encodeURIComponent(format)}&tzOffsetMinutes=${encodeURIComponent(offset)}`, {
        headers: {
          Authorization: `Bearer ${session.token}`,
          'x-tenant-subdomain': session.subdomain
        }
      });
      if (!response.ok) {
        let error = {};
        try { error = await response.json(); } catch {}
        throw new Error(error?.error?.message || `No fue posible generar el informe (${response.status})`);
      }
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const match = disposition.match(/filename="?([^";]+)"?/i);
      const extension = format === 'pdf' ? 'pdf' : 'xls';
      const filename = match?.[1] || `Informe_Dashboard.${extension}`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      const target = document.getElementById('coreDashboardReportError');
      if (target) target.textContent = error.message;
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = original;
      }
    }
  }

  function openReportModal() {
    closeReportModal();
    const session = readSession();
    const tenant = session?.tenant || {};
    const niche = titleCase(tenant.nicho || 'CORE');
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-back" id="coreDashboardReportModal"><div class="modal core-dashboard-report-modal"><div class="core-dashboard-report-head"><div><h2>Informe ejecutivo</h2><p>${escapeHtml(tenant.nombreEmpresa || session?.subdomain || 'Empresa')} · ${escapeHtml(niche)}</p></div><button class="btn small" type="button" data-dashboard-report-close>×</button></div><div class="core-dashboard-report-sections"><div><strong>1</strong><span>Identificación de empresa</span></div><div><strong>2</strong><span>Resumen ejecutivo</span></div><div><strong>3</strong><span>Ventas últimos 7 días</span></div><div><strong>4</strong><span>Top productos</span></div><div><strong>5</strong><span>Indicadores del negocio</span></div></div><p class="muted core-dashboard-report-note">El informe usa datos reales del tenant y conserva divisiones formales para archivo, impresión y análisis.</p><div id="coreDashboardReportError" class="danger-text core-dashboard-report-error"></div><div class="actions core-dashboard-report-actions"><button class="btn" type="button" data-dashboard-report-download="excel">Exportar Excel</button><button class="btn primary" type="button" data-dashboard-report-download="pdf">Exportar PDF</button></div></div></div>`);
    document.querySelector('[data-dashboard-report-close]')?.addEventListener('click', closeReportModal);
    document.querySelector('[data-dashboard-report-download="excel"]')?.addEventListener('click', () => downloadReport('excel'));
    document.querySelector('[data-dashboard-report-download="pdf"]')?.addEventListener('click', () => downloadReport('pdf'));
    document.getElementById('coreDashboardReportModal')?.addEventListener('click', (event) => {
      if (event.target.id === 'coreDashboardReportModal') closeReportModal();
    });
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
  }

  function installHeaderActions(root) {
    const pagehead = root.querySelector('.core-dash-pagehead');
    if (!pagehead || pagehead.querySelector('[data-dashboard-actions]')) return;
    const session = readSession();
    const tenant = session?.tenant || {};
    const subtitle = pagehead.querySelector('p');
    if (subtitle) subtitle.textContent = `Resumen operativo · ${titleCase(tenant.nicho || 'CORE')}`;
    const actions = document.createElement('div');
    actions.className = 'actions core-dashboard-actions';
    actions.dataset.dashboardActions = 'true';
    actions.innerHTML = '<button class="btn" type="button" data-dashboard-refresh>Actualizar</button><button class="btn primary" type="button" data-dashboard-reports>Informes</button>';
    pagehead.appendChild(actions);
    actions.querySelector('[data-dashboard-refresh]')?.addEventListener('click', () => window.location.reload());
    actions.querySelector('[data-dashboard-reports]')?.addEventListener('click', openReportModal);
  }

  function installKpiActions(root) {
    const cards = [...root.querySelectorAll('.core-dash-kpi')];
    const monthStart = localMonthStart();
    const actions = [
      () => {
        const day = analytics?.salesByDay?.at(-1)?.date;
        navigate(day ? `/app/ventas?desde=${encodeURIComponent(day)}&hasta=${encodeURIComponent(day)}` : '/app/ventas');
      },
      () => navigate(`/app/ventas?desde=${encodeURIComponent(monthStart)}`),
      () => navigate(`/app/ventas?desde=${encodeURIComponent(monthStart)}`),
      () => navigate('/app/cartera')
    ];
    const labels = ['Ver ventas de hoy', 'Ver ventas del mes', 'Ver ventas usadas para el ticket promedio', 'Abrir cartera pendiente'];
    cards.forEach((card, index) => makeActionable(card, actions[index] || (() => {}), labels[index]));
  }

  function installChartActions(root) {
    const daySlots = [...root.querySelectorAll('.core-dash-bar-slot')];
    daySlots.forEach((slot, index) => {
      const day = analytics?.salesByDay?.[index]?.date;
      if (day) makeActionable(slot, () => navigate(`/app/ventas?desde=${encodeURIComponent(day)}&hasta=${encodeURIComponent(day)}`), `Ver ventas del ${day}`);
    });

    const mainPanels = [...root.querySelectorAll('.core-dash-grid-main .core-dash-panel')];
    if (mainPanels[1]) makeActionable(mainPanels[1], () => navigate(`/app/ventas?desde=${encodeURIComponent(localMonthStart())}`), 'Ver ventas del mix de productos');

    const productRows = [...root.querySelectorAll('.core-dash-ranking-row')];
    productRows.forEach((row, index) => {
      const product = analytics?.topProducts?.[index];
      if (!product) return;
      makeActionable(row, () => showProductDetail(product), `Ver detalle de ${product.nombre}`);
    });
  }

  function showProductDetail(product) {
    document.getElementById('coreDashboardProductModal')?.remove();
    const share = Number(product.participacion || 0).toLocaleString('es-CO', { maximumFractionDigits: 1 });
    const sales = Number(product.ventas || 0).toLocaleString('es-CO');
    const qty = Number(product.cantidad || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 });
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-back" id="coreDashboardProductModal"><div class="modal core-dashboard-product-modal"><h2>${escapeHtml(product.nombre || 'Producto')}</h2><div class="kv"><div>SKU</div><div>${escapeHtml(product.sku || '—')}</div><div>Unidades vendidas</div><div><strong>${qty}</strong></div><div>Ventas del mes</div><div><strong>$ ${sales}</strong></div><div>Participación</div><div>${share}%</div></div><div class="actions" style="justify-content:flex-end;margin-top:18px"><button class="btn" type="button" data-product-close>Cerrar</button><button class="btn primary" type="button" data-product-inventory>Ir a Inventarios</button></div></div></div>`);
    document.querySelector('[data-product-close]')?.addEventListener('click', () => document.getElementById('coreDashboardProductModal')?.remove());
    document.querySelector('[data-product-inventory]')?.addEventListener('click', () => navigate('/app/inventario'));
  }

  function installOperationalActions(root) {
    root.querySelectorAll('.core-dash-op-card').forEach((card) => {
      const label = card.querySelector('span')?.textContent?.trim().toLowerCase() || '';
      let action = () => {};
      if (label.includes('pedido') || label.includes('mesa')) action = () => navigate('/app/centro-de-control');
      else if (label.includes('stock')) action = () => navigate('/app/inventario?stockCritico=1');
      else if (label.includes('producto')) action = () => navigate('/app/inventario');
      else if (label.includes('cobro') || label.includes('cartera')) action = () => navigate('/app/cartera');
      else if (label.includes('venta')) action = () => navigate(`/app/ventas?desde=${encodeURIComponent(localMonthStart())}`);
      makeActionable(card, action, `Abrir detalle: ${label}`);
    });
  }

  async function decorateDashboard() {
    if (window.location.pathname !== DASHBOARD_PATH || decorated) return;
    const root = document.querySelector('[data-core-dashboard-analytics]');
    if (!root) return;
    decorated = true;
    try {
      const offset = new Date().getTimezoneOffset();
      analytics = await apiData(`${ANALYTICS_ENDPOINT}?tzOffsetMinutes=${encodeURIComponent(offset)}`);
    } catch {
      analytics = null;
    }
    installHeaderActions(root);
    installKpiActions(root);
    installChartActions(root);
    installOperationalActions(root);
  }

  function watch() {
    if (window.location.pathname !== DASHBOARD_PATH) return;
    const observer = new MutationObserver(() => {
      if (!decorated && document.querySelector('[data-core-dashboard-analytics]')) decorateDashboard();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    decorateDashboard();
    setTimeout(() => observer.disconnect(), 15000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch, { once: true });
  else watch();
})();
