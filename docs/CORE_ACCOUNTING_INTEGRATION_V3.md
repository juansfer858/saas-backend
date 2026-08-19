# VantixGC Core — Integración Contable Transversal V3

Estado: **MAPPING FREEZE**. Este documento se crea antes de modificar servicios de negocio y fija el contrato contable que deben consumir Ventas, Compras, Inventarios/Kardex, Tesorería, Cartera y Terceros.

## 1. Principios no negociables

1. Ningún módulo escribe directamente `AsientoContable` ni `DetalleAsiento`; todo asiento se crea por `accountingService.createJournalInTx()` y toda anulación por `accountingService.reverseJournalInTx()`.
2. Los asientos automáticos usan tipo de comprobante `AU` y `origen=AUTOMATICO`; reversos usan `RV`.
3. Toda operación que impacta contabilidad, Kardex, Tesorería/Cartera y documento comercial se ejecuta dentro de una única transacción Prisma.
4. `PeriodoContable=CERRADO` bloquea el evento completo antes de producir efectos laterales.
5. `Tercero` es un único maestro por tenant. Ventas, Compras, Tesorería, Cartera y Contabilidad referencian `Tercero.id`; no se crea una tabla paralela.
6. Todo documento contable conserva `comprobanteId`, `sourceId`, `referencia` y el número del documento origen para navegación y trazabilidad bidireccional.
7. Ningún número de cuenta PUC se hardcodea dentro de los módulos. Los módulos resuelven las claves de `MapeoContable`; las únicas referencias numéricas pertenecen al seed inicial y pueden ser sustituidas por el administrador.
8. Si una clave requerida no está configurada, el evento de negocio se rechaza con `ACCOUNTING_MAPPING_REQUIRED` y un mensaje funcional que indique qué parametrización falta.

## 2. Modelo de datos acordado

### 2.1 MapeoContable — catálogo de parámetros contables

Se reutiliza la entidad existente `MapeoContable(tenantId, clave, cuentaId)`. Se convierte formalmente en el contrato de parametrización de integración.

Claves congeladas:

| Clave | Uso | Seed sugerido |
|---|---|---|
| `CAJA_GENERAL` | caja por defecto | 110505 |
| `BANCO_GENERAL` | banco por defecto cuando CajaBanco no tiene cuenta propia | 111005 |
| `CLIENTES` | cuentas por cobrar | 130505 |
| `PROVEEDORES` | cuentas por pagar | 220505 |
| `INVENTARIO` | mercancías | 143505 |
| `COSTO_VENTAS` | costo de mercancía vendida | 613505 |
| `VENTAS` | ingreso ventas | 413505 |
| `IMPUESTO_VENTA` | IVA generado | 240801 |
| `IMPUESTO_COMPRA` | IVA descontable | 240802 |
| `RETENCION_FUENTE_PAGAR` | retefuente practicada en compras | 236540 |
| `RETENCION_FUENTE_FAVOR` | retefuente practicada por clientes | 135515 |
| `RETENCION_IVA_PAGAR` | reteIVA practicada | 236705 |
| `RETENCION_IVA_FAVOR` | reteIVA a favor | 135517 |
| `RETENCION_ICA_PAGAR` | reteICA practicada | 236805 |
| `RETENCION_ICA_FAVOR` | reteICA a favor | 135518 |
| `GASTO_COMPRA` | compra no inventariable / gasto genérico | 519595 |
| `GASTO_FALTANTE_INVENTARIO` | faltantes/mermas | 519595 |
| `INGRESO_SOBRANTE_INVENTARIO` | sobrantes de inventario | 429505 |
| `ANTICIPOS_OTROS` | anticipos y otros eventos configurables | 135595 |

Las claves fiscales existentes y de cierre se mantienen.

### 2.2 CajaBanco

Se conserva `CajaBanco.cuentaContableId` como override obligatorio/recomendado por cuenta bancaria real. Resolución:

1. si `CajaBanco.cuentaContableId` está asignada y activa, se usa esa cuenta;
2. en caso contrario, `CAJA_GENERAL` o `BANCO_GENERAL` según el tipo;
3. la UI de Configuración debe permitir vincular cada Caja/Banco con una cuenta PUC de movimiento.

### 2.3 ConfiguracionContable

Se amplía con:

- `metodoCosteo`: `PROMEDIO_PONDERADO | PEPS`.
- `exigirTerceroVentas`: boolean, default true.
- `exigirTerceroCompras`: boolean, default true.

El método inicial de todos los tenants existentes es `PROMEDIO_PONDERADO`, preservando el comportamiento actual.

### 2.4 Producto

Overrides contables opcionales por producto:

- `cuentaIngresoId`
- `cuentaInventarioId`
- `cuentaCostoVentaId`
- `cuentaCompraGastoId`

Regla: override de producto > `MapeoContable` global. Esto permite separar ingresos/costos por línea sin crear catálogos paralelos.

### 2.5 PEPS / capas de inventario

Nueva entidad `CapaInventario`:

- tenantId
- productoId
- movimientoEntradaId
- cantidadOriginal
- cantidadDisponible
- costoUnitario
- creadoEn

Entradas inventariables crean capa. Salidas con `PEPS` consumen capas más antiguas. El costo consumido se registra congelado en el movimiento de Kardex. El campo `Producto.costoPromedio` se mantiene como dato informativo/compatibilidad y se recalcula como valor promedio del stock remanente.

Nueva entidad `ConsumoCapaInventario` para trazabilidad de cada salida PEPS:

- tenantId
- movimientoSalidaId
- capaId
- cantidad
- costoUnitario
- costoTotal

### 2.6 Ajustes manuales de inventario

Nueva entidad `AjusteInventario`:

- tenantId
- productoId
- movimientoId
- asientoId
- tipo `FALTANTE | SOBRANTE | MERMA`
- cantidad
- costoUnitario
- valor
- justificacion obligatoria
- soporteNombre/soporteMime/soporteDatos opcional para SOBRANTE, obligatorio para FALTANTE/MERMA
- creadoPorId
- creadoEn

El asiento se genera por el servicio contable central.

### 2.7 Tercero

Se mantienen los campos actuales y se formalizan:

- `cupoCredito`
- `diasPlazo`
- banderas fiscales existentes

Se agrega:

- `condicionPagoDefault`: `CONTADO | CREDITO_30 | CREDITO_60 | PERSONALIZADO`
- `vendedorAsignadoId` opcional → `User.id` del mismo tenant.
- `responsableRetener` boolean para ventas sujetas a retención a favor.

### 2.8 Aplicación de pagos a múltiples documentos

`Pago` existente representa la cabecera financiera. Para un recaudo/pago que cruza varias facturas se agrega `AplicacionPago`:

- tenantId
- pagoId
- carteraId
- documentoId
- monto
- creadoEn

Un solo recibo/egreso y un solo asiento AU pueden aplicar a N cuentas de cartera, todas del mismo tercero y naturaleza CxC/CxP.

## 3. Mapeo congelado de eventos

### 3.1 Venta a crédito

Asiento AU:

- Débito `CLIENTES` por neto de cartera.
- Débito retenciones a favor configuradas, si aplican.
- Crédito `VENTAS`/override por producto por base gravable.
- Crédito `IMPUESTO_VENTA` por IVA generado.
- Crédito otros impuestos configurados si aplican.
- Débito `COSTO_VENTAS`/override por producto.
- Crédito `INVENTARIO`/override por producto.

Tercero obligatorio en todas las líneas de Clientes/retenciones y en las líneas que la cuenta exija tercero.

### 3.2 Compra a crédito

Asiento AU:

- Débito `INVENTARIO`/override por mercancía inventariable.
- Débito `GASTO_COMPRA`/override para servicios/no inventariable.
- Débito `IMPUESTO_COMPRA` por IVA descontable.
- Crédito retenciones por pagar configuradas.
- Crédito `PROVEEDORES` por neto después de retenciones.

### 3.3 Recaudo de cliente

- Débito Caja/Banco real.
- Crédito `CLIENTES` por total aplicado.
- Aplicaciones a una o varias CxC.

### 3.4 Pago a proveedor

- Débito `PROVEEDORES` por total aplicado.
- Crédito Caja/Banco real.
- Aplicaciones a una o varias CxP.

### 3.5 Transferencia propia

- Débito cuenta PUC destino.
- Crédito cuenta PUC origen.
- Dos movimientos de Tesorería enlazados a una misma referencia; no Cartera.

### 3.6 Gasto directo de Tesorería

- Débito cuenta de gasto seleccionada del PUC.
- Crédito Caja/Banco real.
- tercero opcional solo si la cuenta exige tercero o el gasto se registra a nombre de un tercero.

### 3.7 Ajuste de inventario

FALTANTE/MERMA:

- Débito `GASTO_FALTANTE_INVENTARIO`.
- Crédito `INVENTARIO`.

SOBRANTE:

- Débito `INVENTARIO`.
- Crédito `INGRESO_SOBRANTE_INVENTARIO`.

### 3.8 Conciliación bancaria

No genera asiento. Solo enlaza partidas del extracto con `MovimientoTesoreria` ya contabilizados.

## 4. Cartera como vista, no libro paralelo

`Cartera` sigue siendo índice operacional por documento para vencimiento, estado y saldo; el detalle financiero mostrado al usuario se reconcilia contra `DetalleAsiento` de `CLIENTES`/`PROVEEDORES`. No se crea una segunda contabilidad. Los reportes de antigüedad usan `Cartera.saldo` y `fechaVencimiento`, y el detalle enlaza al asiento/documento origen.

Buckets de antigüedad: `CORRIENTE`, `1_30`, `31_60`, `61_90`, `MAS_90`.

## 5. Prevalidación de evento

Antes de mutar negocio, el servicio de integración debe validar dentro de la misma transacción:

1. periodo abierto;
2. tercero válido/obligatorio;
3. todas las claves contables requeridas por el documento;
4. Caja/Banco y su cuenta PUC cuando aplique;
5. stock disponible para salidas;
6. reglas fiscales activas;
7. partida doble final.

Si cualquier validación falla, la transacción completa hace rollback.

## 6. Contrato de trazabilidad

Cada respuesta de documento debe incluir, cuando exista:

- `asiento.id`
- `asiento.numeroComprobante` (AU/RV)
- `asiento.estado`
- `documento.id`
- `documento.numero`

La UI debe mostrar enlaces cruzados Documento ↔ Asiento.

## 7. Criterio de aceptación E2E congelado

El smoke de integración ejecutará en PostgreSQL 18:

1. proveedor;
2. compra a crédito + IVA → Kardex + AU + CxP;
3. pago parcial desde Banco → AU + saldo CxP;
4. cliente;
5. venta a crédito → AU de venta/costo + Kardex + CxC;
6. recaudo → AU + CxC=0;
7. conciliación matemática entre stock, cartera, Mayor/Balance/P&G/ESF;
8. cierre del periodo y rechazo de nueva venta fechada en el periodo cerrado sin ningún efecto lateral.

Adicionales:

- transferencia Caja→Banco;
- gasto directo;
- faltante/sobrante de inventario;
- aplicación de un pago a múltiples facturas;
- reversión de compra y venta sin huérfanos;
- todas las claves configurables desde UI.

Este documento es el contrato previo a implementación de V3.