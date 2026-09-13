(() => {
  'use strict';

  const MARKER = 'VANTIX_RESTAURANT_AUDIT_LOG_C84';
  const RECOVERY_MARKER = 'VANTIX_RESTAURANT_AUDIT_SAFE_RECOVERY_V86';
  const READABLE_MARKER = 'VANTIX_RESTAURANT_AUDIT_READABLE_V87';
  const BUSINESS_MARKER = 'VANTIX_RESTAURANT_BUSINESS_AUDIT_C85';
  const SESSION_KEY = 'vantixgc_core_session_v1';
  const PAGE_PATH = '/app/configuracion-avanzada';
  const ENDPOINT = '/api/v1/restaurante/auditoria/v84';
  if (window[MARKER] || location.pathname !== PAGE_PATH) return;
  window[MARKER] = Object.freeze({ version:'87.0.0', surface:'ADMIN_ADVANCED', recovery:'VIEW_DOWNLOAD_THEN_RESTORE', display:'BUSINESS_FIRST' });
  window[RECOVERY_MARKER] = Object.freeze({ version:'86.0.0', safeRecovery:true, edgeIndependent:true });
  window[READABLE_MARKER] = Object.freeze({ version:'87.0.0', readableBusinessData:true, historicalDecimalCleanup:true });
  window[BUSINESS_MARKER] = Object.freeze({ version:'85.1.0', surface:'ADMIN_ADVANCED', businessChanges:true });

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'
  }[char]));

  const FRIENDLY_LABELS = Object.freeze({
    id:'ID', tipo:'Tipo', nombre:'Nombre', razonSocial:'Razón social', sku:'SKU', codigo:'Código', codigoBarras:'Código de barras',
    descripcion:'Descripción', unidadMedida:'Unidad de medida', controlaInventario:'Controla inventario', costoPromedio:'Costo promedio',
    stockActual:'Stock actual', precio1:'Precio', precio2:'Precio 2', precio3:'Precio 3', ivaPct:'IVA', impoconsumoPct:'Impoconsumo',
    activo:'Activo', active:'Activo', estado:'Estado', numero:'Número', referencia:'Referencia', concepto:'Concepto', observaciones:'Observaciones',
    subtotal:'Subtotal', descuentoTotal:'Descuento total', ivaTotal:'IVA total', impoconsumoTotal:'Impoconsumo total', total:'Total', saldo:'Saldo',
    cantidad:'Cantidad', costoUnitario:'Costo unitario', costoTotal:'Costo total', precioUnitario:'Precio unitario', subtotalLinea:'Subtotal línea',
    ivaValor:'IVA valor', impoconsumoValor:'Impoconsumo valor', totalLinea:'Total línea', formaPago:'Forma de pago', fecha:'Fecha',
    fechaVencimiento:'Fecha de vencimiento', emitidoEn:'Emitido', anuladoEn:'Anulado', motivoAnulacion:'Motivo de anulación', creadoEn:'Creado',
    actualizadoEn:'Actualizado', terceroId:'ID tercero', productoId:'ID producto', cajaBancoId:'ID caja/banco', creadoPorId:'ID creador',
    category:'Categoría', station:'Estación', requiresRecipe:'Requiere receta', sortOrder:'Orden', code:'Código', name:'Nombre', seats:'Puestos',
    state:'Estado', assignedWaiterId:'ID mesero asignado', details:'Detalles', detalles:'Detalles', items:'Ítems', movimientos:'Movimientos',
    product:'Producto', recipe:'Receta', recipeConfigured:'Receta configurada', warning:'Advertencia', cupoCredito:'Cupo de crédito', diasPlazo:'Días de plazo',
    responsableIva:'Responsable de IVA', sujetoRetefuente:'Sujeto a retefuente', sujetoReteIca:'Sujeto a reteICA', sujetoReteIva:'Sujeto a reteIVA',
    identificacion:'Identificación', tipoDocumento:'Tipo de documento', telefono:'Teléfono', email:'Correo', direccion:'Dirección'
  });
  const HIDDEN_BUSINESS_KEYS = new Set(['tenantId', 'tenant', 'marker', 'readableMarker', 'version', 'origin', 'params', 'query', 'path', 'method', 'statusCode', 'recordId']);
  const MONEY_KEY = /(precio|costo|subtotal|total|saldo|monto|valor|cupo|descuento)/i;
  const PERCENT_KEY = /(pct|porcentaje)$/i;
  const DATE_KEY = /(^fecha|En$|At$|creado|actualizado|emitido|anulado|cerrado|abierto)/i;

  function session() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  }

  function isRestaurantTenant() {
    const niche = String(session()?.tenant?.nicho || '').toUpperCase();
    return ['RESTAURANTE','RESTAURANT'].includes(niche)
      || document.documentElement.dataset.coreRestaurantAccess === '1';
  }

  async function api(path, options = {}) {
    const current = session();
    if (!current?.token || !current?.subdomain) throw new Error('Sesión no disponible');
    const response = await fetch(path, {
      cache:'no-store',
      method:options.method || 'GET',
      headers:{
        Authorization:`Bearer ${current.token}`,
        'x-tenant-subdomain':current.subdomain,
        ...(options.body ? { 'Content-Type':'application/json' } : {})
      },
      body:options.body ? JSON.stringify(options.body) : undefined
    });
    let body = {};
    try { body = await response.json(); } catch {}
    if (response.status === 401) {
      localStorage.removeItem(SESSION_KEY);
      location.replace('/app');
      throw new Error('Sesión vencida');
    }
    if (!response.ok) throw new Error(body?.error?.message || body?.message || `HTTP ${response.status}`);
    return body.data;
  }

  function ensureStyles() {
    if (document.getElementById('restaurantAuditLogC84Styles')) return;
    const style = document.createElement('style');
    style.id = 'restaurantAuditLogC84Styles';
    style.textContent = `
      .rca-audit-note{padding:12px 14px;border:1px solid #b7dfc8;border-radius:10px;background:#f0f9f4;color:#365d49;font-size:12px;line-height:1.45;margin-bottom:14px}
      .rca-audit-list{display:grid;gap:10px}.rca-audit-row{border:1px solid #d7dde1;border-radius:11px;background:#fff;padding:12px 14px}
      .rca-audit-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.rca-audit-title{font-weight:850;color:#18221d;font-size:13px}
      .rca-audit-date{font-size:11px;color:#667085;white-space:nowrap}.rca-audit-meta{font-size:11px;color:#667085;line-height:1.5;margin-top:6px}
      .rca-audit-module{display:inline-block;padding:2px 7px;border-radius:999px;background:#eef2f6;color:#344054;font-size:10px;font-weight:800;margin-right:6px}
      .rca-audit-reason{font-size:12px;color:#344054;margin-top:7px;padding:8px 10px;background:#f8fafc;border-radius:8px}
      .rca-audit-actions{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}.rca-audit-btn{border:1px solid #cdd5df;border-radius:8px;background:#fff;color:#344054;font-weight:800;font-size:11px;padding:7px 10px;cursor:pointer}
      .rca-audit-btn:hover{background:#f8fafc}.rca-audit-btn.primary{border-color:#0d6b43;background:#0d6b43;color:#fff}.rca-audit-btn.restore{border-color:#d4a62a;background:#fff9e8;color:#6b5310}.rca-audit-btn[disabled]{opacity:.5;cursor:not-allowed}
      .rca-recovery-state{font-size:11px;color:#667085;margin-top:8px}.rca-recovery-state.ok{color:#0d6b43;font-weight:800}
      .rca-modal-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.56);z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:18px}
      .rca-modal{width:min(820px,100%);max-height:min(90vh,940px);overflow:auto;background:#fff;border-radius:14px;box-shadow:0 24px 70px rgba(15,23,42,.28)}
      .rca-modal-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;padding:16px 18px;border-bottom:1px solid #e5e7eb;position:sticky;top:0;background:#fff;z-index:2}.rca-modal-title{font-weight:900;color:#18221d;font-size:16px}
      .rca-modal-close{border:0;background:#f2f4f7;border-radius:8px;width:34px;height:34px;cursor:pointer;font-size:18px}.rca-modal-body{padding:16px 18px}
      .rca-document-grid{display:grid;grid-template-columns:150px 1fr;gap:8px 14px;font-size:12px;margin-bottom:16px}.rca-document-grid strong{color:#475467}.rca-document-grid span{color:#18221d;word-break:break-word}
      .rca-business-title{font-size:13px;font-weight:900;color:#18221d;margin:4px 0 9px}.rca-business-card{border:1px solid #e4e7ec;border-radius:10px;overflow:hidden;background:#fff;margin-bottom:12px}
      .rca-business-row{display:grid;grid-template-columns:minmax(145px,210px) 1fr;border-bottom:1px solid #eef2f6;font-size:12px}.rca-business-row:last-child{border-bottom:0}.rca-business-label{padding:8px 10px;background:#f8fafc;color:#475467;font-weight:750}.rca-business-value{padding:8px 10px;color:#18221d;word-break:break-word}
      .rca-business-section{margin:12px 0}.rca-business-section-title{font-size:12px;font-weight:850;color:#344054;margin-bottom:6px}.rca-array-card{border:1px solid #e4e7ec;border-radius:9px;padding:9px;margin:7px 0;background:#fcfcfd}.rca-empty{font-size:12px;color:#667085;padding:10px;border:1px dashed #d0d5dd;border-radius:8px}
      .rca-tech{margin-top:14px;border-top:1px solid #eaecf0;padding-top:12px}.rca-tech summary{cursor:pointer;color:#667085;font-size:11px;font-weight:800}.rca-document-pre{white-space:pre-wrap;word-break:break-word;background:#0f172a;color:#e2e8f0;padding:12px;border-radius:10px;max-height:300px;overflow:auto;font-size:11px;margin-top:8px}
      .rca-modal-note{font-size:12px;line-height:1.45;padding:10px 12px;border-radius:9px;background:#fff8e1;color:#6b5310;margin-top:12px}.rca-modal-foot{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;padding:14px 18px;border-top:1px solid #e5e7eb;position:sticky;bottom:0;background:#fff}
      @media(max-width:700px){.rca-audit-top{display:block}.rca-audit-date{margin-top:4px}.rca-document-grid{grid-template-columns:1fr;gap:3px}.rca-business-row{grid-template-columns:1fr}.rca-business-label{padding-bottom:3px}.rca-business-value{padding-top:3px}.rca-modal{max-height:94vh}.rca-modal-foot .rca-audit-btn{flex:1}}
    `;
    document.head.appendChild(style);
  }

  function auditMarkup(data = {}) {
    const items = Array.isArray(data.items) ? data.items : [];
    const rows = items.map((item) => {
      const who = item.user?.name || item.user?.email || 'Usuario';
      const when = item.at ? new Date(item.at).toLocaleString('es-CO') : 'Fecha no disponible';
      const recovery = item.recovery || {};
      const recoveryText = recovery.canRestore
        ? '<div class="rca-recovery-state ok">Recuperable después de revisar el registro.</div>'
        : (String(item.action || '').startsWith('DELETE_') ? `<div class="rca-recovery-state">${esc(recovery.reason || 'Disponible para consulta y descarga.')}</div>` : '');
      return `<div class="rca-audit-row">
        <div class="rca-audit-top">
          <div><div class="rca-audit-title">${item.module ? `<span class="rca-audit-module">${esc(item.module)}</span>` : ''}${esc(item.label || item.action || 'Actividad')}</div><div class="rca-audit-meta">${esc(who)}${item.user?.role ? ` · ${esc(item.user.role)}` : ''} · ${esc(item.subject || item.entity || '')}</div></div>
          <div class="rca-audit-date">${esc(when)}</div>
        </div>
        ${item.reason ? `<div class="rca-audit-reason"><strong>Motivo:</strong> ${esc(item.reason)}</div>` : ''}
        ${recoveryText}
        <div class="rca-audit-actions"><button type="button" class="rca-audit-btn primary" data-audit-view="${esc(item.id)}">VER REGISTRO</button></div>
      </div>`;
    }).join('');

    return `<div class="panel" data-restaurant-audit-log="${MARKER}" data-audit-recovery="${RECOVERY_MARKER}" data-audit-readable="${READABLE_MARKER}" data-business-audit="${BUSINESS_MARKER}">
      <div class="ph"><div><strong>Auditoría / Registro de actividad</strong><div class="muted" style="font-size:12px;margin-top:4px">Los datos de negocio se muestran primero en formato legible. La información técnica queda separada y sólo se abre si se necesita.</div></div><span class="badge ok">AUDITORÍA</span></div>
      <div class="pb">
        <div class="rca-audit-note"><strong>El historial de Auditoría es inmutable.</strong> Los valores monetarios, cantidades, porcentajes y fechas se presentan como datos normales. Ver o descargar no modifica el registro. Restaurar sólo aparece cuando existe un procedimiento seguro.</div>
        <div class="rca-audit-list">${rows || '<div class="muted">Aún no hay registros de auditoría para mostrar.</div>'}</div>
      </div>
    </div>`;
  }

  function snapshotFor(item) {
    if (item && Object.prototype.hasOwnProperty.call(item, 'snapshot')) return item.snapshot;
    const metadata = item?.metadata || {};
    return metadata.before || metadata.result || metadata.changes || null;
  }

  function friendlyLabel(key) {
    if (FRIENDLY_LABELS[key]) return FRIENDLY_LABELS[key];
    return String(key || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (char) => char.toUpperCase());
  }

  function isScalar(value) {
    return value === null || ['string','number','boolean'].includes(typeof value);
  }

  function numericValue(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim())) return Number(value);
    return null;
  }

  function formatBusinessValue(key, value) {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return value ? 'Sí' : 'No';
    const number = numericValue(value);
    if (number !== null && PERCENT_KEY.test(key)) return `${new Intl.NumberFormat('es-CO', { maximumFractionDigits:4 }).format(number)} %`;
    if (number !== null && MONEY_KEY.test(key) && !PERCENT_KEY.test(key)) {
      return new Intl.NumberFormat('es-CO', { style:'currency', currency:'COP', maximumFractionDigits:2 }).format(number);
    }
    if (DATE_KEY.test(key) && typeof value === 'string') {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) return date.toLocaleString('es-CO');
    }
    return String(value);
  }

  function businessObjectMarkup(value, depth = 0) {
    if (isScalar(value)) return `<div class="rca-business-value">${esc(formatBusinessValue('', value))}</div>`;
    if (Array.isArray(value)) {
      if (!value.length) return '<div class="rca-empty">Sin registros.</div>';
      return value.slice(0, 40).map((item, index) => `<div class="rca-array-card"><div class="rca-business-section-title">Ítem ${index + 1}</div>${businessObjectMarkup(item, depth + 1)}</div>`).join('');
    }
    if (!value || typeof value !== 'object') return '<div class="rca-empty">Sin detalle disponible.</div>';

    const entries = Object.entries(value).filter(([key]) => !HIDDEN_BUSINESS_KEYS.has(key));
    const scalarEntries = entries.filter(([, item]) => isScalar(item));
    const nestedEntries = entries.filter(([, item]) => !isScalar(item));
    const rows = scalarEntries.map(([key, item]) => `<div class="rca-business-row"><div class="rca-business-label">${esc(friendlyLabel(key))}</div><div class="rca-business-value">${esc(formatBusinessValue(key, item))}</div></div>`).join('');
    const card = rows ? `<div class="rca-business-card">${rows}</div>` : '';
    if (depth >= 3) return card || '<div class="rca-empty">Detalle anidado disponible en datos técnicos.</div>';
    const nested = nestedEntries.slice(0, 20).map(([key, item]) => `<div class="rca-business-section"><div class="rca-business-section-title">${esc(friendlyLabel(key))}</div>${businessObjectMarkup(item, depth + 1)}</div>`).join('');
    return card + nested || '<div class="rca-empty">No hay detalle comercial adicional.</div>';
  }

  function technicalMarkup(item) {
    const metadata = item?.metadata || {};
    return `<details class="rca-tech"><summary>VER DATOS TÉCNICOS</summary><pre class="rca-document-pre">${esc(JSON.stringify(metadata, null, 2))}</pre></details>`;
  }

  function modalMarkup(item) {
    const who = item.user?.name || item.user?.email || 'Usuario';
    const when = item.at ? new Date(item.at).toLocaleString('es-CO') : 'Fecha no disponible';
    const recovery = item.recovery || {};
    const snapshot = snapshotFor(item);
    const restore = recovery.canRestore ? '<button type="button" class="rca-audit-btn restore" data-audit-restore>RESTAURAR</button>' : '';
    const note = !recovery.canRestore && String(item.action || '').startsWith('DELETE_')
      ? `<div class="rca-modal-note"><strong>Restauración protegida:</strong> ${esc(recovery.reason || 'Este registro no puede restaurarse automáticamente.')}</div>`
      : '';
    return `<div class="rca-modal-backdrop" data-audit-modal>
      <div class="rca-modal" role="dialog" aria-modal="true" aria-label="Detalle de auditoría">
        <div class="rca-modal-head"><div><div class="rca-modal-title">${esc(item.label || item.action || 'Registro')}</div><div class="rca-audit-meta">${esc(when)}</div></div><button type="button" class="rca-modal-close" data-audit-close aria-label="Cerrar">×</button></div>
        <div class="rca-modal-body">
          <div class="rca-document-grid">
            <strong>Acción</strong><span>${esc(item.action || '')}</span><strong>Módulo</strong><span>${esc(item.module || 'General')}</span><strong>Tipo</strong><span>${esc(item.subject || item.entity || 'Registro')}</span><strong>ID</strong><span>${esc(item.entityId || '')}</span><strong>Usuario</strong><span>${esc(who)}${item.user?.role ? ` · ${esc(item.user.role)}` : ''}</span><strong>Motivo</strong><span>${esc(item.reason || 'No registrado')}</span>
          </div>
          <div class="rca-business-title">Datos del registro</div>
          ${businessObjectMarkup(snapshot)}
          ${technicalMarkup(item)}
          ${note}
        </div>
        <div class="rca-modal-foot"><button type="button" class="rca-audit-btn" data-audit-download>DESCARGAR COPIA</button>${restore}<button type="button" class="rca-audit-btn" data-audit-close>CERRAR</button></div>
      </div>
    </div>`;
  }

  let currentDetail = null;

  function closeModal() {
    document.querySelector('[data-audit-modal]')?.remove();
    currentDetail = null;
  }

  async function showDetail(id) {
    try {
      currentDetail = await api(`${ENDPOINT}/${encodeURIComponent(id)}`);
      document.querySelector('[data-audit-modal]')?.remove();
      document.body.insertAdjacentHTML('beforeend', modalMarkup(currentDetail));
    } catch (error) { alert(error.message); }
  }

  function downloadDetail(item) {
    if (!item) return;
    const snapshot = snapshotFor(item);
    const when = item.at ? new Date(item.at).toLocaleString('es-CO') : 'Fecha no disponible';
    const title = item.label || item.action || 'Registro de auditoría';
    const business = businessObjectMarkup(snapshot);
    const technical = esc(JSON.stringify(item.metadata || {}, null, 2));
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:Arial,sans-serif;margin:32px;color:#18221d;max-width:920px}h1{font-size:22px}h2{font-size:16px;margin-top:24px}.meta{border-collapse:collapse;width:100%;margin:18px 0}.meta td{border:1px solid #d7dde1;padding:8px;vertical-align:top}.meta td:first-child{font-weight:bold;width:180px;background:#f8fafc}.rca-business-card{border:1px solid #e4e7ec;border-radius:8px;overflow:hidden}.rca-business-row{display:grid;grid-template-columns:200px 1fr;border-bottom:1px solid #eef2f6}.rca-business-label{padding:8px;background:#f8fafc;font-weight:bold}.rca-business-value{padding:8px}.rca-business-section{margin:14px 0}.rca-business-section-title{font-weight:bold;margin-bottom:6px}.rca-array-card{border:1px solid #e4e7ec;border-radius:8px;padding:9px;margin:8px 0}.rca-empty{color:#667085}.tech{margin-top:24px}pre{white-space:pre-wrap;word-break:break-word;background:#f8fafc;border:1px solid #d7dde1;padding:14px;border-radius:8px}.note{font-size:12px;color:#667085;margin-top:22px}@media print{.note{display:none}}</style></head><body><h1>${esc(title)}</h1><table class="meta"><tr><td>Fecha</td><td>${esc(when)}</td></tr><tr><td>Acción</td><td>${esc(item.action || '')}</td></tr><tr><td>Módulo</td><td>${esc(item.module || '')}</td></tr><tr><td>Tipo</td><td>${esc(item.subject || item.entity || '')}</td></tr><tr><td>ID</td><td>${esc(item.entityId || '')}</td></tr><tr><td>Usuario</td><td>${esc(item.user?.name || item.user?.email || 'Usuario')}</td></tr><tr><td>Motivo</td><td>${esc(item.reason || 'No registrado')}</td></tr></table><h2>Datos del registro</h2>${business}<details class="tech"><summary>Datos técnicos</summary><pre>${technical}</pre></details><div class="note">Copia generada desde Auditoría Vantix. El registro original permanece inmutable. Puede imprimir esta copia o guardarla como PDF desde el navegador.</div></body></html>`;
    const blob = new Blob([html], { type:'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `auditoria-${String(item.subject || item.action || 'registro').toLowerCase().replace(/[^a-z0-9]+/gi, '-')}-${String(item.id || '').slice(0, 8)}.html`;
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function restoreDetail(item) {
    if (!item?.recovery?.canRestore) return;
    const reason = prompt('Motivo de la restauración:');
    if (reason === null) return;
    if (String(reason).trim().length < 3) { alert('Indique un motivo de restauración.'); return; }
    if (!confirm(`¿Restaurar ${item.label || item.subject || 'este registro'}? La Auditoría original se conservará.`)) return;
    try {
      await api(`${ENDPOINT}/${encodeURIComponent(item.id)}/restaurar`, { method:'POST', body:{ reason:String(reason).trim() } });
      alert('Registro restaurado. La restauración quedó registrada en Auditoría.');
      closeModal(); await loadAudit();
    } catch (error) { alert(error.message); }
  }

  async function loadAudit() {
    const view = document.getElementById('view');
    if (!view) return;
    view.innerHTML = '<div class="panel"><div class="pb">Cargando auditoría…</div></div>';
    try { const data = await api(`${ENDPOINT}?limit=200`); view.innerHTML = auditMarkup(data || {}); }
    catch (error) { view.innerHTML = `<div class="error">${esc(error.message)}</div>`; }
  }

  function activateAuditTab(button) {
    document.querySelectorAll('.tabs .tab').forEach((tab) => tab.classList.remove('active'));
    button.classList.add('active'); loadAudit();
  }

  function installEvents() {
    if (document.documentElement.dataset.restaurantAuditRecoveryEvents === '1') return;
    document.documentElement.dataset.restaurantAuditRecoveryEvents = '1';
    document.addEventListener('click', (event) => {
      const viewButton = event.target.closest('[data-audit-view]');
      if (viewButton) { showDetail(viewButton.dataset.auditView); return; }
      if (event.target.closest('[data-audit-download]')) { downloadDetail(currentDetail); return; }
      if (event.target.closest('[data-audit-restore]')) { restoreDetail(currentDetail); return; }
      if (event.target.closest('[data-audit-close]') || event.target.matches('[data-audit-modal]')) closeModal();
    });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeModal(); });
  }

  function install(attempt = 0) {
    if (!isRestaurantTenant()) { if (attempt < 30) setTimeout(() => install(attempt + 1), 100); return; }
    ensureStyles(); installEvents();
    const tabs = document.querySelector('.tabs');
    if (!tabs) { if (attempt < 40) setTimeout(() => install(attempt + 1), 100); return; }
    if (tabs.querySelector('[data-restaurant-audit-tab]')) return;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'tab'; button.dataset.restaurantAuditTab = 'c84-v87'; button.textContent = 'Auditoría';
    button.addEventListener('click', () => activateAuditTab(button));
    const cleanup = tabs.querySelector('[data-restaurant-test-reset-tab]');
    if (cleanup) cleanup.insertAdjacentElement('afterend', button); else tabs.appendChild(button);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => install(), { once:true });
  else install();
})();
