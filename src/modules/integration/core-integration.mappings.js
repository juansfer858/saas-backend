const ACCOUNTING_INTEGRATION_MAPPINGS = Object.freeze([
  { clave: 'CAJA_GENERAL', label: 'Caja general', defaultCode: '110505', grupo: 'Tesorería' },
  { clave: 'BANCO_GENERAL', label: 'Banco general', defaultCode: '111005', grupo: 'Tesorería' },
  { clave: 'CLIENTES', label: 'Clientes / Cuentas por cobrar', defaultCode: '130505', grupo: 'Cartera' },
  { clave: 'PROVEEDORES', label: 'Proveedores / Cuentas por pagar', defaultCode: '220505', grupo: 'Cartera' },
  { clave: 'INVENTARIO', label: 'Inventario de mercancías', defaultCode: '143505', grupo: 'Inventarios' },
  { clave: 'COSTO_VENTAS', label: 'Costo de venta', defaultCode: '613505', grupo: 'Ventas' },
  { clave: 'VENTAS', label: 'Ingresos por ventas', defaultCode: '413505', grupo: 'Ventas' },
  { clave: 'IMPUESTO_VENTA', label: 'IVA generado en ventas', defaultCode: '240801', grupo: 'Impuestos' },
  { clave: 'IMPUESTO_COMPRA', label: 'IVA descontable en compras', defaultCode: '240802', grupo: 'Impuestos' },
  { clave: 'RETENCION_FUENTE_PAGAR', label: 'Retención en la fuente por pagar', defaultCode: '236540', grupo: 'Impuestos' },
  { clave: 'RETENCION_FUENTE_FAVOR', label: 'Retención en la fuente a favor', defaultCode: '135515', grupo: 'Impuestos' },
  { clave: 'RETENCION_IVA_PAGAR', label: 'ReteIVA por pagar', defaultCode: '236705', grupo: 'Impuestos' },
  { clave: 'RETENCION_IVA_FAVOR', label: 'ReteIVA a favor', defaultCode: '135517', grupo: 'Impuestos' },
  { clave: 'RETENCION_ICA_PAGAR', label: 'ReteICA por pagar', defaultCode: '236805', grupo: 'Impuestos' },
  { clave: 'RETENCION_ICA_FAVOR', label: 'ReteICA a favor', defaultCode: '135518', grupo: 'Impuestos' },
  { clave: 'GASTO_COMPRA', label: 'Gasto de compra / servicio', defaultCode: '519595', grupo: 'Compras' },
  { clave: 'GASTO_FALTANTE_INVENTARIO', label: 'Gasto por faltante / merma', defaultCode: '519595', grupo: 'Inventarios' },
  { clave: 'INGRESO_SOBRANTE_INVENTARIO', label: 'Ingreso por sobrante de inventario', defaultCode: '429505', grupo: 'Inventarios' },
  { clave: 'ANTICIPOS_OTROS', label: 'Anticipos / otros', defaultCode: '135595', grupo: 'Otros' }
]);

const MAPPING_BY_KEY = new Map(ACCOUNTING_INTEGRATION_MAPPINGS.map((item) => [item.clave, item]));

module.exports = { ACCOUNTING_INTEGRATION_MAPPINGS, MAPPING_BY_KEY };
