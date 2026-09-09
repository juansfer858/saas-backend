(() => {
  'use strict';

  const MARKER = 'VANTIX_RESTAURANT_V1_RETIREMENT_PANEL_P11';
  const SESSION_KEY = 'vantixgc_core_session_v1';
  document.documentElement.dataset.restaurantV1RetirementPanel = MARKER;
  let session = null; try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch {}
  if (!session?.token || !session?.subdomain) { location.replace('/app'); return; }
  const $ = (q) => document.querySelector(q);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m]));

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      cache:'no-store',
      headers:{ Authorization:`Bearer ${session.token}`, 'x-tenant-subdomain':session.subdomain, ...(options.body ? { 'Content-Type':'application/json' } : {}), ...(options.headers || {}) }
    });
    let body = {}; try { body = await response.json(); } catch {}
    if (response.status === 401) { localStorage.removeItem(SESSION_KEY); location.replace('/app'); throw new Error('Sesión vencida'); }
    if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`);
    return body.data;
  }
  function message(text, ok = false) {
    const box = $('#message');
    box.hidden = !text;
    box.className = `message${ok ? ' ok' : ''}`;
    box.textContent = text || '';
  }
  function gate(label, ok, detail) {
    return `<div class="gate ${ok ? 'ok' : 'bad'}"><small>${esc(label)}</small><strong>${ok ? '✓ LISTO' : '× PENDIENTE'}</strong><span class="muted">${esc(detail)}</span></div>`;
  }
  function render(data) {
    const root = $('#stateCard');
    const retirement = data.retirement || {};
    const pilot = data.pilot || {};
    const cutover = data.cutover || {};
    const ready = Boolean(data.readiness?.ready);
    const enabled = Boolean(retirement.enabled);
    root.innerHTML = `<div class="state-top"><div><span class="eyebrow">ESTADO DEL TENANT</span><h2>${enabled ? 'V1 retirado de la operación normal' : 'Compatibilidad P10 activa'}</h2><p>${enabled ? 'Las entradas normales usan el Centro de Control V2 nativo. V1 sólo existe como rollback técnico.' : 'V2 es principal por P10, pero el Centro de Control todavía conserva el shell de compatibilidad hasta activar P11.'}</p></div><span class="pill ${enabled ? 'on' : 'off'}">${enabled ? 'V2 ONLY NORMAL' : 'P10 COMPAT'}</span></div>
      <div class="gates">${gate('Piloto P9', Boolean(pilot.enabled), pilot.enabled ? 'Piloto activo' : 'Debe estar activo')}${gate('Cutover P10', Boolean(cutover.enabled), cutover.enabled ? 'V2 ya es principal' : 'Activa V2 como principal')}${gate('Readiness', ready, ready ? 'Requisitos operativos completos' : (data.blockers || []).join(', ') || 'Faltan requisitos')}</div>
      <div class="safety"><span>QR tokens intactos</span><span>Rollback preservado</span><span>DIAN no gate</span><span>Sin borrar V1</span><span>Sin tocar ventas/sesiones</span></div>
      <div class="actions">${enabled ? '<button type="button" class="secondary" data-restore>RESTAURAR COMPATIBILIDAD P10</button><button type="button" data-open>ABRIR CENTRO DE CONTROL</button>' : `<button type="button" data-activate ${data.canActivate ? '' : 'disabled'}>RETIRAR V1 DE LA OPERACIÓN NORMAL</button>`}</div>`;

    $('[data-activate]')?.addEventListener('click', () => change(true));
    $('[data-restore]')?.addEventListener('click', () => change(false));
    $('[data-open]')?.addEventListener('click', () => location.assign('/app/centro-de-control'));
  }
  async function load() {
    message('');
    try { render(await api('/api/v1/restaurante/v2/retiro-v1')); }
    catch (error) { message(error.message); $('#stateCard').innerHTML = '<div class="loading">No fue posible leer P11.</div>'; }
  }
  async function change(enabled) {
    const button = enabled ? $('[data-activate]') : $('[data-restore]');
    if (button) button.disabled = true;
    message(enabled ? 'Retirando V1 de la operación normal…' : 'Restaurando compatibilidad P10…', true);
    try {
      await api('/api/v1/restaurante/v2/retiro-v1', { method:'PATCH', body:JSON.stringify({ enabled, notes:enabled ? 'P11 V1 normal operation retired after successful V2 pilot/cutover' : 'P11 compatibility rollback requested' }) });
      message(enabled ? 'P11 activo. Las entradas normales ya usarán el Centro de Control V2 nativo.' : 'Compatibilidad P10 restaurada.', true);
      await load();
    } catch (error) {
      message(error.message);
      if (button) button.disabled = false;
    }
  }

  load();
})();
