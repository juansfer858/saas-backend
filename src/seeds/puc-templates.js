// Catálogo operativo de compatibilidad contable para Colombia.
// Fuente estructural: Decreto 2650 de 1993. No pretende ser el catálogo exhaustivo;
// el Core conserva una versión explícita y permite cuentas/subcuentas personalizadas.
const PUC_CO_VERSION = 'CO-D2650-1993-CORE-V2';

const A = 'ACTIVO_CORRIENTE';
const AN = 'ACTIVO_NO_CORRIENTE';
const P = 'PASIVO_CORRIENTE';
const PN = 'PASIVO_NO_CORRIENTE';
const PT = 'PATRIMONIO';
const R = 'RESULTADO';
const O = 'ORDEN';

const IO = 'INGRESO_OPERACIONAL';
const CV = 'COSTO_VENTAS';
const GA = 'GASTO_ADMINISTRACION';
const GV = 'GASTO_VENTAS';
const INO = 'INGRESO_NO_OPERACIONAL';
const GNO = 'GASTO_NO_OPERACIONAL';
const IR = 'IMPUESTO_RENTA';

const PUC_CO = [
  { codigo: '1', nombre: 'Activo', nivel: 'CLASE', naturaleza: 'DEBITO', clasificacionESF: A },
  { codigo: '11', nombre: 'Disponible', nivel: 'GRUPO', naturaleza: 'DEBITO', parent: '1', clasificacionESF: A },
  { codigo: '1105', nombre: 'Caja', nivel: 'CUENTA', naturaleza: 'DEBITO', parent: '11', clasificacionESF: A },
  { codigo: '110505', nombre: 'Caja general', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '1105', permiteMovimiento: true, clasificacionESF: A },
  { codigo: '1110', nombre: 'Bancos', nivel: 'CUENTA', naturaleza: 'DEBITO', parent: '11', clasificacionESF: A },
  { codigo: '111005', nombre: 'Moneda nacional', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '1110', permiteMovimiento: true, clasificacionESF: A },
  { codigo: '13', nombre: 'Deudores', nivel: 'GRUPO', naturaleza: 'DEBITO', parent: '1', clasificacionESF: A },
  { codigo: '1305', nombre: 'Clientes', nivel: 'CUENTA', naturaleza: 'DEBITO', parent: '13', clasificacionESF: A },
  { codigo: '130505', nombre: 'Nacionales', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '1305', permiteMovimiento: true, requiereTercero: true, clasificacionESF: A },
  { codigo: '1355', nombre: 'Anticipo de impuestos y contribuciones o saldos a favor', nivel: 'CUENTA', naturaleza: 'DEBITO', parent: '13', clasificacionESF: A },
  { codigo: '135515', nombre: 'Retención en la fuente', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '1355', permiteMovimiento: true, clasificacionESF: A },
  { codigo: '135517', nombre: 'Impuesto a las ventas retenido', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '1355', permiteMovimiento: true, clasificacionESF: A },
  { codigo: '135518', nombre: 'Impuesto de industria y comercio retenido', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '1355', permiteMovimiento: true, clasificacionESF: A },
  { codigo: '135530', nombre: 'Impuestos descontables', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '1355', permiteMovimiento: true, clasificacionESF: A },
  { codigo: '135595', nombre: 'Otros', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '1355', permiteMovimiento: true, clasificacionESF: A },
  { codigo: '14', nombre: 'Inventarios', nivel: 'GRUPO', naturaleza: 'DEBITO', parent: '1', clasificacionESF: A },
  { codigo: '1435', nombre: 'Mercancías no fabricadas por la empresa', nivel: 'CUENTA', naturaleza: 'DEBITO', parent: '14', clasificacionESF: A },
  { codigo: '143505', nombre: 'Mercancías no fabricadas por la empresa', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '1435', permiteMovimiento: true, clasificacionESF: A },
  { codigo: '15', nombre: 'Propiedades, planta y equipo', nivel: 'GRUPO', naturaleza: 'DEBITO', parent: '1', clasificacionESF: AN },
  { codigo: '1524', nombre: 'Equipo de oficina', nivel: 'CUENTA', naturaleza: 'DEBITO', parent: '15', clasificacionESF: AN },
  { codigo: '152405', nombre: 'Muebles y enseres', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '1524', permiteMovimiento: true, clasificacionESF: AN },
  { codigo: '1592', nombre: 'Depreciación acumulada', nivel: 'CUENTA', naturaleza: 'CREDITO', parent: '15', clasificacionESF: AN },
  { codigo: '159215', nombre: 'Equipo de oficina - depreciación acumulada', nivel: 'SUBCUENTA', naturaleza: 'CREDITO', parent: '1592', permiteMovimiento: true, clasificacionESF: AN },

  { codigo: '2', nombre: 'Pasivo', nivel: 'CLASE', naturaleza: 'CREDITO', clasificacionESF: P },
  { codigo: '22', nombre: 'Proveedores', nivel: 'GRUPO', naturaleza: 'CREDITO', parent: '2', clasificacionESF: P },
  { codigo: '2205', nombre: 'Nacionales', nivel: 'CUENTA', naturaleza: 'CREDITO', parent: '22', clasificacionESF: P },
  { codigo: '220505', nombre: 'Nacionales', nivel: 'SUBCUENTA', naturaleza: 'CREDITO', parent: '2205', permiteMovimiento: true, requiereTercero: true, clasificacionESF: P },
  { codigo: '23', nombre: 'Cuentas por pagar', nivel: 'GRUPO', naturaleza: 'CREDITO', parent: '2', clasificacionESF: P },
  { codigo: '2365', nombre: 'Retención en la fuente', nivel: 'CUENTA', naturaleza: 'CREDITO', parent: '23', clasificacionESF: P },
  { codigo: '236540', nombre: 'Compras', nivel: 'SUBCUENTA', naturaleza: 'CREDITO', parent: '2365', permiteMovimiento: true, requiereTercero: true, clasificacionESF: P },
  { codigo: '2367', nombre: 'Impuesto a las ventas retenido', nivel: 'CUENTA', naturaleza: 'CREDITO', parent: '23', clasificacionESF: P },
  { codigo: '236705', nombre: 'IVA retenido', nivel: 'SUBCUENTA', naturaleza: 'CREDITO', parent: '2367', permiteMovimiento: true, requiereTercero: true, clasificacionESF: P },
  { codigo: '2368', nombre: 'Impuesto de industria y comercio retenido', nivel: 'CUENTA', naturaleza: 'CREDITO', parent: '23', clasificacionESF: P },
  { codigo: '236805', nombre: 'ICA retenido', nivel: 'SUBCUENTA', naturaleza: 'CREDITO', parent: '2368', permiteMovimiento: true, requiereTercero: true, clasificacionESF: P },
  { codigo: '24', nombre: 'Impuestos, gravámenes y tasas', nivel: 'GRUPO', naturaleza: 'CREDITO', parent: '2', clasificacionESF: P },
  { codigo: '2404', nombre: 'De renta y complementarios', nivel: 'CUENTA', naturaleza: 'CREDITO', parent: '24', clasificacionESF: P },
  { codigo: '240405', nombre: 'Vigencia fiscal corriente', nivel: 'SUBCUENTA', naturaleza: 'CREDITO', parent: '2404', permiteMovimiento: true, clasificacionESF: P },
  { codigo: '2408', nombre: 'Impuesto sobre las ventas por pagar', nivel: 'CUENTA', naturaleza: 'CREDITO', parent: '24', clasificacionESF: P },
  { codigo: '240801', nombre: 'IVA generado - auxiliar Core', nivel: 'SUBCUENTA', naturaleza: 'CREDITO', parent: '2408', permiteMovimiento: true, clasificacionESF: P },
  { codigo: '240802', nombre: 'IVA descontable - auxiliar Core', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '2408', permiteMovimiento: true, clasificacionESF: P },
  { codigo: '2495', nombre: 'Otros', nivel: 'CUENTA', naturaleza: 'CREDITO', parent: '24', clasificacionESF: P },
  { codigo: '249505', nombre: 'Impuesto nacional al consumo por pagar - auxiliar Core', nivel: 'SUBCUENTA', naturaleza: 'CREDITO', parent: '2495', permiteMovimiento: true, clasificacionESF: P },
  { codigo: '26', nombre: 'Pasivos estimados y provisiones', nivel: 'GRUPO', naturaleza: 'CREDITO', parent: '2', clasificacionESF: PN },

  { codigo: '3', nombre: 'Patrimonio', nivel: 'CLASE', naturaleza: 'CREDITO', clasificacionESF: PT },
  { codigo: '31', nombre: 'Capital social', nivel: 'GRUPO', naturaleza: 'CREDITO', parent: '3', clasificacionESF: PT },
  { codigo: '3105', nombre: 'Capital suscrito y pagado', nivel: 'CUENTA', naturaleza: 'CREDITO', parent: '31', clasificacionESF: PT },
  { codigo: '36', nombre: 'Resultados del ejercicio', nivel: 'GRUPO', naturaleza: 'CREDITO', parent: '3', clasificacionESF: PT },
  { codigo: '3605', nombre: 'Utilidad del ejercicio', nivel: 'CUENTA', naturaleza: 'CREDITO', parent: '36', clasificacionESF: PT },
  { codigo: '360505', nombre: 'Utilidad del ejercicio - auxiliar Core', nivel: 'SUBCUENTA', naturaleza: 'CREDITO', parent: '3605', permiteMovimiento: true, clasificacionESF: PT },
  { codigo: '3610', nombre: 'Pérdida del ejercicio', nivel: 'CUENTA', naturaleza: 'DEBITO', parent: '36', clasificacionESF: PT },
  { codigo: '361005', nombre: 'Pérdida del ejercicio - auxiliar Core', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '3610', permiteMovimiento: true, clasificacionESF: PT },

  { codigo: '4', nombre: 'Ingresos', nivel: 'CLASE', naturaleza: 'CREDITO', clasificacionESF: R },
  { codigo: '41', nombre: 'Operacionales', nivel: 'GRUPO', naturaleza: 'CREDITO', parent: '4', clasificacionESF: R, categoriaResultado: IO },
  { codigo: '4135', nombre: 'Comercio al por mayor y al por menor', nivel: 'CUENTA', naturaleza: 'CREDITO', parent: '41', clasificacionESF: R, categoriaResultado: IO },
  { codigo: '413505', nombre: 'Venta de productos agrícolas', nivel: 'SUBCUENTA', naturaleza: 'CREDITO', parent: '4135', permiteMovimiento: true, clasificacionESF: R, categoriaResultado: IO },
  { codigo: '42', nombre: 'No operacionales', nivel: 'GRUPO', naturaleza: 'CREDITO', parent: '4', clasificacionESF: R, categoriaResultado: INO },
  { codigo: '4295', nombre: 'Diversos', nivel: 'CUENTA', naturaleza: 'CREDITO', parent: '42', clasificacionESF: R, categoriaResultado: INO },
  { codigo: '429505', nombre: 'Otros ingresos no operacionales', nivel: 'SUBCUENTA', naturaleza: 'CREDITO', parent: '4295', permiteMovimiento: true, clasificacionESF: R, categoriaResultado: INO },

  { codigo: '5', nombre: 'Gastos', nivel: 'CLASE', naturaleza: 'DEBITO', clasificacionESF: R },
  { codigo: '51', nombre: 'Operacionales de administración', nivel: 'GRUPO', naturaleza: 'DEBITO', parent: '5', clasificacionESF: R, categoriaResultado: GA },
  { codigo: '5135', nombre: 'Servicios', nivel: 'CUENTA', naturaleza: 'DEBITO', parent: '51', clasificacionESF: R, categoriaResultado: GA },
  { codigo: '513505', nombre: 'Aseo y vigilancia', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '5135', permiteMovimiento: true, clasificacionESF: R, categoriaResultado: GA },
  { codigo: '513525', nombre: 'Acueducto y alcantarillado', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '5135', permiteMovimiento: true, clasificacionESF: R, categoriaResultado: GA },
  { codigo: '513530', nombre: 'Energía eléctrica', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '5135', permiteMovimiento: true, clasificacionESF: R, categoriaResultado: GA },
  { codigo: '513535', nombre: 'Teléfono', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '5135', permiteMovimiento: true, clasificacionESF: R, categoriaResultado: GA },
  { codigo: '513550', nombre: 'Transporte, fletes y acarreos', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '5135', permiteMovimiento: true, clasificacionESF: R, categoriaResultado: GA },
  { codigo: '5160', nombre: 'Depreciaciones', nivel: 'CUENTA', naturaleza: 'DEBITO', parent: '51', clasificacionESF: R, categoriaResultado: GA },
  { codigo: '516015', nombre: 'Equipo de oficina', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '5160', permiteMovimiento: true, clasificacionESF: R, categoriaResultado: GA },
  { codigo: '5195', nombre: 'Diversos', nivel: 'CUENTA', naturaleza: 'DEBITO', parent: '51', clasificacionESF: R, categoriaResultado: GA },
  { codigo: '519595', nombre: 'Otros', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '5195', permiteMovimiento: true, clasificacionESF: R, categoriaResultado: GA },
  { codigo: '52', nombre: 'Operacionales de ventas', nivel: 'GRUPO', naturaleza: 'DEBITO', parent: '5', clasificacionESF: R, categoriaResultado: GV },
  { codigo: '5295', nombre: 'Diversos de ventas', nivel: 'CUENTA', naturaleza: 'DEBITO', parent: '52', clasificacionESF: R, categoriaResultado: GV },
  { codigo: '529595', nombre: 'Otros gastos de ventas', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '5295', permiteMovimiento: true, clasificacionESF: R, categoriaResultado: GV },
  { codigo: '53', nombre: 'No operacionales', nivel: 'GRUPO', naturaleza: 'DEBITO', parent: '5', clasificacionESF: R, categoriaResultado: GNO },
  { codigo: '5305', nombre: 'Financieros', nivel: 'CUENTA', naturaleza: 'DEBITO', parent: '53', clasificacionESF: R, categoriaResultado: GNO },
  { codigo: '530505', nombre: 'Gastos bancarios y financieros', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '5305', permiteMovimiento: true, clasificacionESF: R, categoriaResultado: GNO },
  { codigo: '54', nombre: 'Impuesto de renta y complementarios', nivel: 'GRUPO', naturaleza: 'DEBITO', parent: '5', clasificacionESF: R, categoriaResultado: IR },
  { codigo: '5405', nombre: 'Impuesto de renta y complementarios', nivel: 'CUENTA', naturaleza: 'DEBITO', parent: '54', clasificacionESF: R, categoriaResultado: IR },
  { codigo: '540505', nombre: 'Impuesto de renta corriente - auxiliar Core', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '5405', permiteMovimiento: true, clasificacionESF: R, categoriaResultado: IR },

  { codigo: '6', nombre: 'Costos de ventas', nivel: 'CLASE', naturaleza: 'DEBITO', clasificacionESF: R },
  { codigo: '61', nombre: 'Costo de ventas y de prestación de servicios', nivel: 'GRUPO', naturaleza: 'DEBITO', parent: '6', clasificacionESF: R, categoriaResultado: CV },
  { codigo: '6135', nombre: 'Comercio al por mayor y al por menor', nivel: 'CUENTA', naturaleza: 'DEBITO', parent: '61', clasificacionESF: R, categoriaResultado: CV },
  { codigo: '613505', nombre: 'Costo de mercancías vendidas', nivel: 'SUBCUENTA', naturaleza: 'DEBITO', parent: '6135', permiteMovimiento: true, clasificacionESF: R, categoriaResultado: CV },

  { codigo: '7', nombre: 'Costos de producción o de operación', nivel: 'CLASE', naturaleza: 'DEBITO', clasificacionESF: R },
  { codigo: '8', nombre: 'Cuentas de orden deudoras', nivel: 'CLASE', naturaleza: 'DEBITO', clasificacionESF: O },
  { codigo: '9', nombre: 'Cuentas de orden acreedoras', nivel: 'CLASE', naturaleza: 'CREDITO', clasificacionESF: O }
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
  COSTO_VENTAS: '613505',
  GASTO_FALTANTE_INVENTARIO: '519595',
  INGRESO_SOBRANTE_INVENTARIO: '429505',
  GASTO_DIRECTO: '519595',
  IMPUESTO_RENTA_GASTO: '540505',
  IMPUESTO_RENTA_POR_PAGAR: '240405',
  UTILIDAD_EJERCICIO: '360505',
  PERDIDA_EJERCICIO: '361005',
  ACTIVO_FIJO_EQUIPO: '152405',
  DEPRECIACION_ACUMULADA: '159215',
  GASTO_DEPRECIACION: '516015'
};

module.exports = {
  PUC_CO_VERSION,
  getPucTemplate,
  getPucVersion,
  ACCOUNTING_MAPPING_CODES
};
