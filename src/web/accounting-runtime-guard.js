(() => {
  'use strict';

  // Capa de resiliencia para la suite contable. No reemplaza el módulo existente:
  // corrige el acoplamiento de carga inicial, evita estados "Cargando..." infinitos
  // y deja diagnóstico visible/console cuando un endpoint falla.
  const REQUEST_TIMEOUT_MS = 15000;
  const resourceErrors = Object.create(null);

  const resources = {
    accounts: {
      path: '/api/v1/contabilidad/cuentas?limit=3000',
      apply: (body) => { st.accounts = body.data || []; }
    },
    third: {
      path: '/api/v1/terceros?limit=1000',
      apply: (body) => { st.third = body.data || []; }
    },
    types: {
      path: '/api/v1/contabilidad/tipos-comprobante',
      apply: (body) => { st.types = body.data || []; }
    },
    vats: {
      path: '/api/v1/contabilidad/impuestos/iva',
      apply: (body) => { st.vats = body.data || []; }
    },
    retentions: {
      path: '/api/v1/contabilidad/impuestos/retenciones',
      apply: (body) => { st.retentions = body.data || []; }
    },
    assets: {
      path: '/api/v1/contabilidad/activos-fijos',
      apply: (body) => { st.assets = body.data || []; }
    },
    banks: {
      path: '/api/v1/tesoreria/cajas-bancos',
      apply: (body) => { st.banks = (body.data || []).filter((x) => x.tipo === 'BANCO' && x.activo !== false); }
    },
    periods: {
      path: '/api/v1/contabilidad/periodos?limit=120',
      apply: (body) => { st.periods = body.data || []; }
    }
  };

  const labels = {
    puc: 'Plan de Cuentas',
    diario: 'Libro Diario',
    manual: 'Comprobante Manual',
    mayor: 'Libro Mayor / Auxiliar',
    reportes: 'Reportes Financieros',
    terceros: 'Terceros',
    periodos: 'Periodos',
    impuestos: 'Impuestos',
    activos: 'Activos Fijos',
    conciliacion: 'Conciliación Bancaria'
  };

  const rawApi = api;

  // Timeout y diagnóstico uniforme para que una petición colgada no deje la UI
  // indefinidamente en estado de carga.
  api = async function guardedApi(path, opts = {}) {
    const controller = new AbortController();
    const inheritedSignal = opts.signal;
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let unlink = null;

    if (inheritedSignal) {
      const abort = () => controller.abort();
      inheritedSignal.addEventListener('abort', abort, { once: true });
      unlink = () => inheritedSignal.removeEventListener('abort', abort);
    }

    try {
      return await rawApi(path, { ...opts, signal: controller.signal });
    } catch (error) {
      const timeout = controller.signal.aborted && !inheritedSignal?.aborted;
      const enriched = new Error(timeout
        ? `La solicitud excedió ${REQUEST_TIMEOUT_MS / 1000}s: ${path}`
        : `${error?.message || 'Error de comunicación'} · ${path}`);
      enriched.cause = error;
      enriched.path = path;
      console.error('[VantixGC Accounting API]', {
        path,
        message: enriched.message,
        cause: error
      });
      throw enriched;
    } finally {
      clearTimeout(timer);
      if (unlink) unlink();
    }
  };

  async function loadResource(key) {
    const def = resources[key];
    if (!def) return false;
    try {
      const body = await api(def.path);
      def.apply(body);
      delete resourceErrors[key];
      return true;
    } catch (error) {
      resourceErrors[key] = error;
      console.error(`[VantixGC Accounting] Error cargando recurso ${key}`, error);
      return false;
    }
  }

  // Antes un solo fallo en Impuestos/Activos/Periodos hacía fallar Promise.all y
  // dejaba también el PUC sin cargar. Ahora cada recurso es independiente.
  loadBase = async function resilientLoadBase() {
    await Promise.allSettled(Object.keys(resources).map((key) => loadResource(key)));
    return st;
  };

  async function ensureResources(keys) {
    const failed = [];
    for (const key of keys) {
      if (resourceErrors[key]) {
        const ok = await loadResource(key);
        if (!ok) failed.push(key);
      }
    }
    if (failed.length) {
      const messages = failed.map((key) => `${key}: ${resourceErrors[key]?.message || 'error'}`);
      throw new Error(messages.join(' | '));
    }
  }

  moveAccounts = function robustMoveAccounts() {
    return (st.accounts || []).filter((account) => account && account.activa !== false && account.permiteMovimiento === true);
  };

  accountOptions = function robustAccountOptions(selected = '', predicate = () => true) {
    const available = moveAccounts().filter(predicate);
    if (!available.length) {
      return '<option value="">No hay cuentas auxiliares disponibles</option>';
    }
    const empty = selected ? '' : '<option value="">Seleccione una cuenta auxiliar</option>';
    return empty + available.map((account) => {
      const nature = account.naturaleza === 'CREDITO' ? 'Crédito' : 'Débito';
      return `<option value="${account.id}" ${account.id === selected ? 'selected' : ''}>${esc(account.codigo)} · ${esc(account.nombre)} · ${nature}</option>`;
    }).join('');
  };

  function loadErrorCard(section, error) {
    const view = $('#view');
    const title = labels[section] || section;
    view.innerHTML = `<div class="panel"><div class="panel-head"><h2>${esc(title)}</h2></div><div class="error" style="margin:16px">Error al cargar esta vista: ${esc(error?.message || 'Error desconocido')}</div><div class="toolbar" style="padding:0 16px 16px"><button class="btn primary" id="retryAccountingView">Reintentar</button></div></div>`;
    $('#retryAccountingView')?.addEventListener('click', () => renderTab());
  }

  const syncRequirements = {
    puc: ['accounts'],
    manual: ['accounts', 'third', 'types'],
    mayor: ['accounts'],
    terceros: ['third'],
    periodos: ['periods'],
    impuestos: ['accounts', 'vats', 'retentions'],
    activos: ['accounts', 'third', 'assets'],
    conciliacion: ['banks']
  };

  const originalRenderPuc = renderPuc;
  renderPuc = function guardedRenderPuc() {
    if (!st.accounts.length && resourceErrors.accounts) throw resourceErrors.accounts;
    return originalRenderPuc();
  };

  const originalRenderManual = renderManual;
  renderManual = function guardedRenderManual() {
    if (!moveAccounts().length) {
      throw new Error('El PUC no devolvió cuentas con Movimiento = Sí. Reintente la carga del Plan de Cuentas.');
    }
    return originalRenderManual();
  };

  const originalRenderMayor = renderMayor;
  renderMayor = function guardedRenderMayor() {
    if (!moveAccounts().length) {
      throw new Error('No hay cuentas auxiliares disponibles para consultar el Libro Mayor.');
    }
    return originalRenderMayor();
  };

  // La implementación anterior retornaba promesas dentro del try sin await;
  // un rechazo asíncrono escapaba del catch y la pantalla permanecía en
  // "Cargando...". Todas las vistas async quedan esperadas explícitamente.
  renderTab = async function guardedRenderTab() {
    const view = $('#view');
    if (!view) return;
    view.innerHTML = '<div class="panel"><div class="empty">Cargando...</div></div>';

    try {
      await ensureResources(syncRequirements[st.tab] || []);

      switch (st.tab) {
        case 'puc': await Promise.resolve(renderPuc()); break;
        case 'diario': await renderDiario(); break;
        case 'manual': await Promise.resolve(renderManual()); break;
        case 'mayor': await Promise.resolve(renderMayor()); break;
        case 'reportes': await Promise.resolve(renderReports()); break;
        case 'terceros': await Promise.resolve(renderThird()); break;
        case 'periodos': await Promise.resolve(renderPeriods()); break;
        case 'impuestos': await renderTaxes(); break;
        case 'activos': await Promise.resolve(renderAssets()); break;
        case 'conciliacion': await renderReconciliation(); break;
        default: throw new Error(`Vista contable desconocida: ${st.tab}`);
      }
    } catch (error) {
      console.error(`[VantixGC Accounting] ${labels[st.tab] || st.tab}`, error);
      loadErrorCard(st.tab, error);
    }
  };

  refreshBase = async function guardedRefreshBase() {
    await loadBase();
    return renderTab();
  };

  // Recupera la carga inicial que pudo haber fallado antes de que este guard se
  // instalara, sin bloquear recursos sanos por un endpoint defectuoso.
  Promise.resolve()
    .then(() => loadBase())
    .then(() => renderTab())
    .catch((error) => loadErrorCard(st.tab, error));
})();
