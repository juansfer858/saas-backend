(() => {
  const SESSION_KEY = 'vantixgc_core_session_v1';
  const WARNING = 'MODO FISCAL SIMULADO AUTORIZADO POR PLATAFORMA: los documentos emitidos bajo este modo NO tienen validez fiscal ante la DIAN y no deben presentarse como fiscalmente validados. Los documentos ya emitidos conservarán permanentemente su marca SIMULATED aunque después se habilite DIAN real.';
  let accepted = false;

  function session() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
  }

  async function load() {
    const current = session();
    if (!current?.token || !current?.subdomain) return;
    try {
      const response = await fetch('/api/v1/restaurante/status', {
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${current.token}`,
          'x-tenant-subdomain': current.subdomain
        }
      });
      const body = await response.json();
      accepted = Boolean(body?.data?.gates?.simulatedFiscalOperationExplicitlyAccepted);
      render();
    } catch {}
  }

  function render() {
    const gate = document.querySelector('#gate');
    if (!gate) return;
    const existing = gate.querySelector('.fiscal-simulated-warning');
    if (!accepted) {
      if (existing) existing.remove();
      return;
    }
    if (existing) return;
    const warning = document.createElement('div');
    warning.className = 'ri-error fiscal-simulated-warning';
    warning.textContent = WARNING;
    gate.appendChild(warning);
  }

  const observer = new MutationObserver(render);
  window.addEventListener('load', () => {
    const gate = document.querySelector('#gate');
    if (gate) observer.observe(gate, { childList: true, subtree: true });
    load();
  });
  setTimeout(load, 500);
})();
