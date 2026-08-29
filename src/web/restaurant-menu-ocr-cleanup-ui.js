(() => {
  'use strict';
  const MARKER = 'VANTIX_MENU_OCR_CLEANUP_UI_V1';
  const SESSION_KEY = 'vantixgc_core_session_v1';

  function getSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
  }

  async function api(path, options = {}) {
    const session = getSession();
    if (!session?.token || !session?.subdomain) throw new Error('Sesión no disponible');
    const response = await fetch(path, {
      ...options,
      cache:'no-store',
      headers:{
        'Content-Type':'application/json',
        Authorization:`Bearer ${session.token}`,
        'x-tenant-subdomain':session.subdomain,
        ...(options.headers || {})
      }
    });
    let body = {};
    try { body = await response.json(); } catch {}
    if (!response.ok) throw new Error(body?.error?.message || body?.message || `HTTP ${response.status}`);
    return body.data;
  }

  function ensureStyle() {
    if (document.querySelector('#restaurantMenuOcrCleanupStyle')) return;
    const style = document.createElement('style');
    style.id = 'restaurantMenuOcrCleanupStyle';
    style.textContent = `
      .cc-ocr-danger{min-height:40px;padding:0 14px;border:1px solid #fda4af;border-radius:10px;background:#fff;color:#b42318;font-weight:850;cursor:pointer}
      .cc-ocr-danger:hover{background:#fff1f2}.cc-ocr-danger:disabled{opacity:.55;cursor:not-allowed}
      .cc-ocr-clear-preview{border-color:#fda4af!important;color:#b42318!important}
    `;
    document.head.appendChild(style);
  }

  function clearPreview() {
    const tbody = document.querySelector('#ccOcrTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const confirm = document.querySelector('#ccOcrConfirm');
    if (confirm) { confirm.disabled = true; confirm.textContent = 'Importar 0 productos'; }
  }

  function installPreviewButton() {
    const foot = document.querySelector('#ccOcrFoot');
    const table = document.querySelector('#ccOcrTable');
    if (!foot || !table || foot.hidden || foot.querySelector('#ccOcrClearReading')) return;
    ensureStyle();
    const button = document.createElement('button');
    button.id = 'ccOcrClearReading';
    button.type = 'button';
    button.className = 'cc-ocr-secondary cc-ocr-clear-preview';
    button.textContent = 'Borrar lectura';
    button.addEventListener('click', () => {
      if (!confirm('¿Borrar todos los productos de esta lectura antes de importar?')) return;
      clearPreview();
    });
    foot.insertBefore(button, foot.firstChild);
  }

  async function clearStoredOcr(button) {
    const accepted = confirm('Esto quitará de la carta todos los productos creados por importaciones OCR. No afecta productos creados manualmente ni borra el historial de ventas. ¿Continuar?');
    if (!accepted) return;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Borrando…';
    try {
      const result = await api('/api/v1/restaurante/carta-importacion/importados-ocr', { method:'DELETE' });
      alert(`Listo. Se quitaron ${Number(result?.productsDeactivated || 0)} producto(s) OCR de la carta.`);
      location.reload();
    } catch (error) {
      alert(`No se pudo borrar: ${error.message}`);
      button.disabled = false;
      button.textContent = original;
    }
  }

  function installStoredButton() {
    const custom = document.querySelector('#ccCustomView');
    if (!custom || custom.hidden || !/Carta y productos/i.test(custom.querySelector('h1')?.textContent || '')) return;
    const actions = custom.querySelector('.cc-view-actions');
    if (!actions || actions.querySelector('[data-menu-ocr-clear]')) return;
    ensureStyle();
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cc-ocr-danger';
    button.dataset.menuOcrClear = 'true';
    button.textContent = 'Borrar productos OCR';
    button.title = 'Quita únicamente productos creados por importaciones OCR; no toca productos manuales.';
    button.addEventListener('click', () => clearStoredOcr(button));
    actions.appendChild(button);
  }

  let scheduled = false;
  function install() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      installStoredButton();
      installPreviewButton();
    });
  }

  const observer = new MutationObserver(install);
  observer.observe(document.documentElement, { childList:true, subtree:true, attributes:true, attributeFilter:['hidden'] });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true }); else install();
  window.VantixGCRestaurantOcrCleanupUi = { marker:MARKER, clearPreview };
})();
