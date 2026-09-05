(() => {
  'use strict';
  const MARKER = 'VANTIX_EDGE_TENANT_PLATFORM_MANAGED_V1';
  window[MARKER] = true;

  function cards() { return [...document.querySelectorAll('.card')]; }
  function removeReleasePublisher() {
    for (const card of cards()) {
      const title = card.querySelector('h3')?.textContent?.trim();
      if (title === 'Publicar release') card.remove();
    }
  }
  function removeTenantUpdateRelay() {
    const option = [...document.querySelectorAll('#relayAction option')]
      .find((x) => x.textContent.trim() === 'UPDATE_CHECK');
    option?.remove();
  }
  function rewriteHeaderCopy() {
    const top = document.querySelector('.top .muted');
    if (top) top.textContent = 'Estado local, offline, impresión y Cloud Relay. Las actualizaciones son administradas por VantixGC SaaS.';
    const section = document.querySelector('#installations')?.closest('.card')?.querySelector('.section-title .muted');
    if (section) section.textContent = 'Identidad, salud, LAN, Relay y versión instalada. Releases y despliegues se administran desde Plataforma.';
  }
  function sanitizeInstallations() {
    const table = document.querySelector('#installations table');
    if (!table) return;
    const headers = [...table.querySelectorAll('thead th')].map((x) => x.textContent.trim());
    const channelIndex = headers.indexOf('Canal');
    const deploymentIndex = headers.indexOf('Despliegue');
    for (const row of table.querySelectorAll('tbody tr')) {
      const cells = row.querySelectorAll('td');
      if (channelIndex >= 0 && cells[channelIndex]) {
        const value = cells[channelIndex].querySelector('select')?.value || cells[channelIndex].textContent.trim() || '—';
        cells[channelIndex].innerHTML = `<span class="tag">${value}</span><br><span class="mini muted">Gestionado por SaaS Master</span>`;
      }
      if (deploymentIndex >= 0 && cells[deploymentIndex]) {
        const activeTag = cells[deploymentIndex].querySelector('.tag');
        const activeText = activeTag ? cells[deploymentIndex].textContent.trim() : '';
        cells[deploymentIndex].innerHTML = activeTag
          ? `<span class="tag">${activeText}</span><br><span class="mini muted">Controlado por Plataforma</span>`
          : '<span class="mini muted">Gestionado por SaaS Master</span>';
      }
    }
  }
  function harden() {
    removeReleasePublisher();
    removeTenantUpdateRelay();
    rewriteHeaderCopy();
    sanitizeInstallations();
  }

  const originalRender = window.renderInstallations;
  if (typeof originalRender === 'function') {
    window.renderInstallations = function managedRenderInstallations(data) {
      const result = originalRender(data);
      harden();
      return result;
    };
  }
  window.deploy = () => window.msg?.('Las actualizaciones Edge se administran desde el Panel SaaS Master.', true);
  window.setChannel = () => window.msg?.('El canal de actualización se administra desde el Panel SaaS Master.', true);
  [0, 50, 200, 1000].forEach((ms) => setTimeout(harden, ms));
})();
