# Compras Operativas — contrato de pantalla/API

- Pantalla: `/app/compras`
- Listar/filtrar: `GET /api/v1/comercial/compras?proveedorId=&estado=&desde=&hasta=`
- Crear borrador: `POST /api/v1/comercial/compras`
- Editar borrador: `PATCH /api/v1/comercial/compras/:id`
- Emitir: `POST /api/v1/comercial/compras/:id/emitir`
- Anular: `POST /api/v1/comercial/compras/:id/anular`
- Proveedores: `GET /api/v1/terceros`
- Productos: `GET/POST /api/v1/inventario/productos`
- Tarifas IVA: `GET /api/v1/contabilidad/impuestos/iva`
- Previsualización fiscal: `POST /api/v1/contabilidad/impuestos/calcular`
- Asiento generado: `GET /api/v1/contabilidad/asientos/:id`

Los estados técnicos del Core se presentan como Borrador, Emitida, Parcialmente pagada, Pagada y Anulada sin duplicar el modelo de estado.
