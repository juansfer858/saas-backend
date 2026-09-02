(() => {
  'use strict';

  const SESSION_KEY = 'vantixgc_core_session_v1';
  const ADMIN_PWA_MARKER = 'VANTIXGC_ADMIN_PWA_V1';
  let deferredInstallPrompt = null;

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  }

  function htmlEscape(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    })[char]);
  }

  async function fetchRuntime(path) {
    const session = readSession();
    if (!session?.token || !session?.subdomain) throw new Error('Sesión no disponible para runtime UI');
    const response = await fetch(path, {
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${session.token}`,
        'x-tenant-subdomain': session.subdomain
      }
    });
    if (!response.ok) throw new Error(`Runtime UI ${response.status}: ${path}`);
    return response.text();
  }

  async function fetchJson(path, options = {}) {
    const session = readSession();
    if (!session?.token || !session?.subdomain) throw new Error('Sesión no disponible');
    const response = await fetch(path, {
      ...options,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${session.token}`,
        'x-tenant-subdomain': session.subdomain,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    let body = {};
    try { body = await response.json(); } catch {}
    if (!response.ok) throw new Error(body?.error?.message || body?.message || `HTTP ${response.status}`);
    return body.data;
  }

  function executeSource(source, name) {
    const script = document.createElement('script');
    script.textContent = `${source}\n//# sourceURL=${name}`;
    document.head.appendChild(script);
    script.remove();
  }

  function isStandalone() {
    return window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;
  }

  function ensureInstallButton() {
    if (!deferredInstallPrompt || isStandalone() || document.querySelector('#coreAdminInstall')) return;
    const userbox = document.querySelector('.userbox');
    if (!userbox) return;
    const button = document.createElement('button');
    button.id = 'coreAdminInstall';
    button.type = 'button';
    button.className = 'btn small';
    button.textContent = 'Instalar app';
    button.title = 'Instalar VantixGC Administración en este equipo';
    button.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      try { await deferredInstallPrompt.userChoice; } catch {}
      deferredInstallPrompt = null;
      button.remove();
    });
    const logout = userbox.querySelector('#logout');
    if (logout) userbox.insertBefore(button, logout);
    else userbox.appendChild(button);
  }

  function installAdminPwa() {
    if (!document.querySelector('link[data-vantix-admin-manifest]')) {
      const link = document.createElement('link');
      link.rel = 'manifest';
      link.href = '/app/admin-manifest.webmanifest';
      link.dataset.vantixAdminManifest = 'v1';
      document.head.appendChild(link);
    }
    if (!document.querySelector('link[data-vantix-admin-apple-icon]')) {
      const icon = document.createElement('link');
      icon.rel = 'apple-touch-icon';
      icon.href = '/app/admin-icon.svg';
      icon.dataset.vantixAdminAppleIcon = 'v1';
      document.head.appendChild(icon);
    }
    if (!document.querySelector('meta[name="theme-color"]')) {
      const theme = document.createElement('meta');
      theme.name = 'theme-color';
      theme.content = '#137a53';
      document.head.appendChild(theme);
    }
    if (!document.querySelector('meta[name="apple-mobile-web-app-capable"]')) {
      const capable = document.createElement('meta');
      capable.name = 'apple-mobile-web-app-capable';
      capable.content = 'yes';
      document.head.appendChild(capable);
    }

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      ensureInstallButton();
    });
    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      document.querySelector('#coreAdminInstall')?.remove();
    });

    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.register('/app/admin-sw.js', { scope: '/app/' })
        .then((registration) => {
          window[ADMIN_PWA_MARKER] = Object.freeze({
            version: '1.0.0',
            installable: true,
            scope: registration.scope,
            noAuthenticatedApiCache: true
          });
        })
        .catch((error) => console.error('SUPER_CORE_ADMIN_PWA_SW_ERROR', error));
    }
  }

  function inventoryProductAdjustable(product) {
    return product?.tipo !== 'SERVICIO' && product?.controlaInventario === true && product?.activo !== false;
  }

  function installInventoryAdjustmentLibrary() {
    window.openInventoryAdjustment = async function openInventoryAdjustmentLibrary() {
      let products = [];
      let selected = null;
      let searchTimer = null;
      let requestSeq = 0;

      async function loadProducts(query = '') {
        const seq = ++requestSeq;
        const suffix = query.trim() ? `&q=${encodeURIComponent(query.trim())}` : '';
        const data = await fetchJson(`/api/v1/inventario/productos?activo=true&limit=500${suffix}`);
        if (seq !== requestSeq) return;
        products = Array.isArray(data) ? data : [];
        renderLibrary();
      }

      function renderLibrary() {
        const list = document.querySelector('#adjProductLibrary');
        const count = document.querySelector('#adjProductCount');
        if (!list) return;
        if (count) count.textContent = `${products.length} producto${products.length === 1 ? '' : 's'}`;
        if (!products.length) {
          list.innerHTML = '<div class="empty" style="padding:24px 12px">No se encontraron productos activos.</div>';
          return;
        }
        list.innerHTML = products.map((product) => {
          const adjustable = inventoryProductAdjustable(product);
          const active = selected?.id === product.id;
          const stock = Number(product.stockActual || 0).toFixed(4);
          const label = adjustable ? 'Ajustable' : (product.tipo === 'SERVICIO' ? 'Servicio' : 'Sin control de inventario');
          return `<button type="button" data-adj-product="${htmlEscape(product.id)}" ${adjustable ? '' : 'disabled'} style="appearance:none;width:100%;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;text-align:left;padding:11px 12px;margin:0;border:1px solid ${active ? '#137a53' : '#e4e7ec'};border-radius:10px;background:${active ? '#eef8f3' : '#fff'};color:#18221d;cursor:${adjustable ? 'pointer' : 'not-allowed'};opacity:${adjustable ? '1' : '.55'}"><span style="min-width:0"><strong style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${htmlEscape(product.sku)} · ${htmlEscape(product.nombre)}</strong><small style="display:block;margin-top:3px;color:#667085">Stock ${htmlEscape(stock)} ${htmlEscape(product.unidadMedida || '')}${product.codigoBarras ? ` · ${htmlEscape(product.codigoBarras)}` : ''}</small></span><span class="badge ${adjustable ? 'b-paid' : 'b-draft'}">${htmlEscape(label)}</span></button>`;
        }).join('');
        list.querySelectorAll('[data-adj-product]:not([disabled])').forEach((button) => {
          button.addEventListener('click', () => {
            selected = products.find((product) => product.id === button.dataset.adjProduct) || null;
            const hidden = document.querySelector('#adjProduct');
            const summary = document.querySelector('#adjSelectedProduct');
            if (hidden) hidden.value = selected?.id || '';
            if (summary) summary.innerHTML = selected
              ? `<strong>${htmlEscape(selected.sku)} · ${htmlEscape(selected.nombre)}</strong><span class="muted">Stock actual: ${Number(selected.stockActual || 0).toFixed(4)} ${htmlEscape(selected.unidadMedida || '')}</span>`
              : '<span class="muted">Ningún producto seleccionado.</span>';
            renderLibrary();
          });
        });
      }

      try {
        products = await fetchJson('/api/v1/inventario/productos?activo=true&limit=500');
        if (!Array.isArray(products)) products = [];
      } catch (error) {
        alert(error.message);
        return;
      }

      document.querySelector('#adjustModal')?.remove();
      document.body.insertAdjacentHTML('beforeend', `<div class="modal-back" id="adjustModal"><form class="modal" id="adjustModalForm" style="width:min(720px,100%);max-height:92vh;overflow:auto"><h2>Ajuste contable de inventario</h2><div class="field"><label>Producto</label><input class="input" id="adjProductSearch" placeholder="Buscar por nombre, SKU o código de barras" autocomplete="off"><input type="hidden" id="adjProduct" required><div style="display:flex;justify-content:space-between;align-items:center;margin:7px 0"><span class="muted">Biblioteca de productos</span><span class="muted" id="adjProductCount"></span></div><div id="adjProductLibrary" style="display:grid;gap:7px;max-height:260px;overflow:auto;padding:2px"></div><div id="adjSelectedProduct" class="notice" style="display:grid;gap:4px;margin-top:9px"><span class="muted">Selecciona un producto de la biblioteca.</span></div></div><div class="grid2"><div class="field"><label>Tipo</label><select class="select" id="adjType"><option value="AJUSTE_SALIDA">Faltante</option><option value="MERMA">Merma</option><option value="AJUSTE_ENTRADA">Sobrante</option></select></div><div class="field"><label>Cantidad</label><input class="input" id="adjQty" type="number" min="0.0001" step="0.0001" required></div></div><div class="field"><label>Costo unitario (solo sobrante; vacío usa regla del motor)</label><input class="input" id="adjCost" type="number" min="0" step="0.0001"></div><div class="field"><label>Justificación obligatoria</label><textarea class="input" id="adjReason" rows="3" required></textarea></div><div id="adjustModalError"></div><div class="actions" style="justify-content:flex-end;margin-top:16px"><button class="btn" type="button" id="adjCancel">Cancelar</button><button class="btn primary" type="submit">Registrar ajuste</button></div></form></div>`);

      renderLibrary();
      document.querySelector('#adjCancel')?.addEventListener('click', () => document.querySelector('#adjustModal')?.remove());
      document.querySelector('#adjProductSearch')?.addEventListener('input', (event) => {
        clearTimeout(searchTimer);
        const query = event.target.value;
        searchTimer = setTimeout(() => {
          loadProducts(query).catch((error) => {
            const box = document.querySelector('#adjustModalError');
            if (box) box.innerHTML = `<div class="error">${htmlEscape(error.message)}</div>`;
          });
        }, 220);
      });

      document.querySelector('#adjustModalForm').onsubmit = async (event) => {
        event.preventDefault();
        const errorBox = document.querySelector('#adjustModalError');
        if (errorBox) errorBox.innerHTML = '';
        try {
          if (!selected || !inventoryProductAdjustable(selected)) throw new Error('Selecciona un producto con control de inventario activo.');
          const costRaw = document.querySelector('#adjCost').value;
          await fetchJson('/api/v1/inventario/ajustes', {
            method: 'POST',
            body: JSON.stringify({
              productoId: selected.id,
              tipo: document.querySelector('#adjType').value,
              cantidad: Number(document.querySelector('#adjQty').value),
              costoUnitario: costRaw ? Number(costRaw) : undefined,
              justificacion: document.querySelector('#adjReason').value,
              sourceId: `WEB-INV-${Date.now()}`
            })
          });
          document.querySelector('#adjustModal')?.remove();
          if (typeof window.render === 'function') await window.render();
        } catch (error) {
          if (errorBox) errorBox.innerHTML = `<div class="error">${htmlEscape(error.message)}</div>`;
        }
      };
    };

    window.VantixGCInventoryAdjustmentLibraryV2 = Object.freeze({
      version: '2.0.0',
      remoteSearch: true,
      showsFullActiveLibrary: true,
      disablesNonInventoryProducts: true
    });
  }

  async function start() {
    installAdminPwa();
    try {
      const [realtime, realtimePanel, core, printing] = await Promise.all([
        fetchRuntime('/app/vantix-tenant-realtime.js?v=tenant-realtime-v1'),
        fetchRuntime('/app/core-realtime-panel-ui.js?v=core-realtime-v1'),
        fetchRuntime('/api/v1/comercial/ui-runtime/panel-integration-extras-core.js'),
        fetchRuntime('/api/v1/comercial/ui-runtime/panel-printing-config.js')
      ]);
      executeSource(realtime, 'vantix-tenant-realtime.js');
      executeSource(realtimePanel, 'core-realtime-panel-ui.js');
      executeSource(core, 'panel-integration-extras-core.js');
      executeSource(printing, 'panel-printing-config.js');
      installInventoryAdjustmentLibrary();
      ensureInstallButton();

      // El Core hace su primer render antes de que la capa de impresoras/estaciones
      // pueda extender viewConfig. Si estamos entrando directamente a Configuración,
      // renderizamos una vez más para que la sección operativa sea visible de inmediato.
      if (location.pathname === '/app/configuracion' && typeof window.render === 'function') {
        await window.render();
        requestAnimationFrame(() => {
          const target = location.hash ? document.querySelector(location.hash) : null;
          target?.scrollIntoView?.({ block: 'start' });
        });
      }
    } catch (error) {
      console.error('SUPER_CORE_INTEGRATION_RUNTIME_ERROR', error);
    }
  }

  start();
})();
