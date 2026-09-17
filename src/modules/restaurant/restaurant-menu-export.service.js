'use strict';

const { toExcelHtml } = require('../accounting/accounting-export.service');
const menuImport = require('./restaurant-menu-import.service');
const commercialCategories = require('./restaurant-commercial-categories-v26.service');

const EXPORT_COLUMNS = [
  { label:'Categoría', width:.20, type:'text', align:'left' },
  { label:'Producto / Variante', width:.30, type:'text', align:'left' },
  { label:'Precio', width:.14, type:'number', align:'right' },
  { label:'Categoría operativa', width:.15, type:'text', align:'left' },
  { label:'Estación', width:.13, type:'text', align:'left' },
  { label:'Confianza', width:.08, type:'number', align:'right' }
];

async function currentCartaRows(tenantId) {
  const rows = (await menuImport.listCarta(tenantId))
    .map((row) => ({ ...row, menuItemId:row.menuItemId || row.id }));
  return commercialCategories.decorateCartaRows(tenantId, rows);
}

async function exportCarta(tenantId) {
  const carta = await currentCartaRows(tenantId);
  const rows = carta.map((item) => [
    item.category || '',
    item.subcategory || '',
    Number(item.price || 0),
    item.operationalCategory || '',
    item.station || '',
    1
  ]);
  const date = new Date().toISOString().slice(0, 10);
  return {
    filename:`Carta_${date}.xls`,
    count:rows.length,
    buffer:toExcelHtml({
      title:'Carta del restaurante',
      headers:EXPORT_COLUMNS.map((column) => column.label),
      columns:EXPORT_COLUMNS,
      rows,
      rowStyles:rows.map(() => 'data')
    })
  };
}

module.exports = { EXPORT_COLUMNS, currentCartaRows, exportCarta };
