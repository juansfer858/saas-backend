const PUC_CO = [
  { codigo: '1', nombre: 'Activo', nivel: 'CLASE', naturaleza: 'DEBITO' },
  { codigo: '11', nombre: 'Disponible', nivel: 'GRUPO', naturaleza: 'DEBITO', parent: '1' },
  { codigo: '1105', nombre: 'Caja', nivel: 'CUENTA', naturaleza: 'DEBITO', parent: '11' },
  { codigo: '110505', nombre: 'Caja general', nivel: 'AUXILIAR', naturaleza: 'DEBITO', parent: '1105', permiteMovimiento: true },
  { codigo: '1110', nombre: 'Bancos', nivel: 'CUENTA', naturaleza: 'DEBITO', parent: '11' },
  { codigo: '111005', nombre: 'Bancos - moneda nacional', nivel: 'AUXILIAR', naturaleza: 'DEBITO', parent: '1110', permiteMovimiento: true },
  { codigo: '13', nombre: 'Deudores', nivel: 'GRUPO', naturaleza: 'DEBITO', parent: '1' },
  { codigo: '1305', nombre: 'Clientes', nivel: 'CUENTA', naturaleza: 'DEBITO', parent: '13' },
  { codigo: '130505', nombre: 'Clientes nacionales', nivel: 'AUXILIAR', naturaleza: 'DEBITO', parent: '1305', permiteMovimiento: true },
  { codigo: '1355', nombre: 'Anticipos de impuestos y contribuciones', nivel: 'CUENTA', naturaleza: 'DEBITO', parent: '13' },
  { codigo: '135595', nombre: 'Impuestos descontables en compras', nivel: 'AUXILIAR', naturaleza: 'DEBITO', parent: '1355', permiteMovimiento: true },
  { codigo: '14', nombre: 'Inventarios', nivel: 'GRUPO', naturaleza: 'DEBITO', parent: '1' },
  { codigo: '1435', nombre: 'Mercancias no fabricadas por la empresa', nivel: 'CUENTA', naturaleza: 'DEBITO', parent: '14' },
  { codigo: '143505', nombre: 'Inventario de mercancias', nivel: 'AUXILIAR', naturaleza: 'DEBITO', parent: '1435', permiteMovimiento: true },

  { codigo: '2', nombre: 'Pasivo', nivel: 'CLASE', naturaleza: 'CREDITO' },
  { codigo: '22', nombre: 'Proveedores', nivel: 'GRUPO', naturaleza: 'CREDITO', parent: '2' },
  { codigo: '2205', nombre: 'Proveedores nacionales', nivel: 'CUENTA', naturaleza: 'CREDITO', parent: '22' },
  { codigo: '220505', nombre: 'Proveedores nacionales - auxiliar', nivel: 'AUXILIAR', naturaleza: 'CREDITO', parent: '2205', permiteMovimiento: true },
  { codigo: '24', nombre: 'Impuestos, gravamenes y tasas', nivel: 'GRUPO', naturaleza: 'CREDITO', parent: '2' },
  { codigo: '2408', nombre: 'Impuesto sobre las ventas por pagar', nivel: 'CUENTA', naturaleza: 'CREDITO', parent: '24' },
  { codigo: '240805', nombre: 'IVA generado', nivel: 'AUXILIAR', naturaleza: 'CREDITO', parent: '2408', permiteMovimiento: true },
  { codigo: '240810', nombre: 'IVA descontable', nivel: 'AUXILIAR', naturaleza: 'DEBITO', parent: '2408', permiteMovimiento: true },
  { codigo: '2495', nombre: 'Otros impuestos por pagar', nivel: 'CUENTA', naturaleza: 'CREDITO', parent: '24' },
  { codigo: '249505', nombre: 'Impuesto nacional al consumo por pagar', nivel: 'AUXILIAR', naturaleza: 'CREDITO', parent: '2495', permiteMovimiento: true },

  { codigo: '4', nombre: 'Ingresos', nivel: 'CLASE', naturaleza: 'CREDITO' },
  { codigo: '41', nombre: 'Operacionales', nivel: 'GRUPO', naturaleza: 'CREDITO', parent: '4' },
  { codigo: '4135', nombre: 'Comercio al por mayor y al por menor', nivel: 'CUENTA', naturaleza: 'CREDITO', parent: '41' },
  { codigo: '413505', nombre: 'Ventas de mercancias y servicios', nivel: 'AUXILIAR', naturaleza: 'CREDITO', parent: '4135', permiteMovimiento: true },

  { codigo: '5', nombre: 'Gastos', nivel: 'CLASE', naturaleza: 'DEBITO' },
  { codigo: '51', nombre: 'Operacionales de administracion', nivel: 'GRUPO', naturaleza: 'DEBITO', parent: '5' },
  { codigo: '5195', nombre: 'Diversos', nivel: 'CUENTA', naturaleza: 'DEBITO', parent: '51' },
  { codigo: '519595', nombre: 'Compras y gastos diversos', nivel: 'AUXILIAR', naturaleza: 'DEBITO', parent: '5195', permiteMovimiento: true },

  { codigo: '6', nombre: 'Costos de ventas', nivel: 'CLASE', naturaleza: 'DEBITO' },
  { codigo: '61', nombre: 'Costo de ventas y prestacion de servicios', nivel: 'GRUPO', naturaleza: 'DEBITO', parent: '6' },
  { codigo: '6135', nombre: 'Comercio al por mayor y al por menor', nivel: 'CUENTA', naturaleza: 'DEBITO', parent: '61' },
  { codigo: '613505', nombre: 'Costo de mercancias vendidas', nivel: 'AUXILIAR', naturaleza: 'DEBITO', parent: '6135', permiteMovimiento: true }
];

const PUC_GENERIC = PUC_CO;

function getPucTemplate(country = 'CO') {
  const normalized = String(country || 'CO').trim().toUpperCase();
  return normalized === 'CO' ? PUC_CO : PUC_GENERIC;
}

const ACCOUNTING_MAPPING_CODES = {
  CAJA_GENERAL: '110505',
  BANCO_GENERAL: '111005',
  CLIENTES: '130505',
  IMPUESTO_COMPRA: '240810',
  IMPOCONSUMO_COMPRA: '135595',
  INVENTARIO: '143505',
  PROVEEDORES: '220505',
  IMPUESTO_VENTA: '240805',
  IMPOCONSUMO_VENTA: '249505',
  VENTAS: '413505',
  GASTO_COMPRA: '519595',
  COSTO_VENTAS: '613505'
};

module.exports = {
  getPucTemplate,
  ACCOUNTING_MAPPING_CODES
};
