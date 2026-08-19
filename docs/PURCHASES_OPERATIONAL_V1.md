# VantixGC Core — Compras 100% Operativo V1

## 1. Modelo congelado antes de implementar

Se reutilizan las entidades existentes del Core para no crear contabilidad, cartera ni inventario paralelos:

- `ComprobanteComercial`: encabezado de compra. `tipo=COMPRA`; `numero` es el consecutivo interno; la referencia externa del proveedor es un campo lógico obligatorio del módulo Compras y en V1 se persiste dentro de `observaciones` como metadata estructurada `PURCHASE_META_V1`, evitando una migración de tabla solo para UI. `terceroId` es proveedor obligatorio; `formaPago` y `fechaVencimiento` expresan condición de pago; `estado` usa los estados técnicos existentes `BORRADOR`, `EMITIDO`, `PAGADO_PARCIAL`, `PAGADO_TOTAL`, `ANULADO`.
- `DetalleComprobante`: líneas de producto con cantidad, costo unitario, IVA e importes calculados.
- `MovimientoInventario`: Kardex único. Solo se crea al emitir.
- `Cartera`/`MovimientoCartera`: CxP única. Solo se crea al emitir.
- `AsientoContable`/`DetalleAsiento`: libro único. La emisión usa `accounting.service.createJournalInTx()` con origen `AUTOMATICO` y tipo `AU`.
- `Tercero`: proveedor único y transversal. Se reutilizan `diasPlazo`, `sujetoRetefuente`, `sujetoReteIca`, `sujetoReteIva`.
- `TarifaIVA`/`ConceptoRetencion`: configuración fiscal ya existente.
- `MapeoContable`: parametrización de Inventario, Proveedores, IVA y demás cuentas. Compras nunca hardcodea números de PUC.

La condición de pago se guarda como `formaPago=CREDITO` para el flujo Compras, incluso cuando el plazo es `CONTADO`, porque el diseño exige que toda compra emitida aparezca primero en CxP y se marque pagada únicamente cuando Tesorería le aplique el pago. `fechaVencimiento` se calcula con 0/30/60 días. Así se conserva una sola fuente de saldo y no se necesita seleccionar caja/banco en la captura de Compras.

### Estado funcional mostrado en UI
- `BORRADOR` → Borrador.
- `EMITIDO` → Emitida.
- `PAGADO_PARCIAL` → Emitida · parcialmente pagada.
- `PAGADO_TOTAL` → Pagada.
- `ANULADO` → Anulada.

No se agrega un enum nuevo únicamente por semántica visual.

## 2. Reglas

1. Borrador no genera Kardex, CxP ni asiento.
2. Emisión ocurre dentro de una sola transacción Prisma. Si falla Kardex, Cartera, impuestos, periodo o contabilidad, todo hace rollback.
3. Periodo cerrado se valida a través del núcleo contable; el error público es `El periodo contable de esta fecha está cerrado.`
4. Compra emitida es inmutable.
5. Compra con pagos aplicados no puede anularse. Primero deben reversarse los pagos desde Tesorería.
6. Compra emitida sin pagos se anula por reversión: Nota Débito de trazabilidad + reverso de asiento + reverso Kardex + cancelación CxP.
7. El documento guarda vínculo bidireccional mediante `AsientoContable.comprobanteId`.
8. El método de costeo operativo actual sigue siendo Promedio Ponderado. PEPS no se simula sin capas de costo.
9. `referenciaExterna` se valida como obligatoria en la API especializada de Compras y se expone como propiedad normal al frontend aunque su almacenamiento V1 sea metadata estructurada del encabezado.

## 3. API especializada reutilizando el motor comercial

- `GET/POST /api/v1/comercial/compras`
- `GET/PATCH /api/v1/comercial/compras/:id`
- `POST /api/v1/comercial/compras/:id/emitir`
- `POST /api/v1/comercial/compras/:id/anular`
- `GET /api/v1/terceros?tipo=PROVEEDOR`
- `GET/POST /api/v1/inventario/productos`
- `GET /api/v1/contabilidad/impuestos/iva`
- `POST /api/v1/contabilidad/impuestos/calcular`

La capa `purchase.service` adapta datos de Compras al motor `commercial.service`; no escribe directamente en contabilidad, Kardex ni Cartera.

## 4. Pantalla dedicada

`/app/compras` deja de usar la tabla genérica del panel y se sirve con `src/web/purchases.html`.

Incluye listado con filtros, detalle, edición solo de borrador, emisión, anulación condicionada a ausencia de pagos, enlace al asiento AU y formulario de compra con creación rápida de producto.

## 5. Pruebas de aceptación

El smoke dedicado debe comprobar:
1. creación real desde API/UI contract;
2. borrador sin efectos;
3. emisión atómica con AU cuadrado + Kardex + CxP;
4. anulación sin pagos revierte los tres efectos;
5. anulación con pagos queda bloqueada;
6. periodo cerrado bloquea emisión y no deja efectos parciales.
