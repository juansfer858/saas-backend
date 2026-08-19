/* VantixGC Accounting V2.1 extras.
 * Se carga después del controlador principal de accounting.html y reutiliza
 * la misma sesión/estado, sin duplicar autenticación ni navegación.
 */
(() => {
  const originalRenderPeriods = renderPeriods;
  renderPeriods = function renderPeriodsWithVoucherTypes() {
    originalRenderPeriods();
    const view = document.querySelector('#view');
    if (!view) return;
    const rows = st.types.map((t) => `<tr><td><strong>${esc(t.codigo)}</strong></td><td>${esc(t.nombre)}</td><td>${t.consecutivoPorPeriodo ? 'Por periodo' : 'Anual'}</td><td>${t.sistema ? '<span class="badge b-info">Sistema</span>' : '<span class="badge b-gray">Personalizado</span>'}</td><td><span class="badge ${t.activo ? 'b-ok' : 'b-gray'}">${t.activo ? 'Activo' : 'Inactivo'}</span></td><td><button class="btn small" data-voucher="${t.id}">Editar</button></td></tr>`);
    view.insertAdjacentHTML('beforeend', `<div class="panel" id="voucherTypesPanel"><div class="panel-head"><h2>Tipos de Comprobante y Consecutivos</h2><button class="btn primary" id="newVoucherType">+ Tipo de comprobante</button></div><div class="notice">El consecutivo se asigna al contabilizar. Los borradores no consumen número y el usuario no puede editar el consecutivo.</div>${table(['Código','Nombre','Consecutivo','Origen','Estado',''], rows)}</div>`);
    document.querySelector('#newVoucherType').onclick = () => openVoucherType();
    document.querySelectorAll('[data-voucher]').forEach((b) => b.onclick = () => openVoucherType(st.types.find((x) => x.id === b.dataset.voucher)));
  };

  function openVoucherType(item = null) {
    modal(`<h2>${item ? 'Editar' : 'Crear'} tipo de comprobante</h2><form id="voucherForm"><div class="form-grid"><div class="field"><label>Código</label><input class="input" name="codigo" maxlength="12" value="${esc(item?.codigo || '')}" ${item?.sistema ? 'readonly' : ''} required></div><div class="field" style="grid-column:span 2"><label>Nombre</label><input class="input" name="nombre" value="${esc(item?.nombre || '')}" required></div><div class="field"><label><input type="checkbox" name="consecutivoPorPeriodo" ${item?.consecutivoPorPeriodo !== false ? 'checked' : ''}> Consecutivo por periodo mensual</label><label><input type="checkbox" name="activo" ${item?.activo !== false ? 'checked' : ''}> Activo</label></div></div><div class="smallnote">Ejemplo: CA-202608-000001. El número nunca se captura manualmente.</div><div class="modal-actions"><button type="button" class="btn" id="cancelVoucher">Cancelar</button><button class="btn primary">Guardar</button></div></form>`);
    document.querySelector('#cancelVoucher').onclick = closeModal;
    document.querySelector('#voucherForm').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const payload = {
        codigo: f.get('codigo'),
        nombre: f.get('nombre'),
        consecutivoPorPeriodo: f.get('consecutivoPorPeriodo') === 'on',
        activo: f.get('activo') === 'on'
      };
      try {
        await api(item ? `/api/v1/contabilidad/tipos-comprobante/${item.id}` : '/api/v1/contabilidad/tipos-comprobante', {
          method: item ? 'PATCH' : 'POST',
          body: JSON.stringify(payload)
        });
        closeModal();
        await loadBase();
        flash('Tipo de comprobante actualizado');
        renderPeriods();
      } catch (error) { alert(error.message); }
    };
  }

  const originalRenderManual = renderManual;
  renderManual = function renderManualWithFiscalAssistant() {
    originalRenderManual();
    const head = document.querySelector('#view .panel-head');
    if (!head || document.querySelector('#fiscalAssistant')) return;
    const button = document.createElement('button');
    button.id = 'fiscalAssistant';
    button.className = 'btn';
    button.type = 'button';
    button.textContent = 'Asistente fiscal (IVA / retenciones)';
    button.onclick = openFiscalAssistant;
    head.appendChild(button);
  };

  function openFiscalAssistant() {
    const activeRet = st.retentions.filter((r) => r.activo);
    modal(`<h2>Asistente fiscal de asiento</h2><div class="notice">El backend calcula IVA y retenciones configuradas, construye la contrapartida neta y vuelve a validar Débitos = Créditos antes de contabilizar.</div><form id="fiscalForm"><div class="form-grid"><div class="field"><label>Operación</label><select class="select" name="tipoOperacion"><option>COMPRA</option><option>VENTA</option></select></div><div class="field"><label>Fecha</label><input class="input" type="date" name="fecha" value="${new Date().toISOString().slice(0, 10)}"></div><div class="field"><label>Tipo comprobante</label><select class="select" name="tipoComprobanteId">${typeOptions()}</select></div><div class="field"><label>Tercero</label><select class="select" name="terceroId">${thirdOptions()}</select></div><div class="field" style="grid-column:span 2"><label>Cuenta base (gasto/activo/ingreso)</label><select class="select" name="cuentaBaseId">${accountOptions()}</select></div><div class="field" style="grid-column:span 2"><label>Contrapartida neta (Caja/Banco/CxC/CxP)</label><select class="select" name="cuentaContrapartidaId">${accountOptions()}</select></div><div class="field"><label>Base antes de IVA</label><input class="input" type="number" min="0.01" step="0.01" name="base" required></div><div class="field"><label>Tarifa IVA</label><select class="select" name="tarifaIvaId"><option value="">Sin IVA</option>${st.vats.filter((v) => v.activa).map((v) => `<option value="${v.id}">${esc(v.nombre)} (${v.porcentaje}%)</option>`).join('')}</select></div><div class="field" style="grid-column:span 2"><label>Concepto general</label><input class="input" name="concepto" value="Asiento fiscal manual" required></div><div class="field" style="grid-column:span 4"><label>Retenciones explícitas (opcional). Si no selecciona ninguna, se aplican las automáticas que correspondan al tercero.</label><select class="select" name="retenciones" multiple size="${Math.min(Math.max(activeRet.length, 3), 7)}">${activeRet.map((r) => `<option value="${r.id}">${esc(r.codigo)} · ${esc(r.nombre)} · ${r.porcentaje}% · ${esc(r.naturaleza)}</option>`).join('')}</select></div></div><div class="modal-actions"><button type="button" class="btn" id="cancelFiscal">Cancelar</button><button class="btn primary">Calcular y contabilizar</button></div></form>`);
    document.querySelector('#cancelFiscal').onclick = closeModal;
    document.querySelector('#fiscalForm').onsubmit = async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const f = new FormData(form);
      const selected = [...form.querySelector('[name="retenciones"]').selectedOptions].map((o) => o.value);
      const payload = {
        tipoOperacion: f.get('tipoOperacion'),
        fecha: f.get('fecha'),
        concepto: f.get('concepto'),
        tipoComprobanteId: f.get('tipoComprobanteId') || null,
        terceroId: f.get('terceroId') || null,
        cuentaBaseId: f.get('cuentaBaseId'),
        cuentaContrapartidaId: f.get('cuentaContrapartidaId'),
        base: Number(f.get('base')),
        tarifaIvaId: f.get('tarifaIvaId') || null
      };
      if (selected.length) payload.conceptosRetencionIds = selected;
      try {
        const result = await api('/api/v1/contabilidad/asientos/fiscal', { method: 'POST', body: JSON.stringify(payload) });
        closeModal();
        flash(`Asiento fiscal contabilizado: ${result.data.numeroComprobante || ''}`);
        setTab('diario');
      } catch (error) { alert(error.message); }
    };
  }
})();
