# Restaurant Orders Admin Unsent V79

V79 permite que Centro de control → Pedidos retire una línea creada por un mesero únicamente mientras el pedido padre siga en estado `BORRADOR` y con origen `MESERO`.

Reglas congeladas:

- La eliminación se identifica por `itemId`, no por el usuario que creó el borrador.
- La línea debe pertenecer al tenant, a la sesión de mesa indicada y a la venta BORRADOR activa.
- Se elimina la línea de pedido y su `DetalleComprobante` asociado dentro de una misma transacción.
- Se recalculan por decremento los totales del pedido y de la venta.
- Una línea cuyo pedido ya fue enviado no puede retirarse por este endpoint y responde `RESTAURANT_DRAFT_ITEM_ALREADY_SENT`.
- V79 no envía pedidos, no crea comandos KDS, no modifica inventario, Caja, Tesorería, Cartera, Contabilidad, QR ni Edge.
- El borrador vacío puede permanecer como registro técnico; como no contiene líneas, no cumple la condición que bloquea el cierre por `RESTAURANT_UNSENT_DRAFT_ORDER`.
