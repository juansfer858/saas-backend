(() => {
  'use strict';

  const SESSION_KEY = 'vantixgc_platform_session_v1';
  const state = { releases: [], installations: [], loading: false };

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (m) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[m]));
  }

  function session() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  }

  async function platformApi(path, opts = {}) {
    const current = session();
    if (!current?.token) throw new Error('Sesión de plataforma requerida. Vuelve a ingresar al Panel SaaS.');
    const response = await fetch(path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${current.token}`,
        ...(opts.headers || {})
      }
    });
    let body = {};
    try { body = await response.json(); } catch {}
    if (!response.ok) throw new Error(body?.error?.message || body?.message || `HTTP ${response.status}`);
    return body;
  }

  function flash(message, bad = false) {
    const box = document.querySelector('#flash');
    if (!box) return;
    box.innerHTML = `<div class="${bad ? 'error' : 'notice'}">${esc(message)}</div>`;
  }

  function installStyles() {
    if (document.querySelector('#platform-edge-central-style')) return;
    const style = document.createElement('style');
    style.id = 'platform-edge-central-style';
    style.textContent = `
      #view[data-edge-view="1"]{display:block!important;width:100%!important;min-height:560px!important}
      .edge-shell{display:block;width:100%;min-height:560px}
      .edge-loading,.edge-error{display:flex;min-height:360px;align-items:center;justify-content:center;padding:32px}
      .edge-loading-card,.edge-error-card{width:min(760px,100%);background:#fff;border:1px solid var(--line,#e4e4e7);border-radius:16px;padding:24px;box-shadow:0 12px 35px rgba(24,34,29,.08)}
      .edge-spinner{width:34px;height:34px;border:3px solid #dbe8e2;border-top-color:#0d6b43;border-radius:50%;animation:edgeSpin .8s linear infinite;margin-bottom:14px}
      .edge-error-card{border-color:#fecaca}
      .edge-action-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
      .edge-action-row .select{min-width:190px}
      .edge-release-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px}
      .edge-release-list .card{margin:0!important}
      .edge-cancel{margin-top:6px}
      @keyframes edgeSpin{to{transform:rotate(360deg)}}
      @media(max-width:700px){.edge-loading,.edge-error{padding:12px}.edge-action-row .select{min-width:0;width:100%}}
    `;
    document.head.appendChild(style);
  }

  function targetView() {
    return document.querySelector('#view');
  }

  function markNavActive(button) {
    document.querySelectorAll('[data-v]').forEach((x) => x.classList.remove('active'));
    button?.classList.add('active');
  }

  function renderLoading() {
    const target = targetView();
    if (!target) return;
    target.dataset.edgeView = '1';
    target.innerHTML = `<div class="edge-shell"><h1>Actualizaciones Edge</h1>
      <div class="muted">Control central de todos los agentes Edge desde SaaS Master.</div>
      <div class="edge-loading"><div class="edge-loading-card"><div class="edge-spinner"></div><h3 style="margin:0 0 6px">Cargando flota Edge…</h3><div class="muted">Consultando releases globales, instalaciones y despliegues.</div></div></div></div>`;
  }

  function renderError(error) {
    const target = targetView();
    if (!target) return;
    target.dataset.edgeView = '1';
    target.innerHTML = `<div class="edge-shell"><h1>Actualizaciones Edge</h1>
      <div class="edge-error"><div class="edge-error-card"><h3 style="margin-top:0">No se pudo abrir Actualizaciones Edge</h3>
      <p>${esc(error?.message || error || 'Error desconocido')}</p>
      <p class="muted">No se envió ninguna actualización a los restaurantes.</p>
      <button class="btn primary" id="edgeRetry">Reintentar</button></div></div></div>`;
    document.querySelector('#edgeRetry')?.addEventListener('click', () => loadEdgeView());
  }

  function ensureEdgeNav() {
    const nav = document.querySelector('.nav');
    if (!nav) return;
    let button = nav.querySelector('[data-v="edge"]');
    if (!button) {
      button = document.createElement('button');
      button.dataset.v = 'edge';
      button.textContent = 'Actualizaciones Edge';
      nav.appendChild(button);
    }
    button.onclick = () => {
      markNavActive(button);
      loadEdgeView();
    };
  }

  const originalRenderShell = window.renderShell;
  if (typeof originalRenderShell === 'function') {
    window.renderShell = function platformRenderShell() {
      const result = originalRenderShell();
      setTimeout(() => { installStyles(); ensureEdgeNav(); }, 0);
      return result;
    };
  }

  installStyles();
  ensureEdgeNav();
  const navObserver = new MutationObserver(() => ensureEdgeNav());
  navObserver.observe(document.documentElement, { childList: true, subtree: true });

  function releaseOptions() {
    return state.releases.map((r) => `<option value="${esc(r.id)}">${esc(r.version)} · ${esc(r.channel)}</option>`).join('');
  }

  function releaseCards() {
    if (!state.releases.length) return '<div class="muted">Todavía no hay releases Edge globales.</div>';
    return `<div class="edge-release-list">${state.releases.map((r) => `<div class="card">
      <b>${esc(r.version)}</b> <span class="badge ${r.channel === 'PILOT' ? 'warn' : 'ok'}">${esc(r.channel)}</span>
      <div class="muted" style="font-size:12px;margin:6px 0 10px">${esc(r.releaseNotes || 'Sin notas')}</div>
      <div class="toolbar"><button class="btn" data-rollout="${esc(r.id)}" data-scope="CHANNEL">Actualizar ${esc(r.channel)}</button><button class="btn" data-rollout="${esc(r.id)}" data-scope="ALL">Actualizar todos</button></div>
    </div>`).join('')}</div>`;
  }

  function installationRows() {
    if (!state.installations.length) return '<tr><td colspan="8">No hay instalaciones Edge registradas.</td></tr>';
    return state.installations.map((row) => {
      const i = row.installation || {}, a = row.agent || {}, t = row.tenant || {}, d = row.deployment || null;
      const online = Boolean(i.online);
      const deploymentCell = d
        ? `<span class="badge warn">${esc(d.state)}</span><br><small>${esc(d.targetVersion || '')}</small><br><button class="btn edge-cancel" data-cancel-deployment="${esc(i.edgeAgentId || '')}">Cancelar despliegue</button>`
        : '<span class="muted">Sin despliegue activo</span>';
      return `<tr>
        <td><b>${esc(t.nombreEmpresa || '—')}</b><br><small>${esc(t.subdomain || '')}</small></td>
        <td>${esc(a.pointCode || '—')}<br><small>${esc(a.name || '')}</small></td>
        <td><span class="badge ${online ? 'ok' : 'bad'}">${online ? 'ONLINE' : 'OFFLINE'}</span></td>
        <td>${esc(i.softwareVersion || '—')}<br><small>Deseada: ${esc(i.desiredVersion || '—')}</small></td>
        <td><select class="select" data-edge-channel="${esc(i.edgeAgentId || '')}"><option ${i.releaseChannel === 'PILOT' ? 'selected' : ''}>PILOT</option><option ${i.releaseChannel === 'STABLE' ? 'selected' : ''}>STABLE</option></select></td>
        <td>${deploymentCell}</td>
        <td>${esc(i.updaterState || 'IDLE')}</td>
        <td><div class="edge-action-row"><select class="select" data-release-for="${esc(i.edgeAgentId || '')}">${releaseOptions()}</select><button class="btn" data-deploy="${esc(i.edgeAgentId || '')}" ${(state.releases.length && !d) ? '' : 'disabled'}>${d ? 'Cancela primero' : 'Actualizar ahora'}</button></div></td>
      </tr>`;
    }).join('');
  }

  async function refreshEdgeOverview() {
    const response = await platformApi('/platform/api/edge/overview');
    state.releases = Array.isArray(response.data?.releases) ? response.data.releases : [];
    state.installations = Array.isArray(response.data?.installations) ? response.data.installations : [];
    return response.data || {};
  }

  function renderEdgeView() {
    const target = targetView();
    if (!target) throw new Error('El contenedor principal del Panel SaaS no está disponible.');
    target.dataset.edgeView = '1';
    target.innerHTML = `<div class="edge-shell"><h1>Actualizaciones Edge</h1>
      <div class="muted">Control central de todos los agentes. Los restaurantes no publican releases ni ejecutan despliegues.</div>
      <div class="panel"><div class="ph"><strong>Publicar release global</strong><span class="badge ok">PLATFORM ONLY</span></div>
        <div style="padding:16px"><div class="grid">
          <div class="field"><label>Versión</label><input class="input" id="edgeVersion" placeholder="2.1.5"></div>
          <div class="field"><label>Canal</label><select class="select" id="edgeChannel"><option>PILOT</option><option>STABLE</option></select></div>
          <div class="field"><label>Auto rollout</label><select class="select" id="edgeAuto"><option value="true">Sí, al canal</option><option value="false">No, sólo publicar</option></select></div>
        </div>
        <div class="field"><label>URL del ZIP</label><input class="input" id="edgeUrl"></div>
        <div class="field"><label>SHA-256</label><input class="input" id="edgeSha"></div>
        <div class="field"><label>Notas</label><input class="input" id="edgeNotes"></div>
        <button class="btn primary" id="edgePublish">Publicar desde Master</button></div></div>
      <div class="panel"><div class="ph"><strong>Releases globales</strong><button class="btn" id="edgeRefresh">Actualizar</button></div><div style="padding:12px">${releaseCards()}</div></div>
      <div class="panel"><div class="ph"><strong>Flota Edge</strong><span class="muted">${state.installations.length} instalaciones</span></div><div class="table-wrap"><table class="table"><thead><tr><th>Empresa</th><th>Punto</th><th>Estado</th><th>Versión</th><th>Canal</th><th>Despliegue</th><th>Updater</th><th>Acción Master</th></tr></thead><tbody>${installationRows()}</tbody></table></div></div></div>`;
    bindEdgeActions();
  }

  async function loadEdgeView() {
    if (state.loading) return;
    state.loading = true;
    renderLoading();
    try {
      await refreshEdgeOverview();
      renderEdgeView();
    } catch (error) {
      console.error('[Platform Edge]', error);
      renderError(error);
    } finally {
      state.loading = false;
    }
  }

  function bindEdgeActions() {
    document.querySelector('#edgeRefresh')?.addEventListener('click', loadEdgeView);
    document.querySelector('#edgePublish')?.addEventListener('click', async () => {
      try {
        await platformApi('/platform/api/edge/releases', { method: 'POST', body: JSON.stringify({
          version: document.querySelector('#edgeVersion')?.value.trim(),
          channel: document.querySelector('#edgeChannel')?.value,
          artifactUrl: document.querySelector('#edgeUrl')?.value.trim(),
          sha256: document.querySelector('#edgeSha')?.value.trim(),
          releaseNotes: document.querySelector('#edgeNotes')?.value.trim() || null,
          autoRollout: document.querySelector('#edgeAuto')?.value === 'true'
        }) });
        flash('Release Edge global publicado por Plataforma.');
        await loadEdgeView();
      } catch (error) { flash(error.message, true); }
    });
    document.querySelectorAll('[data-rollout]').forEach((button) => button.addEventListener('click', async () => {
      try {
        await platformApi(`/platform/api/edge/releases/${encodeURIComponent(button.dataset.rollout)}/rollout`, { method: 'POST', body: JSON.stringify({ scope: button.dataset.scope }) });
        flash('Rollout Edge programado.');
        await loadEdgeView();
      } catch (error) { flash(error.message, true); }
    }));
    document.querySelectorAll('[data-edge-channel]').forEach((select) => select.addEventListener('change', async () => {
      try {
        await platformApi(`/platform/api/edge/installations/${encodeURIComponent(select.dataset.edgeChannel)}/channel`, { method: 'PATCH', body: JSON.stringify({ channel: select.value }) });
        flash('Canal Edge actualizado desde Master.');
      } catch (error) { flash(error.message, true); await loadEdgeView(); }
    }));
    document.querySelectorAll('[data-cancel-deployment]').forEach((button) => button.addEventListener('click', async () => {
      if (!confirm('¿Cancelar este despliegue Edge? Se limpiará la versión deseada y el updater quedará en IDLE.')) return;
      try {
        await platformApi(`/platform/api/edge/installations/${encodeURIComponent(button.dataset.cancelDeployment)}/cancel-deployment`, {
          method: 'POST',
          body: JSON.stringify({ reason: 'Recuperación de despliegue Edge atascado desde SaaS Master' })
        });
        flash('Despliegue Edge cancelado. Ya se puede recuperar el agente local sin que repita la versión defectuosa.');
        await loadEdgeView();
      } catch (error) { flash(error.message, true); }
    }));
    document.querySelectorAll('[data-deploy]').forEach((button) => button.addEventListener('click', async () => {
      const releaseId = document.querySelector(`[data-release-for="${CSS.escape(button.dataset.deploy)}"]`)?.value;
      if (!releaseId) return flash('Selecciona primero un release global.', true);
      try {
        const response = await platformApi(`/platform/api/edge/installations/${encodeURIComponent(button.dataset.deploy)}/deploy`, { method: 'POST', body: JSON.stringify({ releaseId }) });
        if (response.data?.result?.status === 'ACTIVE_DEPLOYMENT') return flash('Ese Edge ya tiene un despliegue activo. Cancélalo antes de enviar otro.', true);
        flash('Actualización enviada al Edge.');
        await loadEdgeView();
      } catch (error) { flash(error.message, true); }
    }));
  }

  window.VantixPlatformEdgeRollout = { loadEdgeView, refreshEdgeOverview };
})();
