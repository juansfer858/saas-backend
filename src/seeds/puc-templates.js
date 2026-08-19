// Catálogo base de compatibilidad contable para Colombia.
// Fuente normativa de estructura/codificación: Decreto 2650 de 1993 (PUC comerciantes).
// El Core conserva una versión explícita para poder evolucionar catálogos por país
// sin reescribir cuentas ya creadas en cada tenant.
const PUC_CO_VERSION = 'CO-D2650-1993-CORE-V1';

const PUC_CO = [
  { codigo: '1', nombre: 'Activo', nivel: 'CLASE', naturaleza: 'DEBITO' },
  { codigo: '11', nombre: 'Disponible', nivel: 'GRUPO', naturaleza: 'DEBITO', parent: '1' },
  { codigo: '1105', nombre: 'Caja', nivel: 'CUENTA', naturaleza: 'DEBITO', parent: '11' },
  { codigo: '110505', nombre: 'Caja general', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '1105', permiteMovimiento: true },
  { codigo: '1110', nombre: 'Bancos', nivel: 'CUENTA', naturaleza: 'DEBITO', parent: '11' },
  { codigo: '111005', nombre: 'Moneda nacional', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '1110', permiteMovimiento: true },
  { codigo: '13', nombre: 'Deudores', nivel: 'GRUPO', naturaleza: 'DEBITO', parent: '1' },
  { codigo: '1305', nombre: 'Clientes', nivel: 'CUENTA', naturaleza: 'DEBITO', parent: '13' },
  { codigo: '130505', nombre: 'Nacionales', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '1305', permiteMovimiento: true, requiereTercero: true },
  { codigo: '1355', nombre: 'Anticipo de impuestos y contribuciones o saldos a favor', nivel: 'CUENTA', naturaleza: 'DEBITO', parent: '13' },
  { codigo: '135530', nombre: 'Impuestos descontables', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '1355', permiteMovimiento: true },
  { codigo: '135595', nombre: 'Otros', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '1355', permiteMovimiento: true },
  { codigo: '14', nombre: 'Inventarios', nivel: 'GRUPO', naturaleza: 'DEBITO', parent: '1' },
  { codigo: '1435', nombre: 'Mercancías no fabricadas por la empresa', nivel: 'CUENTA', naturaleza: 'DEBITO', parent: '14' },
  { codigo: '143505', nombre: 'Mercancías no fabricadas por la empresa', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '1435', permiteMovimiento: true },

  { codigo: '2', nombre: 'Pasivo', nivel: 'CLASE', naturaleza: 'CREDITO' },
  { codigo: '22', nombre: 'Proveedores', nivel: 'GRUPO', naturaleza: 'CREDITO', parent: '2' },
  { codigo: '2205', nombre: 'Nacionales', nivel: 'CUENTA', naturaleza: 'CREDITO', parent: '22' },
  { codigo: '220505', nombre: 'Nacionales', nivel: 'SUBCUENTA', naturaleza: 'CREDITO', parent: '2205', permiteMovimiento: true, requiereTercero: true },
  { codigo: '24', nombre: 'Impuestos, gravámenes y tasas', nivel: 'GRUPO', naturaleza: 'CREDITO', parent: '2' },
  { codigo: '2408', nombre: 'Impuesto sobre las ventas por pagar', nivel: 'CUENTA', naturaleza: 'CREDITO', parent: '24' },
  // El Decreto deja 240801-240898 disponibles. El Core reserva dos subcuentas
  // internas para separar IVA generado/descontable sin romper la estructura PUC.
  { codigo: '240801', nombre: 'IVA generado - auxiliar Core', nivel: 'SUBCUENTA', naturaleza: 'CREDITO', parent: '2408', permiteMovimiento: true },
  { codigo: '240802', nombre: 'IVA descontable - auxiliar Core', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '2408', permiteMovimiento: true },
  { codigo: '2495', nombre: 'Otros', nivel: 'CUENTA', naturaleza: 'CREDITO', parent: '24' },
  { codigo: '249505', nombre: 'Impuesto nacional al consumo por pagar - auxiliar Core', nivel: 'SUBCUENTA', naturaleza: 'CREDITO', parent: '2495', permiteMovimiento: true },

  { codigo: '3', nombre: 'Patrimonio', nivel: 'CLASE', naturaleza: 'CREDITO' },
  { codigo: '31', nombre: 'Capital social', nivel: 'GRUPO', naturaleza: 'CREDITO', parent: '3' },
  { codigo: '3105', nombre: 'Capital suscrito y pagado', nivel: 'CUENTA', naturaleza: 'CREDITO', parent: '31' },

  { codigo: '4', nombre: 'Ingresos', nivel: 'CLASE', naturaleza: 'CREDITO' },
  { codigo: '41', nombre: 'Operacionales', nivel: 'GRUPO', naturaleza: 'CREDITO', parent: '4' },
  { codigo: '4135', nombre: 'Comercio al por mayor y al por menor', nivel: 'CUENTA', naturaleza: 'CREDITO', parent: '41' },
  { codigo: '413505', nombre: 'Venta de productos agrícolas', nivel: 'SUBCUENTA', naturaleza: 'CREDITO', parent: '4135', permiteMovimiento: true },

  { codigo: '5', nombre: 'Gastos', nivel: 'CLASE', naturaleza: 'DEBITO' },
  { codigo: '51', nombre: 'Operacionales de administración', nivel: 'GRUPO', naturaleza: 'DEBITO', parent: '5' },
  { codigo: '5135', nombre: 'Servicios', nivel: 'CUENTA', naturaleza: 'DEBITO', parent: '51' },
  { codigo: '513505', nombre: 'Aseo y vigilancia', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '5135', permiteMovimiento: true },
  { codigo: '513525', nombre: 'Acueducto y alcantarillado', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '5135', permiteMovimiento: true },
  { codigo: '513530', nombre: 'Energía eléctrica', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '5135', permiteMovimiento: true },
  { codigo: '513535', nombre: 'Teléfono', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '5135', permiteMovimiento: true },
  { codigo: '513550', nombre: 'Transporte, fletes y acarreos', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '5135', permiteMovimiento: true },
  { codigo: '5195', nombre: 'Diversos', nivel: 'CUENTA', naturaleza: 'DEBITO', parent: '51' },
  { codigo: '519595', nombre: 'Otros', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '5195', permiteMovimiento: true },

  { codigo: '6', nombre: 'Costos de ventas', nivel: 'CLASE', naturaleza: 'DEBITO' },
  { codigo: '61', nombre: 'Costo de ventas y de prestación de servicios', nivel: 'GRUPO', naturaleza: 'DEBITO', parent: '6' },
  { codigo: '6135', nombre: 'Comercio al por mayor y al por menor', nivel: 'CUENTA', naturaleza: 'DEBITO', parent: '61' },
  { codigo: '613505', nombre: 'Costo de mercancías vendidas', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '6135', permiteMovimiento: true },

  { codigo: '7', nombre: 'Costos de producción o de operación', nivel: 'CLASE', naturaleza: 'DEBITO' },
  { codigo: '8', nombre: 'Cuentas de orden deudoras', nivel: 'CLASE', naturaleza: 'DEBITO' },
  { codigo: '9', nombre: 'Cuentas de orden acreedoras', nivel: 'CLASE', naturaleza: 'CREDITO' }
];

const PUC_GENERIC = PUC_CO;

function getPucTemplate(country = 'CO') {
  const normalized = String(country || 'CO').trim().toUpperCase();
  return normalized === 'CO' ? PUC_CO : PUC_GENERIC;
}

function getPucVersion(country = 'CO') {
  const normalized = String(country || 'CO').trim().toUpperCase();
  return normalized === 'CO' ? PUC_CO_VERSION : `GENERIC-${PUC_CO_VERSION}`;
}

const ACCOUNTING_MAPPING_CODES = {
  CAJA_GENERAL: '110505',
  BANCO_GENERAL: '111005',
  CLIENTES: '130505',
  IMPUESTO_COMPRA: '240802',
  IMPOCONSUMO_COMPRA: '135595',
  INVENTARIO: '143505',
  PROVEEDORES: '220505',
  IMPUESTO_VENTA: '240801',
  IMPOCONSUMO_VENTA: '249505',
  VENTAS: '413505',
  GASTO_COMPRA: '519595',
  COSTO_VENTAS: '613505'
};

module.exports = {
  PUC_CO_VERSION,
  getPucTemplate,
  getPucVersion,
  ACCOUNTING_MAPPING_CODES
};
