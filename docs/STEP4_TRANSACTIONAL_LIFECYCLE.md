# Super Core — Paso 4: API REST y Ciclo Transaccional

El Super Core aplica un patrón único para Ventas, Compras, Inventario, Tesorería y Cartera. Todo dato empresarial se resuelve bajo `tenantId` obtenido del subdominio + JWT.

## Estados documentales

- `BORRADOR`: editable, sin contabilidad, sin Kardex y sin cartera.
- `EMITIDO`: documento oficial; genera efectos atómicos de inventario, tesorería/cartera y contabilidad.
- `PAGADO_PARCIAL`: documento a crédito con abonos y saldo pendiente.
- `PAGADO_TOTAL`: documento a crédito completamente cancelado.
- `ANULADO`: documento original inmutable; el Core genera documento de ajuste, contra-asiento, reverso de Kardex y reverso de caja/cartera.
- `CONFIRMADO`: valor legado conservado temporalmente para compatibilidad de datos anteriores; el motor lo trata como documento emitido.

## Ventas

Base: `/api/v1/comercial/ventas`

- `POST /ventas`: crea `BORRADOR` o `EMITIDO`.
- `GET /ventas`: filtros `desde`, `hasta`, `terceroId`, `estado`, `montoMin`, `montoMax`, `page`, `pageSize`.
- `GET /ventas/:id`.
- `PATCH|PUT /ventas/:id`: solo `BORRADOR`.
- `POST /ventas/:id/emitir`.
- `POST /ventas/:id/anular`.
- `POST /ventas/:id/reemplazar`: para corregir un documento emitido sin editar historia; anula/reversa el original y emite una nueva versión dentro de una transacción.

## Compras

Mismo ciclo en `/api/v1/comercial/compras`.

## Pagos y abonos

Endpoint principal: `POST /api/v1/pagos`.

Payload:

```json
{
  "documentoId": "uuid",
  "monto": 100000,
  "metodoPago": "EFECTIVO | TRANSFERENCIA | TARJETA",
  "cajaBancoId": "uuid",
  "referencia": "opcional",
  "sourceId": "opcional-idempotencia"
}
```

El pago ejecuta atómicamente:

1. valida documento y cartera del mismo tenant;
2. reduce CxC/CxP;
3. actualiza el estado `PAGADO_PARCIAL` / `PAGADO_TOTAL`;
4. mueve Caja/Banco y registra `MovimientoTesoreria`;
5. registra `MovimientoCartera`;
6. crea Recibo de Caja o Comprobante de Egreso;
7. crea asiento PUC balanceado Cliente/Proveedor vs Caja/Banco;
8. persiste `Pago` con `sourceId` opcional para idempotencia.

También disponible bajo `/api/v1/tesoreria/pagos`.

## Anulación y corrección

Los documentos emitidos no se modifican físicamente. `anular` crea:

- `NOTA_CREDITO` para una factura de venta;
- `NOTA_DEBITO` de auditoría para una compra;
- contra-asiento ligado al asiento original;
- movimientos inversos de Kardex;
- movimientos de ajuste en caja/bancos;
- reverso de pagos existentes;
- anulación de cartera pendiente.

`reemplazar` combina la anulación completa con la emisión de una nueva versión, preservando trazabilidad mediante `documentoOrigenId`.

## Inventario

`/api/v1/inventario/productos` soporta POST, GET, PATCH/PUT y DELETE lógico (`activo=false`). El Kardex es inmutable y los reversos se registran como movimientos de devolución.

## Terceros y Tesorería

Terceros y Caja/Banco usan DELETE lógico para no romper referencias históricas.

## Validación automática

`scripts/step4-lifecycle-smoke.js` prueba contra PostgreSQL 18:

- borrador sin efectos;
- edición de borrador;
- emisión con efectos atómicos;
- bloqueo de edición emitida;
- pago parcial y total;
- asientos de pago;
- anulación de documento pagado;
- reverso de venta contado;
- reverso de Kardex;
- reemplazo/re-asiento automático;
- filtros y paginación.
