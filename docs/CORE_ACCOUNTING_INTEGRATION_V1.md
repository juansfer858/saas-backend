# VantixGC Core — Integración Contable de Todos los Módulos V1

## 1. Objetivo
Congelar el contrato contable transversal antes de modificar lógica de negocio. Ningún módulo escribe directamente en AsientoContable/DetalleAsiento. Todos los efectos contables pasan por `accounting.service.createJournalInTx()` y toda reversión por `reverseJournalInTx()`.

## 2. Modelo de datos acordado

### 2.1 Entidades existentes reutilizadas
- `CuentaPUC`: catálogo jerárquico del tenant y única fuente de cuentas contables.
- `MapeoContable(tenantId, clave, cuentaId)`: parametrización de eventos de negocio a cuentas PUC. Se conserva como tabla central para evitar hardcodes.
- `ConfiguracionContable`: configuración financiera general del tenant.
- `TipoComprobanteContable` + `ConsecutivoContable`: numeración, incluido `AU` para automatismos.
- `AsientoContable` + `DetalleAsiento`: libro contable único.
- `ComprobanteComercial` + `DetalleComprobante`: documentos de Ventas/Compras/Tesorería.
- `MovimientoInventario`: Kardex único.
- `Cartera` + `MovimientoCartera`: saldos CxC/CxP derivados de documentos comerciales.
- `CajaBanco` + `MovimientoTesoreria`: tesorería y bancos.
- `Tercero`: maestro transversal único.

### 2.2 Claves de MapeoContable congeladas
Obligatorias/esperadas según evento:
- `CAJA_GENERAL`
- `BANCO_GENERAL` (fallback; cada CajaBanco puede apuntar a su propia `cuentaContableId`)
- `CLIENTES`
- `PROVEEDORES`
- `INVENTARIO`
- `COSTO_VENTAS`
- `VENTAS`
- `IMPUESTO_VENTA`
- `IMPUESTO_COMPRA`
- `RETEFUENTE_PAGAR`
- `RETEFUENTE_FAVOR`
- `GASTO_COMPRA`
- `GASTO_FALTANTE_INVENTARIO`
- `INGRESO_SOBRANTE_INVENTARIO`
- `GASTO_DIRECTO`

No se permiten números de cuenta en lógica de módulos. El seed puede proponer defaults, pero la ejecución siempre resuelve por mapeo del tenant.

### 2.3 Extensiones propuestas
`ConfiguracionContable`:
- `metodoCosteoInventario`: V1 = `PROMEDIO_PONDERADO`. Se reserva `PEPS` para una fase posterior que requiera capas de inventario.

`Tercero`:
- `cupoCredito` (existente)
- `diasPlazo` (existente; representa condición por defecto 0/30/60/etc.)
- `vendedorAsignadoId` opcional hacia `User`.

`MovimientoInventario` para ajustes manuales:
- `justificacion` opcional en movimientos normales, obligatoria para `AJUSTE_ENTRADA`, `AJUSTE_SALIDA`, `MERMA`.
- `asientoId` opcional para trazabilidad directa del ajuste contable generado.

No se crea una tabla paralela para Cartera ni para Libro Mayor.

## 3. Contrato por módulo

### Ventas
Al emitir FACTURA_VENTA:
1. valida periodo abierto;
2. tercero cliente obligatorio para venta a crédito;
3. Kardex descuenta existencias y devuelve costo con método configurado;
4. asiento AU: DR Clientes/Caja/Banco, CR Ventas, CR IVA generado; adicional DR Costo ventas, CR Inventario;
5. `AsientoContable.comprobanteId` enlaza documento origen.

Anulación usa reversión contable y reversión del Kardex/Tesorería/Cartera en la misma transacción.

### Compras
Al emitir COMPRA:
1. proveedor obligatorio;
2. Kardex incrementa cantidad y costo;
3. asiento AU: DR Inventario/Gasto + IVA descontable, CR Proveedores/Caja/Banco; retenciones reducen el neto al proveedor y acreditan la cuenta correspondiente;
4. trazabilidad por `comprobanteId`.

### Inventarios/Kardex
Compras/Ventas normales no generan segundo asiento.
Ajustes manuales sí generan AU:
- faltante/merma: DR gasto faltante, CR inventario;
- sobrante: DR inventario, CR ingreso sobrante.
Justificación obligatoria.

### Tesorería & Bancos
- recaudo CxC: DR Caja/Banco, CR Clientes;
- pago CxP: DR Proveedores, CR Caja/Banco;
- transferencia propia: DR destino, CR origen;
- gasto directo: DR cuenta gasto parametrizada/seleccionada, CR Caja/Banco;
- conciliación no genera asiento.
Todo registro usa AU y valida periodo.

### Cartera
Vista derivada de `Cartera`, `MovimientoCartera`, `ComprobanteComercial` y asientos relacionados. Incluye antigüedad 0-30, 31-60, 61-90 y +90. No duplica saldos.

### Terceros
Única tabla `Tercero`. Ventas, Compras, Tesorería, Cartera y Contabilidad consumen el mismo servicio/API.

## 4. Reglas de integridad
1. `createJournalInTx` es la única puerta de contabilización automática.
2. Todo asiento automático usa origen `AUTOMATICO` y tipo `AU`.
3. Si falta un mapeo, la operación se bloquea con error `ACCOUNTING_MAPPING_MISSING`; el mensaje al usuario debe indicar qué parámetro falta configurar.
4. `resolveOpenPeriod` se ejecuta antes de persistir efectos definitivos de negocio que impliquen asiento.
5. Cualquier documento anulado revierte, nunca edita, el asiento original.
6. Tercero obligatorio donde exista CxC/CxP.
7. Toda operación multi-módulo es una única transacción Prisma.

## 5. API de parametrización
- `GET /api/v1/contabilidad/mapeos`: lista claves, cuenta asignada y estado de preparación.
- `PUT /api/v1/contabilidad/mapeos/:clave`: asigna una cuenta PUC de movimiento del mismo tenant.
- `GET /api/v1/contabilidad/integracion/estado`: readiness por módulo y mapeos faltantes.

## 6. Prueba E2E obligatoria
Proveedor → compra crédito → pago parcial → cliente → venta crédito → recaudo → conciliación de saldos con Kardex/Cartera/Contabilidad → cierre → bloqueo de documento retroactivo.

El smoke debe comprobar matemáticamente partida doble y enlaces documento↔asiento en cada paso.
