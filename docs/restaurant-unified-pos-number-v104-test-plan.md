# V104 test plan

1. Confirmar el último consecutivo POS numérico del tenant.
2. Cerrar una venta de mesa y verificar que recibe el siguiente número.
3. Emitir/cobrar un domicilio nuevo y verificar que recibe exactamente el número siguiente al de la mesa.
4. Cerrar otra venta de mesa y verificar continuidad sin saltos por canal.
5. Verificar que documentos históricos `FV-*` permanecen sin cambios.
6. Verificar que Caja, Inventario, Tesorería y Contabilidad conservan una sola operación por venta.
