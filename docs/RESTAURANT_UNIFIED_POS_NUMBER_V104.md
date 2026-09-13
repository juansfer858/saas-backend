# Restaurant Unified POS Number V104

Objetivo: usar un único consecutivo POS interno por tenant para ventas operativas de Restaurante, sin importar si nacen en mesa/local o en Domicilios.

Regla:
- `REST-TABLE-*` participa en el consecutivo.
- `REST-DELIVERY-*` participa en el mismo consecutivo.
- Otros comprobantes comerciales conservan su numeración actual.
- Documentos históricos `FV-*` no se renumeran.

Ejemplo:
- Mesa: `000004`
- Domicilio: `000005`
- Mesa: `000006`

El consecutivo se asigna al emitir/cerrar la venta dentro de la transacción existente, bajo el mismo advisory lock PostgreSQL usado por POS. No cambia Caja, pagos, Inventario, Tesorería, Contabilidad, DIAN ni contratos Edge.
