(() => {
  'use strict';
  const state = { releases: [], installations: [] };

  function ensureEdgeNav() {
    const nav = document.querySelector('.nav');
    if (!nav || nav.querySelector('[data-v="edge"]')) return;
    const button = document.createElement('button');
    button.dataset.v = 'edge';
    button.textContent = 'Actualizaciones Edge';
    button.onclick = () => {
      document.querySelectorAll('[data-v]').forEach((x) => x.classList.remove('active'));
      button.classList.add('active');
      window.view = 'edge';
      loadEdgeView().catch((e) => window.flash?.(e.message, true));
    };
    nav.appendChild(button);
  }

  const originalRenderShell = window.renderShell;
  if (typeof originalRenderShell === 'function') {
    window.renderShell = function platformRenderShell() {
      const result = originalRenderShell();
      setTimeout(ensureEdgeNav, 0);
      return result;
    };
  }
  ensureEdgeNav();

  function releaseOptions() {
    return state.releases.map((r) => `<option value="${r.id}">${window.esc(r.version)} · ${window.esc(r.channel)}</option>`).join('');
  }

  function releaseCards() {
    if (!state.releases.length) return '<div class="muted">Todavía no hay releases Edge globales.</div>';
    return state.releases.map((r) => `<div class="card" style="margin:8px 0">
      <b>${window.esc(r.version)}</b> <span class="badge ${r.channel === 'PILOT' ? 'warn' : 'ok'}">${window.esc(r.channel)}</span>
      <div class="muted" style="font-size:12px;margin:6px 0">${window.esc(r.releaseNotes || 'Sin notas')}</div>
      <div class="toolbar"><button class="btn" data-rollout="${r.id}" data-scope="CHANNEL">Actualizar ${r.channel}</button><button class="btn" data-rollout="${r.id}" data-scope="ALL">Actualizar todos</button></div>
    </div>`).join('');
  }

  function installationRows() {
    if (!state.installations.length) return '<tr><td colspan="8">No hay instalaciones Edge registradas.</td></tr>';
    return state.installations.map((row) => {
      const i = row.installation, a = row.agent || {}, t = row.tenant || {}, d = row.deployment;
      const online = i.online;
      return `<tr>
        <td><b>${window.esc(t.nombreEmpresa || '—')}</b><br><small>${window.esc(t.subdomain || '')}</small></td>
        <td>${window.esc(a.pointCode || '—')}<br><small>${window.esc(a.name || '')}</small></td>
        <td><span class="badge ${online ? 'ok' : 'bad'}">${online ? 'ONLINE' : 'OFFLINE'}</span></td>
        <td>${window.esc(i.softwareVersion || '—')}<br><small>Deseada: ${window.esc(i.desiredVersion || '—')}</small></td>
        <td><select class="select" data-edge-channel="${i.edgeAgentId}"><option ${i.releaseChannel === 'PILOT' ? 'selected' : ''}>PILOT</option><option ${i.releaseChannel === 'STABLE' ? 'selected' : ''}>STABLE</option></select></td>
        <td>${d ? `<span class="badge warn">${window.esc(d.state)}</span><br><small>${window.esc(d.targetVersion)}</small>` : '<span class="muted">Sin despliegue activo</span>'}</td>
        <td>${window.esc(i.updaterState || 'IDLE')}</td>
        <td><select class="select" data-release-for="${i.edgeAgentId}">${releaseOptions()}</select> <button class="btn" data-deploy="${i.edgeAgentId}" ${state.releases.length ? '' : 'disabled'}>Actualizar ahora</button></td>
      </tr>`;
    }).join('');
  }

  async function refreshEdgeOverview() {
    const response = await window.api('/platform/api/edge/overview');
    state.releases = response.data?.releases || [];
    state.installations = response.data?.installations || [];
    return response.data;
  }

  async function loadEdgeView() {
    await refreshEdgeOverview();
    const target = document.querySelector('#view');
    if (!target) return;
    target.innerHTML = `<h1>Actualizaciones Edge</h1>
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
      <div class="panel"><div class="ph"><strong>Flota Edge</strong><span class="muted">${state.installations.length} instalaciones</span></div><div class="table-wrap"><table class="table"><thead><tr><th>Empresa</th><th>Punto</th><th>Estado</th><th>Versión</th><th>Canal</th><th>Despliegue</th><th>Updater</th><th>Acción Master</th></tr></thead><tbody>${installationRows()}</tbody></table></div></div>`;
    bindEdgeActions();
  }

  function bindEdgeActions() {
    document.querySelector('#edgeRefresh')?.addEventListener('click', () => loadEdgeView().catch((e) => window.flash?.(e.message, true)));
    document.querySelector('#edgePublish')?.addEventListener('click', async () => {
      try {
        await window.api('/platform/api/edge/releases', { method: 'POST', body: JSON.stringify({
          version: document.querySelector('#edgeVersion').value.trim(),
          channel: document.querySelector('#edgeChannel').value,
          artifactUrl: document.querySelector('#edgeUrl').value.trim(),
          sha256: document.querySelector('#edgeSha').value.trim(),
          releaseNotes: document.querySelector('#edgeNotes').value.trim() || null,
          autoRollout: document.querySelector('#edgeAuto').value === 'true'
        }) });
        window.flash?.('Release Edge global publicado por Plataforma.');
        await loadEdgeView();
      } catch (e) { window.flash?.(e.message, true); }
    });
    document.querySelectorAll('[data-rollout]').forEach((button) => button.addEventListener('click', async () => {
      try {
        await window.api(`/platform/api/edge/releases/${button.dataset.rollout}/rollout`, { method: 'POST', body: JSON.stringify({ scope: button.dataset.scope }) });
        window.flash?.('Rollout Edge programado.');
        await loadEdgeView();
      } catch (e) { window.flash?.(e.message, true); }
    }));
    document.querySelectorAll('[data-edge-channel]').forEach((select) => select.addEventListener('change', async () => {
      try {
        await window.api(`/platform/api/edge/installations/${select.dataset.edgeChannel}/channel`, { method: 'PATCH', body: JSON.stringify({ channel: select.value }) });
        window.flash?.('Canal Edge actualizado desde Master.');
      } catch (e) { window.flash?.(e.message, true); await loadEdgeView(); }
    }));
    document.querySelectorAll('[data-deploy]').forEach((button) => button.addEventListener('click', async () => {
      const releaseId = document.querySelector(`[data-release-for="${button.dataset.deploy}"]`)?.value;
      if (!releaseId) return;
      try {
        await window.api(`/platform/api/edge/installations/${button.dataset.deploy}/deploy`, { method: 'POST', body: JSON.stringify({ releaseId }) });
        window.flash?.('Actualización enviada al Edge.');
        await loadEdgeView();
      } catch (e) { window.flash?.(e.message, true); }
    }));
  }

  window.VantixPlatformEdgeRollout = { loadEdgeView, refreshEdgeOverview };
})();
