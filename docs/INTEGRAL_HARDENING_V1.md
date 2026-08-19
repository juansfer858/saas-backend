# Super Core — Pruebas Integrales de Endurecimiento V1

Esta fase valida invariantes de producción que deben cumplirse además del flujo funcional normal.

## Matriz automática

`scripts/integral-hardening-smoke.js` valida sobre PostgreSQL 18:

1. **Aislamiento cross-tenant por IDs**: un tenant no puede consultar ni usar productos/documentos de otro.
2. **Rollback por stock insuficiente**: una venta que falla no deja documento, Kardex, cartera ni asiento parcial.
3. **Rollback por periodo cerrado**: la emisión falla y devuelve todo al estado previo; el borrador y el stock quedan intactos.
4. **Idempotencia documental**: repetir un `sourceId` no duplica documento ni stock.
5. **Idempotencia de pagos**: repetir un `sourceId` no duplica caja, cartera ni asiento.
6. **Sobrepago**: un abono superior al saldo es rechazado sin efectos laterales.
7. **Pago cross-tenant**: un tenant no puede abonar documentos de otro tenant.
8. **Anulación idempotente**: repetir una anulación no duplica contra-asientos, Kardex ni movimientos monetarios.

## Criterio de salida

El Super Core solo se considera listo para ampliar la matriz 360 cuando pasan en la misma ejecución de CI:

- validación/generación Prisma;
- sincronización PostgreSQL 18;
- smoke base;
- seed de bienvenida;
- ciclo transaccional completo;
- matriz integral de endurecimiento.
