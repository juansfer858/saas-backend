(() => {
  'use strict';

  const metricDrilldown = { config: null, inventory: null, cartera: null };

  function metricButton(label, value, action, hint = '', valueStyle = '') {
    return `<button type="button" class="card metric core-metric-action" onclick="${action}" title="Abrir detalle" style="appearance:none;-webkit-appearance:none;width:100%;text-align:left;cursor:pointer;font:inherit;color:inherit"><div class="label">${esc(label)}</div><div class="value"${valueStyle ? ` style="${valueStyle}"` : ''}>${esc(value)}</div>${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</button>`;
  }

  function drilldownBack(label, action) {
    return `<div class="actions core-module-back" style="justify-content:flex-start;align-items:center;margin:0 0 14px"><button class="btn small" type="button" onclick="${action}">← Atrás</button><span class="muted" style="font-size:12px">Volver a ${esc(label)}</span></div>`;
  }

  function overdueDays(value) {
    if (!value) return null;
    const due = new Date(value);
    if (Number.isNaN(due.getTime())) return null;
    due.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.floor((today.getTime() - due.getTime()) / 86400000);
  }

  function portfolioMatchesBucket(row, bucket) {
    if (bucket === 'ALL') return true;
    const days = overdueDays(row.fechaVencimiento);
    if (days === null) return false;
    if (bucket === '0_30') return days >= 0 && days <= 30;
    if (bucket === '31_90') return days >= 31 && days <= 90;
    if (bucket === 'MAS_90') return days > 90;
    return true;
  }

  function portfolioBucketLabel(bucket) {
    return { ALL: 'Saldo abierto', '0_30': 'Vencido 0–30 días', '31_90': 'Vencido 31–90 días', MAS_90: 'Vencido +90 días' }[bucket] || 'Cartera';
  }

  function modalBox(id, title, body, submitLabel, onSubmit) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-back" id="${id}"><form class="modal" id="${id}Form"><h2>${esc(title)}</h2>${body}<div id="${id}Error"></div><div class="actions" style="justify-content:flex-end;margin-top:16px"><button class="btn" type="button" onclick="$('#${id}').remove()">Cancelar</button><button class="btn primary" type="submit">${esc(submitLabel)}</button></div></form></div>`);
    $(`#${id}Form`).onsubmit = async (e) => {
      e.preventDefault();
      const error = $(`#${id}Error`);
      if (error) error.innerHTML = '';
      try { await onSubmit(new FormData(e.currentTarget)); }
      catch (x) { if (error) error.innerHTML = `<div class="error">${esc(x.message)}</div>`; }
    };
  }

  async function loadCommon() {
    const [accounts, third, cash, products] = await Promise.all([
      api('/api/v1/contabilidad/cuentas?movimiento=true&activa=true&limit=3000'),
      api('/api/v1/terceros?limit=1000'),
      api('/api/v1/tesoreria/cajas-bancos'),
      api('/api/v1/inventario/productos?activo=true&limit=1000')
    ]);
    state.cache.accounts = accounts.data || [];
    state.cache.third = third.data || [];
    state.cache.cash = cash.data || [];
    state.cache.products = products.data || [];
    return state.cache;
  }

  function optionRows(items, selected, label) {
    return items.map((x) => `<option value="${x.id}" ${x.id===selected?'selected':''}>${esc(label(x))}</option>`).join('');
  }

  window.viewConfig = function viewConfigIntegrated() {
    setTimeout(hydrateAccountingConfig, 0);
    return `<div class="pagehead"><div><h1>Configuración</h1><p>Parametrización contable única para Ventas, Compras, Inventario, Tesorería y Cartera.</p></div></div><div id="accountingReadiness"><div class="loading">Cargando parametrización contable…</div></div><div id="accountingMappings"></div><div id="bankMappings"></div><div class="panel"><div class="panel-head"><h2>Método de costeo</h2></div><div class="audit-body"><strong>Promedio ponderado</strong><p class="muted">El Kardex actual calcula costo promedio ponderado transaccional. La opción PEPS requiere capas de costo y no se habilita hasta que el motor PEPS esté validado para reversos y devoluciones.</p></div></div>`;
  };

  window.openConfigMetric = function openConfigMetric(moduleKey) {
    metricDrilldown.config = moduleKey;
    hydrateAccountingConfig();
  };

  window.closeConfigMetric = function closeConfigMetric() {
    metricDrilldown.config = null;
    hydrateAccountingConfig();
  };

  window.hydrateAccountingConfig = async function hydrateAccountingConfig() {
    try {
      const [status, common] = await Promise.all([
        api('/api/v1/contabilidad/integracion/estado'),
        loadCommon()
      ]);
      const data = status.data;
      const moduleLabels = {VENTAS:'Ventas',COMPRAS:'Compras',INVENTARIO:'Inventario / Kardex',TESORERIA:'Tesorería & Bancos',CARTERA:'Cartera'};
      const selected = metricDrilldown.config;
      if (selected) {
        const module = data.modules[selected];
        $('#accountingReadiness').innerHTML = `${drilldownBack('Parametrización Contable','closeConfigMetric()')}<div class="notice"><strong>${esc(moduleLabels[selected] || selected)}</strong> · ${module?.ready ? 'LISTO' : 'FALTA CONFIGURAR'}${module?.missing?.length ? ` · ${esc(module.missing.join(', '))}` : ''}</div>`;
      } else {
        $('#accountingReadiness').innerHTML = `<div class="cards">${Object.entries(data.modules).map(([k,v])=>metricButton(moduleLabels[k]||k,v.ready?'LISTO':'FALTA CONFIGURAR',`openConfigMetric('${k}')`,v.missing.length?v.missing.join(', '):'Mapeos requeridos completos',`font-size:17px;color:${v.ready?'var(--green)':'var(--warn)'}`)).join('')}</div>`;
      }
      const mappings = selected ? data.mappings.filter((m) => m.module === selected) : data.mappings;
      $('#accountingMappings').innerHTML = `<div class="panel"><div class="panel-head"><h2>${selected ? `Parametrización · ${esc(moduleLabels[selected] || selected)}` : 'Parametrización contable'}</h2><span class="muted">${selected ? `${mappings.length} parámetros del módulo` : 'Los módulos nunca usan números PUC hardcodeados.'}</span></div>${mappings.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Módulo</th><th>Parámetro</th><th>Cuenta PUC</th><th>Estado</th><th></th></tr></thead><tbody>${mappings.map(m=>`<tr><td>${esc(m.module)}</td><td><strong>${esc(m.label)}</strong><br><span class="muted">${esc(m.clave)}</span></td><td><select class="select" id="map-${m.clave}"><option value="">Seleccione…</option>${optionRows(common.accounts,m.cuenta?.id,a=>`${a.codigo} · ${a.nombre} · ${a.naturaleza}`)}</select></td><td>${m.ready?'<span class="badge b-paid">Listo</span>':'<span class="badge b-partial">Pendiente</span>'}</td><td><button class="btn small" onclick="saveAccountingMap('${m.clave}')">Guardar</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Este módulo no tiene parámetros contables pendientes de mostrar.</div>'}</div>`;
      if (!selected || selected === 'TESORERIA') {
        $('#bankMappings').innerHTML = `<div class="panel"><div class="panel-head"><h2>Cuenta PUC por Caja / Banco</h2><span class="muted">Cada cuenta propia puede tener su subcuenta contable específica.</span></div><div class="table-wrap"><table class="table"><thead><tr><th>Cuenta</th><th>Tipo</th><th>Cuenta PUC</th><th></th></tr></thead><tbody>${common.cash.map(c=>`<tr><td><strong>${esc(c.nombre)}</strong></td><td>${esc(c.tipo)}</td><td><select class="select" id="bank-map-${c.id}"><option value="">Usar fallback general</option>${optionRows(common.accounts,c.cuentaContableId,a=>`${a.codigo} · ${a.nombre}`)}</select></td><td><button class="btn small" onclick="saveBankMap('${c.id}')">Guardar</button></td></tr>`).join('')}</tbody></table></div></div>`;
      } else {
        $('#bankMappings').innerHTML = '';
      }
    } catch (e) {
      $('#accountingReadiness').innerHTML = `<div class="error">${esc(e.message)}</div>`;
    }
  };

  window.saveAccountingMap = async function saveAccountingMap(key) {
    const cuentaId = $(`#map-${key}`).value;
    if (!cuentaId) return alert('Seleccione una cuenta PUC');
    try {
      await api(`/api/v1/contabilidad/mapeos/${encodeURIComponent(key)}`, { method:'PUT', body:JSON.stringify({cuentaId}) });
      await hydrateAccountingConfig();
    } catch (e) { alert(e.message); }
  };

  window.saveBankMap = async function saveBankMap(id) {
    const cuentaContableId = $(`#bank-map-${id}`).value;
    if (!cuentaContableId) return alert('Seleccione una cuenta PUC específica');
    try {
      await api(`/api/v1/tesoreria/cajas-bancos/${id}/cuenta-contable`, { method:'PATCH', body:JSON.stringify({cuentaContableId}) });
      await hydrateAccountingConfig();
    } catch (e) { alert(e.message); }
  };

  async function purchasesView() {
    const r = await api('/api/v1/comercial/compras?page=1&pageSize=200');
    const rows = r.data || [];
    return `<div class="pagehead"><div><h1>Compras</h1><p>Facturas de proveedores integradas con inventario, impuestos, cartera y asiento AU.</p></div><button class="btn primary" onclick="openNewPurchase()">+ Nueva compra</button></div><div class="panel"><div class="panel-head"><h2>Compras</h2><span class="muted">${r.meta?.total??rows.length} documentos</span></div>${rows.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Número</th><th>Fecha</th><th>Proveedor</th><th>Pago</th><th class="money">Total</th><th class="money">Saldo</th><th>Estado</th></tr></thead><tbody>${rows.map(x=>`<tr><td><strong>${esc(x.numero)}</strong></td><td>${date(x.fecha)}</td><td>${esc(x.tercero?.nombre||'—')}</td><td>${esc(x.formaPago||'—')}</td><td class="money">${money(x.total)}</td><td class="money">${money(x.saldo)}</td><td>${stateBadge(x.estado)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No hay compras registradas.</div>'}</div>`;
  }

  window.openNewPurchase = async function openNewPurchase() {
    try { await loadCommon(); } catch (e) { return alert(e.message); }
    const providers = state.cache.third.filter(t=>['PROVEEDOR','CLIENTE_PROVEEDOR'].includes(t.tipo)&&t.activo!==false);
    const products = state.cache.products.filter(p=>p.activo!==false);
    const body = `<div class="field"><label>Proveedor</label><select class="select" id="purThird" required><option value="">Seleccione…</option>${optionRows(providers,'',t=>`${t.identificacion} · ${t.nombre}`)}</select></div><div class="grid2"><div class="field"><label>Forma de pago</label><select class="select" id="purPay"><option value="CREDITO">Crédito</option><option value="EFECTIVO">Efectivo</option><option value="BANCO">Banco</option></select></div><div class="field"><label>Caja / Banco (si contado)</label><select class="select" id="purCash"><option value="">—</option>${optionRows(state.cache.cash,'',c=>`${c.nombre} · ${c.tipo}`)}</select></div></div><div class="field"><label>Producto</label><select class="select" id="purProduct" required><option value="">Seleccione…</option>${optionRows(products,'',p=>`${p.sku} · ${p.nombre}`)}</select></div><div class="grid3"><div class="field"><label>Cantidad</label><input class="input" id="purQty" type="number" min="0.0001" step="0.0001" value="1" required></div><div class="field"><label>Costo unitario</label><input class="input" id="purPrice" type="number" min="0" step="0.01" required></div><div class="field"><label>IVA %</label><input class="input" id="purVat" type="number" min="0" max="100" step="0.01" value="19"></div></div><div class="field"><label>Observaciones</label><input class="input" id="purObs"></div>`;
    modalBox('purchaseModal','Registrar compra',body,'Emitir compra',async()=>{
      const formaPago=$('#purPay').value,cajaBancoId=$('#purCash').value||null;
      if(formaPago!=='CREDITO'&&!cajaBancoId)throw new Error('Seleccione Caja/Banco para pago contado');
      await api('/api/v1/comercial/compras',{method:'POST',body:JSON.stringify({estado:'EMITIDO',terceroId:$('#purThird').value,formaPago,cajaBancoId,observaciones:$('#purObs').value||undefined,sourceId:`WEB-CP-${Date.now()}`,detalles:[{productoId:$('#purProduct').value,cantidad:Number($('#purQty').value),precioUnitario:Number($('#purPrice').value),ivaPct:Number($('#purVat').value||0)}]})});
      $('#purchaseModal').remove();render();
    });
  };

  window.openInventoryMetric = function openInventoryMetric(mode) {
    metricDrilldown.inventory = mode;
    render();
  };

  window.closeInventoryMetric = function closeInventoryMetric() {
    metricDrilldown.inventory = null;
    render();
  };

  async function inventoryView() {
    const [p,k] = await Promise.all([api('/api/v1/inventario/productos?limit=500'),api('/api/v1/inventario/kardex?limit=100')]);
    const products=p.data||[], moves=k.data||[];
    const productTable = (list, title = 'Productos') => `<div class="panel"><div class="panel-head"><h2>${esc(title)}</h2><span class="muted">${list.length} registros</span></div><div class="table-wrap"><table class="table"><thead><tr><th>SKU</th><th>Producto</th><th class="money">Stock</th><th class="money">Costo promedio</th><th class="money">Precio</th></tr></thead><tbody>${list.map(x=>`<tr><td>${esc(x.sku)}</td><td>${esc(x.nombre)}</td><td class="money">${Number(x.stockActual||0).toFixed(4)}</td><td class="money">${money(x.costoPromedio)}</td><td class="money">${money(x.precio1)}</td></tr>`).join('')}</tbody></table></div></div>`;
    const activeMetric = metricDrilldown.inventory;
    if (activeMetric) {
      const stockRows = products.filter((x) => x.controlaInventario !== false).slice().sort((a,b) => Number(b.stockActual||0)-Number(a.stockActual||0));
      const detailRows = activeMetric === 'STOCK' ? stockRows : products;
      const title = activeMetric === 'STOCK' ? 'Unidades en stock' : 'Productos';
      const totalUnits = detailRows.reduce((sum,x)=>sum+Number(x.stockActual||0),0);
      return `<div class="pagehead"><div><h1>Inventarios / Kardex</h1><p>Detalle del indicador seleccionado.</p></div><button class="btn primary" onclick="openInventoryAdjustment()">+ Ajuste de inventario</button></div>${drilldownBack('Inventarios / Kardex','closeInventoryMetric()')}<div class="notice"><strong>${esc(title)}</strong> · ${detailRows.length} productos · ${totalUnits.toFixed(2)} unidades</div>${productTable(detailRows, title)}`;
    }
    return `<div class="pagehead"><div><h1>Inventarios / Kardex</h1><p>Existencias, costo promedio y ajustes manuales con asiento AU obligatorio.</p></div><button class="btn primary" onclick="openInventoryAdjustment()">+ Ajuste de inventario</button></div><div class="cards">${metricButton('Productos',products.length,"openInventoryMetric('PRODUCTS')",'Abrir catálogo con existencias')}${metricButton('Unidades en stock',products.reduce((a,x)=>a+Number(x.stockActual||0),0).toFixed(2),"openInventoryMetric('STOCK')",'Ver productos ordenados por existencia')}</div>${productTable(products)}<div class="panel"><div class="panel-head"><h2>Kardex reciente</h2></div><div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Producto</th><th class="money">Cantidad</th><th class="money">Costo</th><th>Referencia</th></tr></thead><tbody>${moves.map(x=>`<tr><td>${date(x.creadoEn)}</td><td>${esc(x.tipo)}</td><td>${esc(x.producto?.nombre||'')}</td><td class="money">${Number(x.cantidad||0).toFixed(4)}</td><td class="money">${money(x.costoTotal)}</td><td>${esc(x.referencia||'')}</td></tr>`).join('')}</tbody></table></div></div>`;
  }

  window.openInventoryAdjustment = async function openInventoryAdjustment() {
    try { await loadCommon(); } catch(e){return alert(e.message)}
    const body=`<div class="field"><label>Producto</label><select class="select" id="adjProduct" required>${optionRows(state.cache.products.filter(p=>p.controlaInventario),'',p=>`${p.sku} · ${p.nombre} · stock ${p.stockActual}`)}</select></div><div class="grid2"><div class="field"><label>Tipo</label><select class="select" id="adjType"><option value="AJUSTE_SALIDA">Faltante</option><option value="MERMA">Merma</option><option value="AJUSTE_ENTRADA">Sobrante</option></select></div><div class="field"><label>Cantidad</label><input class="input" id="adjQty" type="number" min="0.0001" step="0.0001" required></div></div><div class="field"><label>Costo unitario (solo sobrante; vacío usa regla del motor)</label><input class="input" id="adjCost" type="number" min="0" step="0.0001"></div><div class="field"><label>Justificación obligatoria</label><textarea class="input" id="adjReason" rows="3" required></textarea></div>`;
    modalBox('adjustModal','Ajuste contable de inventario',body,'Registrar ajuste',async()=>{await api('/api/v1/inventario/ajustes',{method:'POST',body:JSON.stringify({productoId:$('#adjProduct').value,tipo:$('#adjType').value,cantidad:Number($('#adjQty').value),costoUnitario:$('#adjCost').value?Number($('#adjCost').value):undefined,justificacion:$('#adjReason').value,sourceId:`WEB-INV-${Date.now()}`})});$('#adjustModal').remove();render()});
  };

  async function treasuryView() {
    const [cash,payments]=await Promise.all([api('/api/v1/tesoreria/cajas-bancos'),api('/api/v1/tesoreria/pagos?limit=50')]);
    state.cache.cash=cash.data||[];
    const rows=state.cache.cash;
    return `<div class="pagehead"><div><h1>Tesorería & Bancos</h1><p>Caja, bancos, recaudos, pagos, transferencias internas y gastos directos.</p></div><div class="actions"><button class="btn" onclick="openTreasuryTransfer()">Transferir</button><button class="btn primary" onclick="openDirectExpense()">+ Gasto directo</button></div></div><div class="panel"><div class="panel-head"><h2>Cuentas propias</h2></div><div class="table-wrap"><table class="table"><thead><tr><th>Nombre</th><th>Tipo</th><th>Banco</th><th>Cuenta</th><th class="money">Saldo</th></tr></thead><tbody>${rows.map(x=>`<tr><td><strong>${esc(x.nombre)}</strong></td><td>${esc(x.tipo)}</td><td>${esc(x.banco||'—')}</td><td>${esc(x.numeroCuenta||'—')}</td><td class="money">${money(x.saldoActual)}</td></tr>`).join('')}</tbody></table></div></div><div class="panel"><div class="panel-head"><h2>Pagos / recaudos recientes</h2></div><div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Documento</th><th>Método</th><th class="money">Monto</th><th>Referencia</th></tr></thead><tbody>${(payments.data||[]).map(x=>`<tr><td>${date(x.creadoEn)}</td><td>${esc(x.documento?.numero||x.documentoId)}</td><td>${esc(x.metodoPago)}</td><td class="money">${money(x.monto)}</td><td>${esc(x.referencia||'')}</td></tr>`).join('')}</tbody></table></div></div>`;
  }

  window.openTreasuryTransfer = async function openTreasuryTransfer(){try{await loadCommon()}catch(e){return alert(e.message)}const cash=state.cache.cash;const body=`<div class="field"><label>Origen</label><select class="select" id="trFrom">${optionRows(cash,'',c=>`${c.nombre} · ${money(c.saldoActual)}`)}</select></div><div class="field"><label>Destino</label><select class="select" id="trTo">${optionRows(cash,'',c=>c.nombre)}</select></div><div class="field"><label>Monto</label><input class="input" id="trAmount" type="number" min="0.01" step="0.01" required></div><div class="field"><label>Concepto</label><input class="input" id="trConcept" value="Transferencia entre cuentas propias"></div>`;modalBox('transferModal','Transferencia interna',body,'Transferir',async()=>{await api('/api/v1/tesoreria/transferencias',{method:'POST',body:JSON.stringify({origenCajaBancoId:$('#trFrom').value,destinoCajaBancoId:$('#trTo').value,monto:Number($('#trAmount').value),concepto:$('#trConcept').value,sourceId:`WEB-TR-${Date.now()}`})});$('#transferModal').remove();render()})};

  window.openDirectExpense = async function openDirectExpense(){try{await loadCommon()}catch(e){return alert(e.message)}const expenses=state.cache.accounts.filter(a=>String(a.codigo).startsWith('5')||String(a.codigo).startsWith('6'));const body=`<div class="field"><label>Caja / Banco</label><select class="select" id="gdCash">${optionRows(state.cache.cash,'',c=>c.nombre)}</select></div><div class="field"><label>Cuenta de gasto</label><select class="select" id="gdAccount"><option value="">Usar parametrización GASTO_DIRECTO</option>${optionRows(expenses,'',a=>`${a.codigo} · ${a.nombre}`)}</select></div><div class="field"><label>Tercero (opcional)</label><select class="select" id="gdThird"><option value="">Sin tercero</option>${optionRows(state.cache.third,'',t=>`${t.identificacion} · ${t.nombre}`)}</select></div><div class="field"><label>Monto</label><input class="input" id="gdAmount" type="number" min="0.01" step="0.01" required></div><div class="field"><label>Concepto</label><input class="input" id="gdConcept" required></div>`;modalBox('expenseModal','Gasto directo',body,'Registrar gasto',async()=>{await api('/api/v1/tesoreria/gastos-directos',{method:'POST',body:JSON.stringify({cajaBancoId:$('#gdCash').value,cuentaGastoId:$('#gdAccount').value||undefined,terceroId:$('#gdThird').value||undefined,monto:Number($('#gdAmount').value),concepto:$('#gdConcept').value,sourceId:`WEB-GD-${Date.now()}`})});$('#expenseModal').remove();render()})};

  window.openCarteraMetric = function openCarteraMetric(bucket) {
    metricDrilldown.cartera = bucket;
    render();
  };

  window.closeCarteraMetric = function closeCarteraMetric() {
    metricDrilldown.cartera = null;
    render();
  };

  async function carteraView() {
    const [open,aging,cxc,cxp,cash]=await Promise.all([api('/api/v1/tesoreria/cartera?estado=PENDIENTE&pageSize=500'),api('/api/v1/tesoreria/cartera/antiguedad'),api('/api/v1/tesoreria/cartera/conciliacion-contable?tipo=CXC'),api('/api/v1/tesoreria/cartera/conciliacion-contable?tipo=CXP'),api('/api/v1/tesoreria/cajas-bancos')]);
    state.cache.cash=cash.data||[];
    const rows=open.data||[], a=aging.data;
    const rowTable = (list, title) => `<div class="panel"><div class="panel-head"><h2>${esc(title)}</h2><span class="muted">${list.length} documentos · ${money(list.reduce((sum,x)=>sum+Number(x.saldo||0),0))}</span></div><div class="table-wrap"><table class="table"><thead><tr><th></th><th>Tipo</th><th>Tercero</th><th>Referencia</th><th>Vence</th><th class="money">Saldo</th><th>Estado</th></tr></thead><tbody>${list.map(x=>`<tr><td><input type="checkbox" class="portfolio-check" data-doc="${x.comprobanteId}" data-third="${x.terceroId}" data-type="${x.tipo}" data-saldo="${x.saldo}"></td><td>${esc(x.tipo)}</td><td>${esc(x.tercero?.nombre||'')}</td><td>${esc(x.referencia||'')}</td><td>${date(x.fechaVencimiento)}</td><td class="money">${money(x.saldo)}</td><td>${esc(x.estado)}</td></tr>`).join('')}</tbody></table></div></div>`;
    const activeBucket = metricDrilldown.cartera;
    const header = `<div class="pagehead"><div><h1>Cartera</h1><p>CxC y CxP derivadas de documentos, pagos y los mismos auxiliares contables.</p></div><button class="btn primary" onclick="openBatchPayment()">Aplicar pago a seleccionadas</button></div>`;
    const reconciliation = `<div class="notice">Conciliación CxC: ${cxc.data.cuadra?'CUADRA':'DIFERENCIA '+money(cxc.data.diferencia)} · CxP: ${cxp.data.cuadra?'CUADRA':'DIFERENCIA '+money(cxp.data.diferencia)}</div>`;
    if (activeBucket) {
      const filtered = rows.filter((row) => portfolioMatchesBucket(row, activeBucket));
      const label = portfolioBucketLabel(activeBucket);
      return `${header}${drilldownBack('Cartera','closeCarteraMetric()')}<div class="notice"><strong>${esc(label)}</strong> · detalle filtrado por antigüedad de vencimiento</div>${reconciliation}${rowTable(filtered,label)}`;
    }
    return `${header}<div class="cards">${metricButton('Saldo abierto',money(a.totales.TOTAL),"openCarteraMetric('ALL')",'Ver todos los documentos pendientes')}${metricButton('Vencido 0–30',money(a.totales['0_30']),"openCarteraMetric('0_30')",'Ver documentos vencidos hasta 30 días')}${metricButton('Vencido 31–90',money(Number(a.totales['31_60'])+Number(a.totales['61_90'])),"openCarteraMetric('31_90')",'Ver documentos vencidos entre 31 y 90 días')}${metricButton('+90 días',money(a.totales.MAS_90),"openCarteraMetric('MAS_90')",'Ver cartera vencida por más de 90 días')}</div>${reconciliation}${rowTable(rows,'Documentos abiertos')}`;
  }

  window.openBatchPayment = async function openBatchPayment(){const checked=[...document.querySelectorAll('.portfolio-check:checked')];if(!checked.length)return alert('Seleccione una o varias facturas del mismo tercero y tipo de cartera');const body=`<div class="notice">${checked.length} factura(s) seleccionada(s). Puede modificar el monto aplicado a cada una.</div>${checked.map((x,i)=>`<div class="grid2"><div class="field"><label>Factura ${i+1}</label><input class="input" value="${esc(x.dataset.doc)}" disabled></div><div class="field"><label>Monto</label><input class="input batch-amount" data-doc="${x.dataset.doc}" type="number" min="0.01" max="${x.dataset.saldo}" value="${x.dataset.saldo}" step="0.01"></div></div>`).join('')}<div class="field"><label>Caja / Banco</label><select class="select" id="batchCash">${optionRows(state.cache.cash||[],'',c=>`${c.nombre} · ${c.tipo}`)}</select></div><div class="field"><label>Método</label><select class="select" id="batchMethod"><option>EFECTIVO</option><option>TRANSFERENCIA</option><option>TARJETA</option></select></div><div class="field"><label>Referencia</label><input class="input" id="batchRef"></div>`;modalBox('batchModal','Aplicar pago múltiple',body,'Aplicar pago',async()=>{const aplicaciones=[...document.querySelectorAll('.batch-amount')].map(x=>({documentoId:x.dataset.doc,monto:Number(x.value)}));await api('/api/v1/tesoreria/pagos/aplicar-multiples',{method:'POST',body:JSON.stringify({cajaBancoId:$('#batchCash').value,metodoPago:$('#batchMethod').value,referencia:$('#batchRef').value||undefined,sourceId:`WEB-BATCH-${Date.now()}`,aplicaciones})});$('#batchModal').remove();render()})};

  async function thirdView(){const r=await api('/api/v1/terceros?limit=1000'),rows=r.data||[];state.cache.third=rows;return `<div class="pagehead"><div><h1>Terceros</h1><p>Único maestro compartido por Ventas, Compras, Tesorería, Cartera y Contabilidad.</p></div><button class="btn primary" onclick="openThirdPartyForm()">+ Nuevo tercero</button></div><div class="panel"><div class="panel-head"><h2>Terceros</h2><span class="muted">${rows.length} registros</span></div><div class="table-wrap"><table class="table"><thead><tr><th>Documento</th><th>Nombre</th><th>Tipo</th><th class="money">Cupo crédito</th><th>Plazo</th><th>Fiscal</th></tr></thead><tbody>${rows.map(t=>`<tr><td>${esc(t.tipoDocumento)} ${esc(t.identificacion)}</td><td><strong>${esc(t.razonSocial||t.nombre)}</strong><br><span class="muted">${esc(t.email||t.telefono||'')}</span></td><td>${esc(t.tipo)}</td><td class="money">${money(t.cupoCredito)}</td><td>${t.diasPlazo||0} días</td><td>${[t.responsableIva?'IVA':null,t.sujetoRetefuente?'RF':null,t.sujetoReteIca?'RICA':null,t.sujetoReteIva?'RIVA':null].filter(Boolean).join(' · ')||'—'}</td></tr>`).join('')}</tbody></table></div></div>`}

  window.openThirdPartyForm=async function openThirdPartyForm(){const body=`<div class="grid2"><div class="field"><label>Tipo</label><select class="select" id="tpType"><option>CLIENTE</option><option>PROVEEDOR</option><option>CLIENTE_PROVEEDOR</option><option>EMPLEADO</option><option>OTRO</option></select></div><div class="field"><label>Tipo documento</label><select class="select" id="tpDoc"><option>NIT</option><option>CC</option><option>CE</option><option>PP</option></select></div></div><div class="grid2"><div class="field"><label>Número</label><input class="input" id="tpId" required></div><div class="field"><label>Nombre / Razón social</label><input class="input" id="tpName" required></div></div><div class="grid2"><div class="field"><label>Teléfono</label><input class="input" id="tpPhone"></div><div class="field"><label>Correo</label><input class="input" type="email" id="tpEmail"></div></div><div class="grid2"><div class="field"><label>Cupo de crédito</label><input class="input" id="tpCredit" type="number" min="0" value="0"></div><div class="field"><label>Plazo por defecto (días)</label><input class="input" id="tpDays" type="number" min="0" value="0"></div></div><div class="field"><label><input type="checkbox" id="tpIva"> Responsable IVA</label><label><input type="checkbox" id="tpRf"> Sujeto retefuente</label><label><input type="checkbox" id="tpRica"> Sujeto ReteICA</label><label><input type="checkbox" id="tpRiva"> Sujeto ReteIVA</label></div>`;modalBox('thirdModal','Crear tercero',body,'Guardar tercero',async()=>{await api('/api/v1/terceros',{method:'POST',body:JSON.stringify({tipo:$('#tpType').value,tipoDocumento:$('#tpDoc').value,identificacion:$('#tpId').value,nombre:$('#tpName').value,razonSocial:$('#tpName').value,telefono:$('#tpPhone').value||undefined,email:$('#tpEmail').value||undefined,cupoCredito:Number($('#tpCredit').value||0),diasPlazo:Number($('#tpDays').value||0),responsableIva:$('#tpIva').checked,sujetoRetefuente:$('#tpRf').checked,sujetoReteIca:$('#tpRica').checked,sujetoReteIva:$('#tpRiva').checked})});$('#thirdModal').remove();render()})};

  const originalViewGeneric = window.viewGeneric;
  window.viewGeneric = async function integratedGeneric(kind) {
    if (kind === 'compras') return purchasesView();
    if (kind === 'inventario') return inventoryView();
    if (kind === 'tesoreria') return treasuryView();
    if (kind === 'cartera') return carteraView();
    if (kind === 'terceros') return thirdView();
    return originalViewGeneric(kind);
  };

  window.VantixGCCoreMetricDrilldowns = 'v1';

  if (location.pathname === '/app/configuracion' || ['/app/compras','/app/inventario','/app/tesoreria','/app/cartera','/app/terceros'].includes(location.pathname)) {
    setTimeout(() => render(), 0);
  }
})();