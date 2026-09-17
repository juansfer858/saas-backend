/* VANTIX_RESTAURANT_V2_MENU_EXPORT_V130 */
(() => {
  'use strict';

  const R = window.RestaurantV2;
  if (!R) return;
  const session = R.requireSession();

  function downloadName(disposition) {
    const match = String(disposition || '').match(/filename="?([^";]+)"?/i);
    return match?.[1] || `Carta_${new Date().toISOString().slice(0, 10)}.xls`;
  }

  function feedback(message, error = false) {
    const notice = document.getElementById('notice');
    if (!notice) return;
    notice.hidden = false;
    notice.textContent = message;
    notice.classList.toggle('error', error);
  }

  async function exportCarta() {
    const button = document.getElementById('exportCarta');
    if (!button || button.disabled) return;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Exportando…';
    try {
      const response = await fetch('/api/v1/restaurante/carta-importacion/exportar', {
        cache:'no-store',
        headers:{
          Authorization:`Bearer ${session.token}`,
          'x-tenant-subdomain':session.subdomain
        }
      });
      if (response.status === 401) {
        localStorage.removeItem('vantixgc_core_session_v1');
        location.replace('/app/login');
        return;
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error?.message || payload?.message || `HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = downloadName(response.headers.get('content-disposition'));
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      feedback('Carta exportada correctamente a Excel.');
    } catch (error) {
      feedback(error.message || 'No fue posible exportar la Carta.', true);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  function boot() {
    document.getElementById('exportCarta')?.addEventListener('click', exportCarta);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();

  window.VantixGCRestaurantMenuExportV130 = Object.freeze({
    marker:'VANTIX_RESTAURANT_V2_MENU_EXPORT_V130',
    version:'130.0.0',
    format:'xls',
    readOnly:true,
    exportCarta
  });
})();
