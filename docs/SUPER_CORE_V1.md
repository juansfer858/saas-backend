# VantixGC Super Core V1

Core universal SaaS multitenant para Auth, Terceros, Inventario, Tesoreria, Motor Comercial y Contabilidad PUC.

## Invariantes

- Todo dato empresarial lleva `tenantId`.
- El tenant se resuelve por subdominio y el JWT debe pertenecer al mismo tenant.
- Facturas de venta y compras se procesan dentro de una unica transaccion PostgreSQL.
- Una factura/compra confirmada genera Kardex, Tesoreria/Cartera y Asiento Contable.
- Todo asiento debe cumplir partida doble antes de persistirse.
- El alta de tenant precarga PUC operativo, Caja General y Cliente Mayoría / Cuantías Incompletas.

## Rutas base

- `/api/v1/auth`
- `/api/v1/usuarios`
- `/api/v1/terceros`
- `/api/v1/inventario`
- `/api/v1/tesoreria`
- `/api/v1/comercial`
- `/api/v1/contabilidad`
- `/status`
