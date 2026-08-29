(() => {
  'use strict';
  const MARKER = 'VANTIX_EMPLOYEE_WORK_SCOPE_V1';
  const SESSION_KEY = 'vantixgc_core_session_v1';
  let session = null;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch {}
  if (!session?.token || !session?.subdomain) return;

  let context = null;
  let autoSelectedWaiterZone = false;
  let showAllProduction = false;
  let scheduled = false;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m]));
  const stationLabel = (station) => station === 'COCINA' ? 'Cocina' : station === 'BARRA' ? 'Barra' : station === 'POSTRES' ? 'Postres' : station;

  async function api(path) {
    const response = await fetch(path, {
      cache:'no-store',
      headers:{ Authorization:`Bearer ${session.token}`, 'x-tenant-subdomain':session.subdomain }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`);
    return body.data;
  }

  function ensureStyles() {
    if (document.querySelector('#restaurantEmployeeWorkRuntimeStyle')) return;
    const style = document.createElement('style');
    style.id = 'restaurantEmployeeWorkRuntimeStyle';
    style.textContent = `
      .work-scope-pill{display:inline-flex;align-items:center;gap:6px;min-height:28px;padding:4px 9px;border:1px solid #cbd5e1;border-radius:999px;background:#f8fafc;color:#334155;font-size:10px;font-weight:850}
      .work-scope-note{margin-top:7px;padding:8px 10px;border:1px solid #dbe5ea;border-radius:10px;background:#f8fafc;color:#475569;font-size:11px;font-weight:700}
      .waiter-table-chip.work-primary{outline:2px solid #d4a62a!important;outline-offset:-2px!important;box-shadow:0 7px 18px rgba(212,166,42,.16)!important}
      .work-primary-badge{display:block!important;margin-top:3px!important;color:#8a6710!important;font-size:9px!important;font-weight:950!important;text-transform:uppercase!important;letter-spacing:.04em!important}
      .kds-v2-lane[hidden]{display:none!important}
      .work-kds-scope{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:6px}
      @media(max-width:700px){.work-scope-note{font-size:10px}.work-scope-pill{font-size:9px}}
    `;
    document.head.appendChild(style);
  }

  function baseRole() {
    return String(context?.user?.baseRol || context?.workAssignment?.role || context?.user?.rol || '').toUpperCase();
  }

  function assignment() {
    return context?.workAssignment || { zoneIds:[], tableIds:[], tables:[], stations:[], mode:'FLEXIBLE', flexibleSupport:true };
  }

  function updateRoleLabel() {
    const label = document.querySelector('#userRole');
    if (!label || !context) return;
    const role = baseRole();
    const work = assignment();
    let next = label.textContent;
    if (['COCINA','BARRA','POSTRES'].includes(role)) {
      const stations = (work.stations?.length ? work.stations : [role]).map(stationLabel);
      next = `Producción · ${stations.join(' + ')}`;
    } else if (role === 'MESERO') next = 'MESERO';
    if (label.textContent !== next) label.textContent = next;
  }

  function preferredWaiterZones() {
    const work = assignment();
    return new Set([
      ...(work.zoneIds || []),
      ...(work.tables || []).map((table) => table.zoneId).filter(Boolean)
    ]);
  }

  function enhanceWaiter() {
    if (baseRole() !== 'MESERO') return;
    const select = document.querySelector('#waiterZone');
    if (!select) return;
    const work = assignment();
    const preferredZones = preferredWaiterZones();
    const assignedTables = new Set(work.tableIds || []);
    const optionSignature = `${[...preferredZones].sort().join(',')}|${[...select.options].map((option) => option.value).join(',')}`;

    if (select.dataset.workScopeSignature !== optionSignature) {
      const selectedBefore = select.value;
      const options = [...select.options];
      for (const option of options) {
        if (!option.dataset.workOriginalLabel) option.dataset.workOriginalLabel = option.textContent.replace(/^★\s*/, '');
        const preferred = preferredZones.has(option.value);
        const nextText = `${preferred ? '★ ' : ''}${option.dataset.workOriginalLabel}`;
        if (option.textContent !== nextText) option.textContent = nextText;
        option.dataset.workPreferred = preferred ? '1' : '0';
      }
      const preferredOptions = options.filter((option) => option.dataset.workPreferred === '1');
      const otherOptions = options.filter((option) => option.dataset.workPreferred !== '1');
      for (const option of [...preferredOptions, ...otherOptions]) select.appendChild(option);
      if ([...select.options].some((option) => option.value === selectedBefore)) select.value = selectedBefore;
      select.dataset.workScopeSignature = optionSignature;
    }

    const preferredOptions = [...select.options].filter((option) => option.dataset.workPreferred === '1');
    if (!autoSelectedWaiterZone && preferredOptions.length && !preferredZones.has(select.value)) {
      autoSelectedWaiterZone = true;
      select.value = preferredOptions[0].value;
      select.dispatchEvent(new Event('change', { bubbles:true }));
      return;
    }
    autoSelectedWaiterZone = true;

    const zoneAssigned = (work.zoneIds || []).includes(select.value);
    const strip = document.querySelector('.waiter-table-strip');
    if (strip) {
      const buttons = [...strip.querySelectorAll('[data-waiter-table]')];
      const stripSignature = `${select.value}|${zoneAssigned ? '1' : '0'}|${[...assignedTables].sort().join(',')}|${buttons.map((button) => button.dataset.waiterTable).join(',')}`;
      if (strip.dataset.workScopeSignature !== stripSignature) {
        for (const button of buttons) {
          const direct = assignedTables.has(button.dataset.waiterTable);
          const primary = direct || zoneAssigned;
          button.classList.toggle('work-primary', primary);
          let badge = button.querySelector('.work-primary-badge');
          if (primary && !badge) {
            badge = document.createElement('small');
            badge.className = 'work-primary-badge';
            button.appendChild(badge);
          }
          if (primary && badge) {
            const nextText = direct ? '★ Mesa principal' : '★ Zona principal';
            if (badge.textContent !== nextText) badge.textContent = nextText;
          } else if (!primary && badge) badge.remove();
        }
        const primaryButtons = buttons.filter((button) => button.classList.contains('work-primary'));
        const supportButtons = buttons.filter((button) => !button.classList.contains('work-primary'));
        for (const button of [...primaryButtons, ...supportButtons]) strip.appendChild(button);
        strip.dataset.workScopeSignature = stripSignature;
      }
    }

    const titleRow = document.querySelector('.waiter-title-row');
    if (titleRow && !titleRow.parentElement?.querySelector('.work-scope-note')) {
      const parts = [];
      if ((work.zones || []).length) parts.push(`zonas: ${(work.zones || []).map((zone) => zone.name).join(', ')}`);
      if ((work.tables || []).length) parts.push(`mesas: ${(work.tables || []).map((table) => table.name).join(', ')}`);
      const note = document.createElement('div');
      note.className = 'work-scope-note';
      note.innerHTML = parts.length
        ? `<b>Asignación principal:</b> ${esc(parts.join(' · '))}. <b>Refuerzo libre:</b> puedes atender cualquier otra zona o mesa.`
        : '<b>Sin asignación principal:</b> puedes trabajar en todas las zonas y mesas.';
      titleRow.parentElement?.appendChild(note);
    }
  }

  function enhanceProduction() {
    const role = baseRole();
    if (!['COCINA','BARRA','POSTRES'].includes(role)) return;
    const lanes = [...document.querySelectorAll('.kds-v2-lane[data-station]')];
    if (!lanes.length) return;
    const work = assignment();
    const assigned = new Set((work.stations?.length ? work.stations : [role]).map((station) => String(station).toUpperCase()));
    for (const lane of lanes) lane.hidden = !showAllProduction && !assigned.has(String(lane.dataset.station || '').toUpperCase());

    const actions = document.querySelector('.kds-header-actions');
    if (actions) {
      let toggle = actions.querySelector('[data-work-kds-toggle]');
      if (!toggle) {
        toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'ri-btn';
        toggle.dataset.workKdsToggle = '1';
        toggle.addEventListener('click', () => {
          showAllProduction = !showAllProduction;
          enhanceProduction();
        });
        actions.prepend(toggle);
      }
      const nextText = showAllProduction ? 'Ver mis módulos' : 'Ver todas las estaciones';
      if (toggle.textContent !== nextText) toggle.textContent = nextText;
    }

    const header = document.querySelector('.kds-v2-header');
    if (header && !header.querySelector('.work-kds-scope')) {
      const box = document.createElement('div');
      box.className = 'work-kds-scope';
      box.innerHTML = `<span class="work-scope-pill">Módulos principales · ${esc([...assigned].map(stationLabel).join(' + '))}</span><span class="work-scope-pill">Refuerzo habilitado</span>`;
      header.querySelector('div')?.appendChild(box);
    }
  }

  function apply() {
    if (!context) return;
    ensureStyles();
    updateRoleLabel();
    enhanceWaiter();
    enhanceProduction();
  }

  function scheduleApply() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      apply();
    });
  }

  async function init() {
    try {
      context = await api('/api/v1/restaurante/ui-context');
      window.VantixGCRestaurantEmployeeWork = Object.freeze({ marker:MARKER, context:() => context, apply:scheduleApply });
      const observer = new MutationObserver(scheduleApply);
      observer.observe(document.documentElement, { childList:true, subtree:true });
      scheduleApply();
    } catch (_) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
