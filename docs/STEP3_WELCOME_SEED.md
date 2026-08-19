# Super Core — Paso 3: Seed de Bienvenida

Al registrar una empresa nueva, el alta del tenant y su configuración inicial se ejecutan dentro de la misma transacción de PostgreSQL.

El seed crea o repara de forma idempotente:

- catálogo PUC base Colombia versionado como `CO-D2650-1993-CORE-V1`;
- mapeos contables universales usados por el motor comercial;
- `Caja General` enlazada a la cuenta de caja;
- cliente genérico con identificación `222222222222`;
- banderas `requiereTercero` para clientes/proveedores;
- subcuentas operativas separadas para IVA generado e IVA descontable dentro del rango permitido de la cuenta 2408.

## Fuente del catálogo Colombia

La estructura de clases, grupos, cuentas y subcuentas mantiene compatibilidad con el Plan Único de Cuentas para comerciantes del Decreto 2650 de 1993. El Super Core añade auxiliares operativos internos únicamente dentro de rangos habilitados para ese propósito y conserva `codigoReferencia` + `versionCatalogo` para trazabilidad.

## Idempotencia

`seedTenantDefaults(tx, tenant)` usa `upsert` por claves únicas del tenant. Puede ejecutarse más de una vez sin duplicar cuentas, mapeos, caja ni cliente genérico.

## Validación automática

`scripts/step3-seed-smoke.js` registra un tenant real contra PostgreSQL 18, verifica el seed, vuelve a ejecutarlo y comprueba que los conteos no cambian.
