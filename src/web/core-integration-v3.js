(() => {
  'use strict';

  const originalRender = render;
  let purchaseProducts = [], purchaseSuppliers = [], purchaseCash = [], purchaseLineSeq = 0;

  function table(headers, rows) {
    return `<div class="table-wrap"><table class="table"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  }
  function modalV3(body, id = 'v3Modal') {
    document.getElementById(id)?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-back" id="${id}"><div class="modal" style="width:min(920px,96vw);max-height:92vh;overflow:auto">${body}</div></div>`);
  }
  function closeV3(id = 'v3Modal') { document.getElementById(id)?.remove(); }
  async function filePayload(file) {
    if (!file) return null;
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    return { nombre: file.name, mimeType: file.type, base64 };
  }
  function accountOptions(accounts, selected = '', predicate = () => true) {
    return accounts.filter(predicate).map((a) => `<option value="${a.id}" ${a.id === selected ? 'selected' : ''}>${esc(a.codigo)} · ${esc(a.nombre)} · ${esc(a.naturaleza)}</option>`).join('');
  }

  async function viewConfigV3() {
    let p;
    try { p = (await api('/api/v1/integracion/parametrizacion-contable')).data; }
    catch (e) { return errorView(e); }
    state.cache.integrationParam = p;
    const groups = [...new Set(p.parametros.map((x) => x.grupo))];
    const mappingPanels = groups.map((g) => {
      const rows = p.parametros.filter((x) => x.grupo === g).map((x) => `<tr><td><strong>${esc(x.label)}</strong><div class="muted" style="font-size:11px">${esc(x.clave)}</div></td><td><select class="select v3-map" data-key="${x.clave}" style="min-width:360px"><option value="">Sin configurar</option>${accountOptions(p.cuentas, x.cuentaId || '')}</select></td><td>${x.configurado ? '<span class="badge b-paid">Configurado</span>' : '<span class="badge b-cancel">Falta</span>'}</td></tr>`);
      return `<div class="panel"><div class="panel-head"><h2>${esc(g)}</h2></div>${table(['Parámetro','Cuenta PUC','Estado'], rows)}</div>`;
    }).join('');
    const cashRows = p.cajasBancos.map((c) => `<tr><td>${esc(c.nombre)}</td><td>${esc(c.tipo)}</td><td><select class="select v3-cash-account" data-cash="${c.id}"><option value="">Usar cuenta general</option>${accountOptions(p.cuentas, c.cuentaContableId || '')}</select></td></tr>`);
    return `<div class="pagehead"><div><h1>Configuración</h1><p>Parametrización contable única para todos los módulos. Ningún módulo codifica cuentas PUC.</p></div><button class="btn primary" onclick="saveIntegrationConfigV3()">Guardar parametrización</button></div>
      <div class="notice">Las operaciones se bloquean si falta una cuenta requerida. Los asientos automáticos usan AU y pasan por el mismo motor de partida doble de Contabilidad.</div>
      <div class="panel"><div class="panel-head"><h2>Reglas operativas</h2></div><div class="grid3" style="padding:18px"><div class="field"><label>Método de costeo</label><select id="v3CostMethod" class="select"><option value="PROMEDIO_PONDERADO" ${p.config.metodoCosteo === 'PROMEDIO_PONDERADO' ? 'selected' : ''}>Promedio ponderado</option><option value="PEPS" ${p.config.metodoCosteo === 'PEPS' ? 'selected' : ''}>PEPS / FIFO</option></select></div><div class="field"><label><input type="checkbox" id="v3ThirdSales" ${p.config.exigirTerceroVentas ? 'checked' : ''}> Exigir cliente en ventas</label></div><div class="field"><label><input type="checkbox" id="v3ThirdPurchases" ${p.config.exigirTerceroCompras ? 'checked' : ''}> Exigir proveedor en compras</label></div></div></div>
      ${mappingPanels}
      <div class="panel"><div class="panel-head"><h2>Cuentas contables por Caja / Banco</h2></div>${cashRows.length ? table(['Cuenta financiera','Tipo','Cuenta PUC específica'], cashRows) : '<div class="empty">No hay cajas o bancos activos.</div>'}</div>`;
  }

  window.saveIntegrationConfigV3 = async function saveIntegrationConfigV3() {
    const mappings = {};
    document.querySelectorAll('.v3-map').forEach((s) => { if (s.value) mappings[s.dataset.key] = s.value; });
    const cajasBancos = [...document.querySelectorAll('.v3-cash-account')].filter((s) => s.value).map((s) => ({ cajaBancoId: s.dataset.cash, cuentaContableId: s.value }));
    try {
      await api('/api/v1/integracion/parametrizacion-contable', { method: 'PATCH', body: JSON.stringify({ mappings, cajasBancos, config: { metodoCosteo: $('#v3CostMethod').value, exigirTerceroVentas: $('#v3ThirdSales').checked, exigirTerceroCompras: $('#v3ThirdPurchases').checked } }) });
      alert('Parametrización contable guardada.');
      render();
    } catch (e) { alert(e.message); }
  };

  async function viewPurchasesV3() {
    let r;
    try { r = await api('/api/v1/comercial/compras?page=1&pageSize=200'); }
    catch (e) { return errorView(e); }
    const items = r.data || [];
    const rows = items.map((x) => `<tr><td><strong>${esc(x.numero)}</strong></td><td>${date(x.fecha)}</td><td>${esc(x.tercero?.nombre || x.tercero?.razonSocial || '—')}</td><td>${stateBadge(x.estado)}</td><td class="money">${money(x.total)}</td><td class="money">${money(x.saldo)}</td><td><button class="btn small" onclick="nav('/app/compras/${x.id}')">Ver</button></td></tr>`);
    return `<div class="pagehead"><div><h1>Compras</h1><p>Compras, proveedores, IVA, retenciones, Kardex, CxP y asiento AU en una sola transacción.</p></div><button class="btn primary" onclick="nav('/app/compras/nueva')">+ Nueva compra</button></div><div class="panel"><div class="panel-head"><h2>Facturas de proveedor</h2><span class="muted">${items.length} registros</span></div>${rows.length ? table(['N°','Fecha','Proveedor','Estado','Total','Saldo',''], rows) : '<div class="empty">No hay compras.</div>'}</div>`;
  }

  async function viewNewPurchaseV3() {
    try {
      const [thirds, products, cash] = await Promise.all([api('/api/v1/terceros?activo=true&limit=500'), api('/api/v1/inventario/productos?activo=true&limit=500'), api('/api/v1/tesoreria/cajas-bancos')]);
      purchaseSuppliers = (thirds.data || []).filter((x) => ['PROVEEDOR','CLIENTE_PROVEEDOR'].includes(x.tipo));
      purchaseProducts = products.data || [];
      purchaseCash = cash.data || [];
    } catch (e) { return errorView(e); }
    return `<div class="pagehead"><div><h1>Nueva compra</h1><p>Al emitir: Inventario/Gasto + IVA / Proveedores o Caja-Banco, retenciones y Kardex.</p></div><button class="btn" onclick="nav('/app/compras')">← Volver</button></div>
      <div class="panel"><div class="panel-head"><h2>Datos de la compra</h2></div><div class="grid3" style="padding:18px"><div class="field"><label>Proveedor</label><select id="pSupplier" class="select"><option value="">Seleccione proveedor</option>${purchaseSuppliers.map((x) => `<option value="${x.id}">${esc(x.identificacion)} · ${esc(x.nombre)}</option>`).join('')}</select></div><div class="field"><label>Forma de pago</label><select id="pForma" class="select" onchange="togglePurchaseCashV3()"><option value="CREDITO">Crédito</option><option value="EFECTIVO">Efectivo</option><option value="BANCO">Banco</option></select></div><div class="field hidden" id="pCashWrap"><label>Caja / Banco</label><select id="pCash" class="select"><option value="">Seleccione</option>${purchaseCash.map((x) => `<option value="${x.id}">${esc(x.nombre)} · ${esc(x.tipo)}</option>`).join('')}</select></div><div class="field"><label>Fecha</label><input id="pDate" type="date" class="input" value="${new Date().toISOString().slice(0,10)}"></div><div class="field"><label>Vencimiento</label><input id="pDue" type="date" class="input"></div><div class="field"><label>Observaciones</label><input id="pObs" class="input"></div></div></div>
      <div class="panel"><div class="panel-head"><h2>Detalle</h2><button class="btn small" onclick="addPurchaseLineV3()">+ Línea</button></div><div id="purchaseLines" style="padding:10px 18px"></div><div class="totals"><div class="total-row"><span>Subtotal</span><strong id="pSub">$0</strong></div><div class="total-row"><span>IVA</span><strong id="pVat">$0</strong></div><div class="total-row final"><span>Total</span><span id="pTotal">$0</span></div></div></div><div id="pError"></div><div class="actions" style="justify-content:flex-end"><button class="btn" onclick="submitPurchaseV3('BORRADOR')">Guardar borrador</button><button class="btn primary" onclick="submitPurchaseV3('EMITIDO')">Emitir compra</button></div>`;
  }

  window.togglePurchaseCashV3 = function () { $('#pCashWrap')?.classList.toggle('hidden', $('#pForma').value === 'CREDITO'); };
  window.addPurchaseLineV3 = function addPurchaseLineV3() {
    const row = document.createElement('div');
    row.className = 'line-editor purchase-line'; row.dataset.id = ++purchaseLineSeq;
    row.innerHTML = `<div><label>Producto / Gasto</label><select class="select pp" onchange="purchaseProductChangedV3(this)"><option value="">Gasto/servicio sin producto</option>${purchaseProducts.map((p) => `<option value="${p.id}">${esc(p.sku)} · ${esc(p.nombre)}</option>`).join('')}</select><input class="input pdesc" style="margin-top:5px" placeholder="Descripción"></div><div><label>Cantidad</label><input class="input pq" type="number" min="0.0001" step="0.0001" value="1" oninput="calcPurchaseV3()"></div><div><label>Costo unitario</label><input class="input pcost" type="number" min="0" step="0.01" value="0" oninput="calcPurchaseV3()"></div><div><label>IVA %</label><input class="input piva" type="number" min="0" max="100" step="0.01" value="0" oninput="calcPurchaseV3()"></div><div><label>Total</label><input class="input ptotal" readonly></div><button class="btn small danger" onclick="this.closest('.purchase-line').remove();calcPurchaseV3()">×</button>`;
    $('#purchaseLines').appendChild(row); calcPurchaseV3();
  };
  window.purchaseProductChangedV3 = function (sel) {
    const p = purchaseProducts.find((x) => x.id === sel.value), row = sel.closest('.purchase-line');
    if (p) { row.querySelector('.pdesc').value = p.nombre; row.querySelector('.pcost').value = Number(p.costoPromedio || 0); row.querySelector('.piva').value = Number(p.ivaPct || 0); }
    calcPurchaseV3();
  };
  window.calcPurchaseV3 = function () {
    let sub = 0, vat = 0;
    document.querySelectorAll('.purchase-line').forEach((r) => { const q = Number(r.querySelector('.pq').value || 0), c = Number(r.querySelector('.pcost').value || 0), v = Number(r.querySelector('.piva').value || 0), b = q*c, iv = b*v/100; sub += b; vat += iv; r.querySelector('.ptotal').value = money(b+iv); });
    if ($('#pSub')) { $('#pSub').textContent = money(sub); $('#pVat').textContent = money(vat); $('#pTotal').textContent = money(sub+vat); }
  };
  window.submitPurchaseV3 = async function (estado) {
    const details = [...document.querySelectorAll('.purchase-line')].map((r) => ({ productoId: r.querySelector('.pp').value || undefined, descripcion: r.querySelector('.pdesc').value || undefined, cantidad: Number(r.querySelector('.pq').value), precioUnitario: Number(r.querySelector('.pcost').value), ivaPct: Number(r.querySelector('.piva').value) }));
    const forma = $('#pForma').value, payload = { estado, terceroId: $('#pSupplier').value || undefined, formaPago: forma, cajaBancoId: forma === 'CREDITO' ? undefined : ($('#pCash').value || undefined), fecha: $('#pDate').value, fechaVencimiento: $('#pDue').value || undefined, observaciones: $('#pObs').value || undefined, detalles: details };
    if (!payload.terceroId) return $('#pError').innerHTML = '<div class="error">Seleccione un proveedor.</div>';
    if (!details.length) return $('#pError').innerHTML = '<div class="error">Agregue al menos una línea.</div>';
    try { const r = await api('/api/v1/comercial/compras', { method: 'POST', body: JSON.stringify(payload) }); nav('/app/compras/' + r.data.id); }
    catch (e) { $('#pError').innerHTML = `<div class="error">${esc(e.message)}</div>`; }
  };

  async function viewPurchaseDetailV3(id) {
    let r, cash;
    try { [r, cash] = await Promise.all([api('/api/v1/comercial/compras/' + id), api('/api/v1/tesoreria/cajas-bancos')]); }
    catch (e) { return errorView(e); }
    const d = r.data; state.cache.cash = cash.data || [];
    const journal = d.asiento;
    return `<div class="pagehead"><div><h1>Compra ${esc(d.numero)}</h1><p>${stateBadge(d.estado)} · ${date(d.fecha)} · ${esc(d.tercero?.nombre || '')}</p></div><div class="actions">${['EMITIDO','PAGADO_PARCIAL','CONFIRMADO'].includes(d.estado) && Number(d.saldo) > 0 ? `<button class="btn primary" onclick="openPayment('${d.id}',${Number(d.saldo)})">Pagar / abonar</button>` : ''}${!['ANULADO','BORRADOR'].includes(d.estado) ? `<button class="btn danger" onclick="cancelPurchaseV3('${d.id}')">Anular</button>` : ''}<button class="btn" onclick="nav('/app/compras')">Volver</button></div></div>
      <div class="cards"><div class="card metric"><div class="label">Total</div><div class="value">${money(d.total)}</div></div><div class="card metric"><div class="label">Saldo CxP</div><div class="value">${money(d.saldo)}</div></div><div class="card metric"><div class="label">Kardex</div><div class="value">${(d.movimientosInventario||[]).length}</div></div><div class="card metric"><div class="label">Asiento</div><div class="value" style="font-size:16px">${esc(journal?.numeroComprobante || '—')}</div></div></div>
      <div class="panel"><div class="panel-head"><h2>Detalle de compra</h2></div>${table(['Descripción','Cantidad','Costo','IVA','Total'], (d.detalles||[]).map((x) => `<tr><td>${esc(x.descripcion)}</td><td>${Number(x.cantidad)}</td><td class="money">${money(x.precioUnitario)}</td><td class="money">${money(x.ivaValor)}</td><td class="money">${money(x.totalLinea)}</td></tr>`))}</div>
      <div class="panel"><div class="panel-head"><h2>Asiento automático AU</h2></div>${journal ? `<div class="notice" style="margin:16px">${esc(journal.numeroComprobante || '')} · Débitos ${money(journal.totalDebito)} · Créditos ${money(journal.totalCredito)}</div>${table(['Cuenta','Concepto','Débito','Crédito'], (journal.detalles||[]).map((x) => `<tr><td>${esc(x.cuenta?.codigo || x.cuentaId)} · ${esc(x.cuenta?.nombre || '')}</td><td>${esc(x.concepto || '')}</td><td class="money">${money(x.debito)}</td><td class="money">${money(x.credito)}</td></tr>`))}` : '<div class="empty">Sin asiento todavía.</div>'}</div>`;
  }
  window.cancelPurchaseV3 = async function (id) { const motivo = prompt('Motivo de anulación:'); if (!motivo) return; try { await api(`/api/v1/comercial/compras/${id}/anular`, { method: 'POST', body: JSON.stringify({ motivo }) }); render(); } catch (e) { alert(e.message); } };

  async function viewInventoryV3() {
    let products, movements, param;
    try { [products, movements, param] = await Promise.all([api('/api/v1/inventario/productos?limit=500'), api('/api/v1/inventario/movimientos?limit=200'), api('/api/v1/integracion/parametrizacion-contable')]); }
    catch (e) { return errorView(e); }
    state.cache.inventoryProducts = products.data || [];
    const rows = state.cache.inventoryProducts.map((p) => `<tr><td>${esc(p.sku)}</td><td>${esc(p.nombre)}</td><td>${esc(p.tipo)}</td><td class="money">${Number(p.stockActual)}</td><td class="money">${money(p.costoPromedio)}</td><td class="money">${money(p.precio1)}</td></tr>`);
    const mov = (movements.data || []).map((m) => `<tr><td>${date(m.creadoEn)}</td><td>${esc(m.tipo)}</td><td>${esc(m.producto?.nombre || '')}</td><td class="money">${Number(m.cantidad)}</td><td class="money">${money(m.costoUnitario)}</td><td>${esc(m.referencia || '')}</td></tr>`);
    return `<div class="pagehead"><div><h1>Inventarios / Kardex</h1><p>Costeo ${esc(param.data.config.metodoCosteo)}. Compras/Ventas generan Kardex; ajustes manuales generan AU.</p></div><button class="btn primary" onclick="openInventoryAdjustmentV3()">+ Ajuste de inventario</button></div><div class="panel"><div class="panel-head"><h2>Existencias</h2></div>${table(['SKU','Producto','Tipo','Stock','Costo actual','Precio'], rows)}</div><div class="panel"><div class="panel-head"><h2>Kardex reciente</h2></div>${mov.length ? table(['Fecha','Movimiento','Producto','Cantidad','Costo','Referencia'], mov) : '<div class="empty">Sin movimientos.</div>'}</div>`;
  }
  window.openInventoryAdjustmentV3 = function () {
    const products = (state.cache.inventoryProducts || []).filter((p) => p.tipo === 'PRODUCTO' && p.controlaInventario);
    modalV3(`<h2>Ajuste de inventario</h2><div class="grid2"><div class="field"><label>Producto</label><select id="iaProduct" class="select">${products.map((p) => `<option value="${p.id}">${esc(p.sku)} · ${esc(p.nombre)} · Stock ${Number(p.stockActual)}</option>`).join('')}</select></div><div class="field"><label>Tipo</label><select id="iaType" class="select"><option>FALTANTE</option><option>MERMA</option><option>SOBRANTE</option></select></div><div class="field"><label>Cantidad</label><input id="iaQty" class="input" type="number" min="0.0001" step="0.0001"></div><div class="field"><label>Costo unitario (solo sobrante)</label><input id="iaCost" class="input" type="number" min="0" step="0.01"></div></div><div class="field"><label>Justificación obligatoria</label><textarea id="iaReason" class="input" rows="3"></textarea></div><div class="field"><label>Soporte PDF/imagen (obligatorio en faltante/merma)</label><input id="iaSupport" type="file" accept="application/pdf,image/png,image/jpeg,image/webp"></div><div id="iaError"></div><div class="actions" style="justify-content:flex-end"><button class="btn" onclick="closeV3Global()">Cancelar</button><button class="btn primary" onclick="submitInventoryAdjustmentV3()">Contabilizar ajuste</button></div>`);
  };
  window.closeV3Global = () => closeV3();
  window.submitInventoryAdjustmentV3 = async function () {
    try {
      const support = await filePayload($('#iaSupport').files[0]);
      await api('/api/v1/integracion/inventario/ajustes', { method: 'POST', body: JSON.stringify({ productoId: $('#iaProduct').value, tipo: $('#iaType').value, cantidad: Number($('#iaQty').value), costoUnitario: $('#iaCost').value ? Number($('#iaCost').value) : undefined, justificacion: $('#iaReason').value, soporte: support || undefined }) });
      closeV3(); render();
    } catch (e) { $('#iaError').innerHTML = `<div class="error">${esc(e.message)}</div>`; }
  };

  async function viewTreasuryV3() {
    let cash, payments, accounts;
    try { [cash, payments, accounts] = await Promise.all([api('/api/v1/tesoreria/cajas-bancos'), api('/api/v1/tesoreria/pagos?limit=100'), api('/api/v1/contabilidad/cuentas?limit=3000')]); }
    catch (e) { return errorView(e); }
    state.cache.treasuryCash = cash.data || []; state.cache.treasuryAccounts = accounts.data || [];
    const rows = state.cache.treasuryCash.map((c) => `<tr><td>${esc(c.nombre)}</td><td>${esc(c.tipo)}</td><td>${esc(c.banco || '')}</td><td>${esc(c.cuentaContable?.codigo || 'General')}</td><td class="money">${money(c.saldoActual)}</td></tr>`);
    const payRows = (payments.data || []).slice(0,30).map((p) => `<tr><td>${date(p.creadoEn)}</td><td>${esc(p.documento?.numero || '')}</td><td>${esc(p.metodoPago)}</td><td>${esc(p.cajaBanco?.nombre || '')}</td><td class="money">${money(p.monto)}</td></tr>`);
    return `<div class="pagehead"><div><h1>Tesorería & Bancos</h1><p>Recaudos, pagos, transferencias propias y gastos directos con asiento AU.</p></div><div class="actions"><button class="btn" onclick="openTransferV3()">Transferir</button><button class="btn" onclick="openDirectExpenseV3()">Gasto directo</button><button class="btn primary" onclick="openMultiplePaymentV3()">Aplicar cartera</button></div></div><div class="panel"><div class="panel-head"><h2>Cajas y Bancos</h2></div>${table(['Nombre','Tipo','Banco','Cuenta PUC','Saldo'], rows)}</div><div class="panel"><div class="panel-head"><h2>Pagos / recaudos recientes</h2></div>${payRows.length ? table(['Fecha','Documento','Método','Cuenta','Monto'], payRows) : '<div class="empty">Sin pagos.</div>'}</div>`;
  }
  window.openTransferV3 = function () { const c = state.cache.treasuryCash || []; modalV3(`<h2>Transferencia entre cuentas propias</h2><div class="field"><label>Origen</label><select id="trFrom" class="select">${c.map((x) => `<option value="${x.id}">${esc(x.nombre)} · ${money(x.saldoActual)}</option>`).join('')}</select></div><div class="field"><label>Destino</label><select id="trTo" class="select">${c.map((x) => `<option value="${x.id}">${esc(x.nombre)}</option>`).join('')}</select></div><div class="field"><label>Monto</label><input id="trAmount" class="input" type="number" min="0.01" step="0.01"></div><div class="field"><label>Concepto</label><input id="trConcept" class="input" value="Transferencia entre cuentas propias"></div><div id="trError"></div><div class="actions" style="justify-content:flex-end"><button class="btn" onclick="closeV3Global()">Cancelar</button><button class="btn primary" onclick="submitTransferV3()">Transferir</button></div>`); };
  window.submitTransferV3 = async function () { try { await api('/api/v1/integracion/tesoreria/transferencias', { method:'POST', body:JSON.stringify({ origenId:$('#trFrom').value,destinoId:$('#trTo').value,monto:Number($('#trAmount').value),concepto:$('#trConcept').value })}); closeV3(); render(); } catch(e){ $('#trError').innerHTML=`<div class="error">${esc(e.message)}</div>`; } };
  window.openDirectExpenseV3 = function () { const c=state.cache.treasuryCash||[], a=(state.cache.treasuryAccounts||[]).filter((x)=>x.activa&&x.permiteMovimiento&&String(x.codigo).startsWith('5')); modalV3(`<h2>Gasto directo de Tesorería</h2><div class="grid2"><div class="field"><label>Caja / Banco</label><select id="deCash" class="select">${c.map((x)=>`<option value="${x.id}">${esc(x.nombre)}</option>`).join('')}</select></div><div class="field"><label>Cuenta de gasto</label><select id="deAccount" class="select">${a.map((x)=>`<option value="${x.id}">${esc(x.codigo)} · ${esc(x.nombre)}</option>`).join('')}</select></div><div class="field"><label>Monto</label><input id="deAmount" class="input" type="number" min="0.01" step="0.01"></div><div class="field"><label>Concepto</label><input id="deConcept" class="input"></div></div><div id="deError"></div><div class="actions" style="justify-content:flex-end"><button class="btn" onclick="closeV3Global()">Cancelar</button><button class="btn primary" onclick="submitDirectExpenseV3()">Registrar gasto</button></div>`); };
  window.submitDirectExpenseV3=async function(){try{await api('/api/v1/integracion/tesoreria/gastos-directos',{method:'POST',body:JSON.stringify({cajaBancoId:$('#deCash').value,cuentaGastoId:$('#deAccount').value,monto:Number($('#deAmount').value),concepto:$('#deConcept').value})});closeV3();render()}catch(e){$('#deError').innerHTML=`<div class="error">${esc(e.message)}</div>`}};

  window.openMultiplePaymentV3 = async function () {
    try {
      const s=(await api('/api/v1/integracion/cartera/resumen')).data; state.cache.openCartera=s;
      const docs=s.terceros.flatMap((g)=>g.documentos.map((d)=>({g,d})));
      modalV3(`<h2>Aplicar pago / recaudo a cartera</h2><div class="field"><label>Tipo</label><select id="mpType" class="select" onchange="filterMultipleRowsV3()"><option value="CXC">Recaudo cliente (CxC)</option><option value="CXP">Pago proveedor (CxP)</option></select></div><div class="field"><label>Caja / Banco</label><select id="mpCash" class="select">${(state.cache.treasuryCash||[]).map((x)=>`<option value="${x.id}">${esc(x.nombre)}</option>`).join('')}</select></div><div id="mpRows">${docs.map(({g,d})=>`<label class="mp-row" data-type="${d.tipo}" style="display:${d.tipo==='CXC'?'grid':'none'};grid-template-columns:30px 1fr 130px;gap:8px;align-items:center;margin:8px 0"><input type="checkbox" class="mpCheck" data-doc="${d.comprobanteId}" data-third="${g.tercero.id}"><span>${esc(g.tercero.nombre)} · ${esc(d.referencia||d.comprobante?.numero||'')} · Saldo ${money(d.saldo)}</span><input class="input mpAmount" type="number" min="0.01" max="${Number(d.saldo)}" value="${Number(d.saldo)}"></label>`).join('')}</div><div id="mpError"></div><div class="actions" style="justify-content:flex-end"><button class="btn" onclick="closeV3Global()">Cancelar</button><button class="btn primary" onclick="submitMultiplePaymentV3()">Aplicar</button></div>`);
    } catch(e){alert(e.message)}
  };
  window.filterMultipleRowsV3=function(){const t=$('#mpType').value;document.querySelectorAll('.mp-row').forEach((r)=>{r.style.display=r.dataset.type===t?'grid':'none';r.querySelector('.mpCheck').checked=false})};
  window.submitMultiplePaymentV3=async function(){const type=$('#mpType').value,rows=[...document.querySelectorAll(`.mp-row[data-type="${type}"]`)].filter((r)=>r.querySelector('.mpCheck').checked),thirds=new Set(rows.map((r)=>r.querySelector('.mpCheck').dataset.third));if(!rows.length)return $('#mpError').innerHTML='<div class="error">Seleccione al menos una factura.</div>';if(thirds.size>1)return $('#mpError').innerHTML='<div class="error">Seleccione facturas de un solo tercero por aplicación.</div>';try{await api('/api/v1/integracion/tesoreria/aplicaciones-multiples',{method:'POST',body:JSON.stringify({tipo:type,cajaBancoId:$('#mpCash').value,metodoPago:'TRANSFERENCIA',aplicaciones:rows.map((r)=>({documentoId:r.querySelector('.mpCheck').dataset.doc,monto:Number(r.querySelector('.mpAmount').value)}))})});closeV3();render()}catch(e){$('#mpError').innerHTML=`<div class="error">${esc(e.message)}</div>`}};

  async function viewCarteraV3(){let s;try{s=(await api('/api/v1/integracion/cartera/resumen')).data}catch(e){return errorView(e)}const b=s.buckets,rows=s.terceros.map((g)=>`<tr><td>${esc(g.tercero.identificacion)}</td><td>${esc(g.tercero.nombre)}</td><td class="money">${money(g.CXC)}</td><td class="money">${money(g.CXP)}</td><td>${g.documentos.length}</td><td><button class="btn small" onclick="openAuxV3('${g.tercero.id}','CXC')">Aux CxC</button> <button class="btn small" onclick="openAuxV3('${g.tercero.id}','CXP')">Aux CxP</button></td></tr>`);return `<div class="pagehead"><div><h1>Cartera</h1><p>Vista consolidada de CxC/CxP. El detalle contable consulta el mismo auxiliar del PUC.</p></div></div><div class="cards"><div class="card metric"><div class="label">Corriente</div><div class="value">${money(b.CORRIENTE)}</div></div><div class="card metric"><div class="label">1–30 días</div><div class="value">${money(b['1_30'])}</div></div><div class="card metric"><div class="label">31–60 días</div><div class="value">${money(b['31_60'])}</div></div><div class="card metric"><div class="label">61–90 / +90</div><div class="value">${money(b['61_90']+b.MAS_90)}</div></div></div><div class="panel"><div class="panel-head"><h2>Saldos por tercero</h2><strong>${money(s.total)}</strong></div>${rows.length?table(['Documento','Tercero','CxC','CxP','Facturas','Auxiliar'],rows):'<div class="empty">No hay cartera abierta.</div>'}</div>`}
  window.openAuxV3=async function(id,tipo){try{const d=(await api(`/api/v1/integracion/cartera/terceros/${id}/auxiliar?tipo=${tipo}`)).data;modalV3(`<h2>Auxiliar ${esc(tipo)} · ${esc(d.tercero.nombre)}</h2><div class="notice">Cuenta ${esc(d.cuenta.codigo)} · ${esc(d.cuenta.nombre)} · Saldo auxiliar ${money(d.saldoAuxiliar)}</div>${table(['Fecha','Comprobante','Concepto','Débito','Crédito','Saldo'],(d.movimientos||[]).map((m)=>`<tr><td>${date(m.asiento.fecha)}</td><td>${esc(m.asiento.numeroComprobante||m.asiento.referencia||'')}</td><td>${esc(m.asiento.concepto)}</td><td class="money">${money(m.debito)}</td><td class="money">${money(m.credito)}</td><td class="money">${money(m.saldoAcumulado)}</td></tr>`))}<div class="actions" style="justify-content:flex-end"><button class="btn" onclick="closeV3Global()">Cerrar</button></div>`)}catch(e){alert(e.message)}};

  async function viewThirdsV3(){let r;try{r=await api('/api/v1/terceros?limit=500')}catch(e){return errorView(e)}state.cache.thirdsV3=r.data||[];const rows=state.cache.thirdsV3.map((t)=>`<tr><td>${esc(t.tipoDocumento)}</td><td>${esc(t.identificacion)}</td><td>${esc(t.razonSocial||t.nombre)}</td><td>${esc(t.tipo)}</td><td class="money">${money(t.cupoCredito)}</td><td>${t.diasPlazo} días</td><td><button class="btn small" onclick="openThirdV3('${t.id}')">Editar</button></td></tr>`);return `<div class="pagehead"><div><h1>Terceros</h1><p>Único maestro compartido por Ventas, Compras, Tesorería, Cartera y Contabilidad.</p></div><button class="btn primary" onclick="openThirdV3()">+ Nuevo tercero</button></div><div class="panel">${rows.length?table(['Doc.','Número','Nombre / Razón social','Tipo','Cupo','Plazo',''],rows):'<div class="empty">No hay terceros.</div>'}</div>`}
  window.openThirdV3=async function(id){let t=id?(state.cache.thirdsV3||[]).find((x)=>x.id===id):null,ext=null,users=[];try{if(id)ext=(await api(`/api/v1/integracion/terceros/${id}/operacion`)).data;try{users=(await api('/api/v1/usuarios?limit=500')).data||[]}catch{}}catch(e){return alert(e.message)}modalV3(`<h2>${t?'Editar':'Crear'} tercero</h2><div class="grid3"><div class="field"><label>Tipo documento</label><input id="thDocType" class="input" value="${esc(t?.tipoDocumento||'NIT')}"></div><div class="field"><label>Número</label><input id="thId" class="input" value="${esc(t?.identificacion||'')}" ${t?'readonly':''}></div><div class="field"><label>Nombre / Razón social</label><input id="thName" class="input" value="${esc(t?.nombre||'')}"></div><div class="field"><label>Tipo</label><select id="thType" class="select">${['CLIENTE','PROVEEDOR','EMPLEADO','CLIENTE_PROVEEDOR','OTRO'].map((x)=>`<option ${t?.tipo===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>Cupo de crédito</label><input id="thCredit" class="input" type="number" min="0" value="${Number(t?.cupoCredito||0)}"></div><div class="field"><label>Días de plazo</label><input id="thDays" class="input" type="number" min="0" value="${Number(t?.diasPlazo||0)}"></div><div class="field"><label>Condición por defecto</label><select id="thCondition" class="select">${['CONTADO','CREDITO_30','CREDITO_60','PERSONALIZADO'].map((x)=>`<option ${ext?.operacion?.condicionPagoDefault===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>Vendedor asignado</label><select id="thSeller" class="select"><option value="">Sin asignar</option>${users.map((u)=>`<option value="${u.id}" ${ext?.operacion?.vendedorAsignadoId===u.id?'selected':''}>${esc(u.nombre)} · ${esc(u.rol)}</option>`).join('')}</select></div><div class="field"><label><input id="thRetainer" type="checkbox" ${ext?.operacion?.responsableRetener?'checked':''}> Responsable de retener</label><label><input id="thIva" type="checkbox" ${t?.responsableIva?'checked':''}> Responsable IVA</label><label><input id="thRf" type="checkbox" ${t?.sujetoRetefuente?'checked':''}> Aplica retefuente</label><label><input id="thRi" type="checkbox" ${t?.sujetoReteIca?'checked':''}> Aplica ReteICA</label><label><input id="thRv" type="checkbox" ${t?.sujetoReteIva?'checked':''}> Aplica ReteIVA</label></div></div><div id="thError"></div><div class="actions" style="justify-content:flex-end"><button class="btn" onclick="closeV3Global()">Cancelar</button><button class="btn primary" onclick="saveThirdV3('${id||''}')">Guardar</button></div>`)};
  window.saveThirdV3=async function(id){const payload={tipoDocumento:$('#thDocType').value,identificacion:$('#thId').value,nombre:$('#thName').value,tipo:$('#thType').value,cupoCredito:Number($('#thCredit').value||0),diasPlazo:Number($('#thDays').value||0),responsableIva:$('#thIva').checked,sujetoRetefuente:$('#thRf').checked,sujetoReteIca:$('#thRi').checked,sujetoReteIva:$('#thRv').checked,activo:true};try{let third;if(id){third=(await api('/api/v1/terceros/'+id,{method:'PATCH',body:JSON.stringify(payload)})).data}else{third=(await api('/api/v1/terceros',{method:'POST',body:JSON.stringify(payload)})).data;id=third.id}await api(`/api/v1/integracion/terceros/${id}/operacion`,{method:'PATCH',body:JSON.stringify({cupoCredito:payload.cupoCredito,diasPlazo:payload.diasPlazo,operacion:{condicionPagoDefault:$('#thCondition').value,vendedorAsignadoId:$('#thSeller').value||null,responsableRetener:$('#thRetainer').checked}})});closeV3();render()}catch(e){$('#thError').innerHTML=`<div class="error">${esc(e.message)}</div>`}};

  render = async function renderV3() {
    loadSession(); if (!state.session) { renderLogin(); return; }
    const root = $('#root'); root.innerHTML = shell('<div class="loading">Cargando módulo…</div>'); bindShell();
    const path = location.pathname; let html;
    try {
      if (path === '/app' || path === '/app/') { history.replaceState({}, '', '/app/dashboard'); return render(); }
      if (path === '/app/dashboard') html = await viewDashboard();
      else if (path === '/app/ventas/nueva') html = await viewNewSale();
      else if (/^\/app\/ventas\/[^/]+$/.test(path)) html = await viewSaleDetail(path.split('/').pop());
      else if (path === '/app/ventas') html = await viewSales();
      else if (path === '/app/compras/nueva') html = await viewNewPurchaseV3();
      else if (/^\/app\/compras\/[^/]+$/.test(path)) html = await viewPurchaseDetailV3(path.split('/').pop());
      else if (path === '/app/compras') html = await viewPurchasesV3();
      else if (path === '/app/inventario') html = await viewInventoryV3();
      else if (path === '/app/tesoreria') html = await viewTreasuryV3();
      else if (path === '/app/cartera') html = await viewCarteraV3();
      else if (path === '/app/terceros') html = await viewThirdsV3();
      else if (path === '/app/configuracion') html = await viewConfigV3();
      else if (path === '/app/contabilidad') { location.href = '/app/contabilidad'; return; }
      else html = '<div class="empty">Ruta no encontrada.</div>';
    } catch (e) { html = errorView(e); }
    root.innerHTML = shell(html); bindShell();
    if (path === '/app/ventas/nueva') { lineSeq = 0; addLine(); toggleCash(); }
    if (path === '/app/compras/nueva') { purchaseLineSeq = 0; addPurchaseLineV3(); togglePurchaseCashV3(); }
  };

  window.addEventListener('popstate', () => render());
  render();
})();
