# Super Core — Paso 1: Base de Datos V2

Este paso consolida el esquema universal ERP/SaaS sobre PostgreSQL + Prisma y mantiene `tenantId` como eje obligatorio de aislamiento lógico.

## Cobertura del esquema

1. **Auth / Multitenancy**: `Tenant`, `User` y restricciones únicas por tenant.
2. **Terceros**: `Tercero` para clientes, proveedores, empleados y relaciones mixtas.
3. **Inventario / Kardex**: `Producto`, `MovimientoInventario`, stock y costo promedio.
4. **Tesorería / Cartera**: `CajaBanco`, `AperturaCierreCaja`, `MovimientoTesoreria`, `Cartera`, `MovimientoCartera`.
5. **Transacciones**: `ComprobanteComercial`, `DetalleComprobante`, formas de pago, estados y `sourceId` para idempotencia por tenant.
6. **Contabilidad PUC**: `CuentaPUC`, `MapeoContable`, `PeriodoContable`, `AsientoContable`, `DetalleAsiento`, reversos y origen manual/automático.

## Endurecimiento incorporado

- Índices y claves únicas compuestas con `tenantId` en entidades empresariales.
- Historial explícito de movimientos de tesorería y cartera.
- Periodos contables con estado `ABIERTO` / `CERRADO`.
- `sourceId` por tenant para prevenir duplicación de transacciones/asientos provenientes de integraciones o reintentos.
- Cuentas PUC con `requiereTercero` y `versionCatalogo` para soportar catálogos versionados por país.
- Reversos de asientos modelados sin borrar historia contable.

## Sincronización

El proyecto ejecuta `npx prisma db push` en el script de arranque y el CI levanta PostgreSQL 18, ejecuta `db push` y corre el smoke test integral antes de integrar cambios a `main`.

## Regla de arquitectura

Ningún módulo vertical debe introducir lógica de restaurante, taller, veterinaria u otro nicho dentro del Super Core. Los verticales consumirán este núcleo mediante módulos desacoplados.
