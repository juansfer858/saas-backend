(() => {
  'use strict';
  const MARKER = 'VANTIX_MENU_OCR_EDITABLE_UI_V1';
  const COMMON_CATEGORIES = [
    'Hamburguesas','Perros','Salchipapas','Papas','Tornados','Chuzos','Combos','Pizzas','Arepas',
    'Sándwiches','Entradas','Fuertes','Bebidas','Jugos','Gaseosas','Cervezas','Cafés','Postres','Helados','Menú Kids','Otros'
  ];
  const OPERATIONAL = ['ENTRADAS','FUERTES','BEBIDAS','POSTRES'];
  const STATIONS = ['COCINA','BARRA','POSTRES'];

  const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const key = (value) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

  function inferRouting(category, product) {
    const value = `${key(category)} ${key(product)}`;
    if (/(BEBIDA|JUGO|GASEOSA|SODA|AGUA|CAFE|CERVEZA|VINO|COCTEL|LIMONADA|MALTEADA|\bTE\b|CHOCOLATE)/.test(value)) return { operationalCategory:'BEBIDAS', station:'BARRA' };
    if (/(POSTRE|HELADO|TORTA|PASTEL|BROWNIE|FLAN|TIRAMISU|DULCE|WAFFLE)/.test(value)) return { operationalCategory:'POSTRES', station:'POSTRES' };
    if (/(ENTRADA|PICADA|NACHO|EMPANADA|AREPA|PAN DE AJO|ALITA|PATACON)/.test(value)) return { operationalCategory:'ENTRADAS', station:'COCINA' };
    return { operationalCategory:'FUERTES', station:'COCINA' };
  }

  function ensureStyle() {
    if (document.querySelector('#restaurantMenuOcrEditableStyle')) return;
    const style = document.createElement('style');
    style.id = 'restaurantMenuOcrEditableStyle';
    style.textContent = `
      .cc-ocr-edit-note{margin:-4px 0 14px;padding:10px 12px;border-radius:10px;background:#f8fafc;border:1px solid #dbe5ec;color:#475569;font-size:12px;font-weight:700}
      .cc-ocr-bulk{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 12px;padding:10px;border:1px solid #dbe5ec;border-radius:12px;background:#fff}
      .cc-ocr-bulk label{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:800;color:#475569}
      .cc-ocr-bulk input[type="text"]{min-width:210px;min-height:38px;padding:7px 9px;border:1px solid #cfd8df;border-radius:8px;background:#fff}
      .cc-ocr-bulk button{min-height:38px;padding:0 12px;border:1px solid #a7b8c4;border-radius:8px;background:#fff;font-weight:800;cursor:pointer}
      .cc-ocr-bulk button:hover{background:#f8fafc}.cc-ocr-bulk-count{font-size:11px;color:#64748b;font-weight:800}
      .cc-ocr-row-check{width:18px;height:18px;accent-color:#137a53;cursor:pointer}
      .cc-ocr-table select{width:100%;min-height:42px;padding:7px 8px;border:1px solid #cfd8df;border-radius:9px;background:#fff;font-size:13px}
      .cc-ocr-table select:focus{outline:2px solid rgba(19,122,83,.16);border-color:#137a53}
      .cc-ocr-col-check{width:34px}.cc-ocr-col-route{min-width:118px}.cc-ocr-col-station{min-width:108px}
      @media(max-width:700px){.cc-ocr-bulk{position:sticky;left:0}.cc-ocr-bulk input[type="text"]{min-width:160px}.cc-ocr-table{min-width:980px!important}}
    `;
    document.head.appendChild(style);
  }

  function ensureCategoryDatalist(table) {
    let list = document.querySelector('#ccOcrCategoryOptions');
    if (!list) {
      list = document.createElement('datalist');
      list.id = 'ccOcrCategoryOptions';
      document.body.appendChild(list);
    }
    const values = new Set(COMMON_CATEGORIES);
    table.querySelectorAll('[data-field="category"]').forEach((input) => { if (clean(input.value)) values.add(clean(input.value)); });
    list.replaceChildren();
    [...values].sort((a,b) => a.localeCompare(b, 'es')).forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      list.appendChild(option);
    });
    table.querySelectorAll('[data-field="category"]').forEach((input) => input.setAttribute('list', list.id));
    return list;
  }

  function optionHtml(values, selected) {
    return values.map((value) => `<option value="${value}"${value === selected ? ' selected' : ''}>${value}</option>`).join('');
  }

  function syncRouting(row, force = false) {
    const categoryInput = row.querySelector('[data-field="category"]');
    const productInput = row.querySelector('[data-field="subcategory"]');
    const operational = row.querySelector('[data-field="operationalCategory"]');
    const station = row.querySelector('[data-field="station"]');
    if (!operational || !station) return;
    if (!force && row.dataset.routingManual === 'true') return;
    const inferred = inferRouting(categoryInput?.value, productInput?.value);
    operational.value = inferred.operationalCategory;
    station.value = inferred.station;
    row.dataset.operationalCategory = inferred.operationalCategory;
    row.dataset.station = inferred.station;
  }

  function addEditableColumns(table) {
    const headRow = table.querySelector('thead tr');
    if (!headRow || headRow.dataset.editableV1 === 'true') return;
    headRow.dataset.editableV1 = 'true';

    const checkTh = document.createElement('th');
    checkTh.className = 'cc-ocr-col-check';
    checkTh.innerHTML = '<input id="ccOcrSelectAll" class="cc-ocr-row-check" type="checkbox" aria-label="Seleccionar todos">';
    headRow.insertBefore(checkTh, headRow.firstElementChild);

    const priceTh = [...headRow.children].find((th) => /PRECIO/i.test(th.textContent || ''));
    const confidenceTh = [...headRow.children].find((th) => /CONFIANZA/i.test(th.textContent || ''));
    const opTh = document.createElement('th'); opTh.className = 'cc-ocr-col-route'; opTh.textContent = 'Tipo';
    const stationTh = document.createElement('th'); stationTh.className = 'cc-ocr-col-station'; stationTh.textContent = 'Estación';
    headRow.insertBefore(opTh, confidenceTh || priceTh?.nextSibling || null);
    headRow.insertBefore(stationTh, confidenceTh || opTh.nextSibling);

    table.querySelectorAll('tbody tr').forEach((row) => enhanceRow(row));

    const selectAll = table.querySelector('#ccOcrSelectAll');
    selectAll?.addEventListener('change', () => {
      table.querySelectorAll('tbody .cc-ocr-row-check').forEach((checkbox) => { checkbox.checked = selectAll.checked; });
      updateSelectionCount(table);
    });
  }

  function enhanceRow(row) {
    if (row.dataset.editableV1 === 'true') return;
    row.dataset.editableV1 = 'true';

    const checkTd = document.createElement('td');
    checkTd.className = 'cc-ocr-col-check';
    checkTd.innerHTML = '<input class="cc-ocr-row-check" type="checkbox" aria-label="Seleccionar producto">';
    row.insertBefore(checkTd, row.firstElementChild);

    const confidenceTd = [...row.children].find((td) => td.classList.contains('cc-ocr-confidence'));
    const opTd = document.createElement('td'); opTd.className = 'cc-ocr-col-route';
    const stationTd = document.createElement('td'); stationTd.className = 'cc-ocr-col-station';
    const currentOp = OPERATIONAL.includes(row.dataset.operationalCategory) ? row.dataset.operationalCategory : 'FUERTES';
    const currentStation = STATIONS.includes(row.dataset.station) ? row.dataset.station : 'COCINA';
    opTd.innerHTML = `<select data-field="operationalCategory" aria-label="Tipo operativo">${optionHtml(OPERATIONAL, currentOp)}</select>`;
    stationTd.innerHTML = `<select data-field="station" aria-label="Estación">${optionHtml(STATIONS, currentStation)}</select>`;
    row.insertBefore(opTd, confidenceTd || null);
    row.insertBefore(stationTd, confidenceTd || null);

    const categoryInput = row.querySelector('[data-field="category"]');
    const productInput = row.querySelector('[data-field="subcategory"]');
    const operational = row.querySelector('[data-field="operationalCategory"]');
    const station = row.querySelector('[data-field="station"]');

    categoryInput?.addEventListener('change', () => { row.dataset.routingManual = 'false'; syncRouting(row, true); ensureCategoryDatalist(row.closest('table')); });
    productInput?.addEventListener('change', () => syncRouting(row));
    operational?.addEventListener('change', () => {
      row.dataset.routingManual = 'true';
      row.dataset.operationalCategory = operational.value;
      if (operational.value === 'BEBIDAS' && station.value === 'COCINA') { station.value = 'BARRA'; row.dataset.station = 'BARRA'; }
      if (operational.value === 'POSTRES' && station.value !== 'POSTRES') { station.value = 'POSTRES'; row.dataset.station = 'POSTRES'; }
    });
    station?.addEventListener('change', () => { row.dataset.routingManual = 'true'; row.dataset.station = station.value; });
    checkTd.querySelector('input')?.addEventListener('change', () => updateSelectionCount(row.closest('table')));
  }

  function selectedRows(table) {
    return [...table.querySelectorAll('tbody tr')].filter((row) => row.querySelector('.cc-ocr-row-check')?.checked);
  }

  function updateSelectionCount(table) {
    const count = selectedRows(table).length;
    const label = table.closest('#ccOcrBody')?.querySelector('#ccOcrSelectedCount');
    if (label) label.textContent = `${count} seleccionado${count === 1 ? '' : 's'}`;
    const all = table.querySelector('#ccOcrSelectAll');
    if (all) {
      const total = table.querySelectorAll('tbody .cc-ocr-row-check').length;
      all.checked = total > 0 && count === total;
      all.indeterminate = count > 0 && count < total;
    }
  }

  function addBulkToolbar(table) {
    const wrap = table.parentElement;
    if (!wrap || wrap.previousElementSibling?.classList?.contains('cc-ocr-bulk')) return;
    const toolbar = document.createElement('div');
    toolbar.className = 'cc-ocr-bulk';
    toolbar.innerHTML = `
      <label><input id="ccOcrBulkSelectAll" type="checkbox"> Seleccionar todos</label>
      <input id="ccOcrBulkCategory" type="text" list="ccOcrCategoryOptions" placeholder="Categoría destino, ej. Hamburguesas" maxlength="80">
      <button id="ccOcrMoveSelected" type="button">Mover seleccionados</button>
      <span id="ccOcrSelectedCount" class="cc-ocr-bulk-count">0 seleccionados</span>`;
    wrap.parentElement.insertBefore(toolbar, wrap);

    toolbar.querySelector('#ccOcrBulkSelectAll')?.addEventListener('change', (event) => {
      table.querySelectorAll('tbody .cc-ocr-row-check').forEach((checkbox) => { checkbox.checked = event.target.checked; });
      const header = table.querySelector('#ccOcrSelectAll'); if (header) header.checked = event.target.checked;
      updateSelectionCount(table);
    });

    toolbar.querySelector('#ccOcrMoveSelected')?.addEventListener('click', () => {
      const target = clean(toolbar.querySelector('#ccOcrBulkCategory')?.value);
      if (!target) { alert('Escribe la categoría destino.'); return; }
      const rows = selectedRows(table);
      if (!rows.length) { alert('Selecciona al menos un producto.'); return; }
      rows.forEach((row) => {
        const category = row.querySelector('[data-field="category"]');
        if (category) category.value = target;
        row.dataset.routingManual = 'false';
        syncRouting(row, true);
      });
      ensureCategoryDatalist(table);
      updateSelectionCount(table);
    });
  }

  function addEditableNote(table) {
    const body = table.closest('#ccOcrBody');
    if (!body || body.querySelector('.cc-ocr-edit-note')) return;
    const note = document.createElement('div');
    note.className = 'cc-ocr-edit-note';
    note.textContent = 'Todo es editable antes de importar: categoría, producto/sabor, precio, tipo operativo y estación. También puedes seleccionar varias filas y moverlas juntas a otra categoría.';
    const greenNote = body.querySelector('.cc-ocr-note');
    if (greenNote?.nextSibling) body.insertBefore(note, greenNote.nextSibling); else body.prepend(note);
  }

  function enhancePreview() {
    const table = document.querySelector('#ccOcrTable');
    if (!table) return;
    ensureStyle();
    ensureCategoryDatalist(table);
    addEditableColumns(table);
    table.querySelectorAll('tbody tr').forEach((row) => enhanceRow(row));
    addBulkToolbar(table);
    addEditableNote(table);
  }

  let scheduled = false;
  function install() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; enhancePreview(); });
  }

  const observer = new MutationObserver(install);
  observer.observe(document.documentElement, { childList:true, subtree:true, attributes:true, attributeFilter:['hidden'] });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true }); else install();

  window.VantixGCRestaurantOcrEditableUi = { marker:MARKER, inferRouting, enhancePreview };
})();
