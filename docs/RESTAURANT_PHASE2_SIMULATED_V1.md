# VantixGC Core — Restaurante Fase 2 · Modo Funcional Simulado V1

Estado oficial: **FUNCIONAL — VALIDADO CON IMPRESIÓN SIMULADA (PDF/PANTALLA)**.

Este estado autoriza construir y validar funcionalmente el vertical Restaurante sin esperar disponibilidad de una impresora térmica física. Es una excepción deliberada al gate de inicio definido en `EDGE_FIELD_TEST_GATE_V1.md`; no reemplaza ni aprueba la prueba física.

## Lo que este estado significa

Se pueden desarrollar y probar Mesas, Salón, Menú/Recetas, toma de pedidos, Autopedido QR, Comandas/KDS, cierre de mesa, división de cuenta, propina, caja/turno, roles y notificaciones. Durante esta fase, el destino final de la comanda es un registro de impresión simulada visible/imprimible desde el navegador; el enrutamiento por estación debe comportarse igual que en ESC/POS real.

Este estado **NO significa listo para producción con clientes reales**.

## Gate obligatorio para producción real

`RESTAURANT_PRODUCTION_READY` solo puede ser verdadero cuando los tres puntos siguientes estén cerrados explícitamente:

1. `physicalPrinterFieldPass = true`: sesión física de `EDGE_FIELD_TEST_GATE_V1.md` aprobada con impresora térmica LAN real y desconexión física de Internet.
2. `metaBusinessManagementReviewPass = true`: revisión Meta `business_management` resuelta; no puede permanecer en `0 de 1 llamadas de prueba necesarias`.
3. `dianRealEnabled = true`: habilitación real DIAN/PT completada. Si se adopta formalmente una operación comercial sin DIAN real, la decisión debe quedar registrada por separado y el sistema seguirá mostrando la limitación fiscal correspondiente.

Mientras cualquiera sea falso, el vertical debe mostrar de forma visible `PRODUCCIÓN REAL BLOQUEADA`.

## Alcance funcional de Fase 2

1. Mesas y plano visual configurable con estados Libre, Ocupada, Cuenta pedida y Reservada.
2. Cada apertura de mesa crea una venta `FACTURA_VENTA` en `BORRADOR` y la mesa acumula líneas sobre ese mismo documento.
3. Menú por categorías con vínculo al producto del Core y receta del Motor de Consumo/Producción. Si un ítem vendible no tiene receta, se advierte y se bloquea su envío cuando requiere consumo por receta.
4. Pedido de mesero y Autopedido QR agregan líneas al mismo borrador y crean comandas por estación `COCINA`, `BARRA` o `POSTRES`.
5. Autopedido QR no requiere aprobación previa del mesero.
6. Cierre de mesa usa la emisión transaccional de Ventas del Core: Tesorería/Cartera, AU, Kardex/Consumo y outbox DIAN permanecen dentro de la misma transacción. El Documento Equivalente puede quedar en modo simulado si DIAN real aún no está habilitada.
7. Caja/turno reutiliza `AperturaCierreCaja` y Tesorería del Core; no se crea una caja paralela.
8. Roles Restaurante reutilizan RBAC del Core.
9. `ORDER_READY` reutiliza el Núcleo de Notificaciones, sujeto a activación del tenant, plantilla Meta aprobada y consentimiento.

## Criterios de aceptación del modo simulado

- AC-01: Mesa abierta + pedido con receta + comanda simulada correctamente enrutada por estación.
- AC-02: Autopedido QR entra de inmediato al documento de mesa y a la cola KDS sin aprobación del mesero.
- AC-03: Cierre con división entre dos comensales y propina genera AU balanceado, consume recetas y asocia Documento Equivalente real/simulado según estado DIAN.
- AC-04: Cierre de caja coincide con la suma de mesas cerradas del turno.
- AC-05: Mesero no accede a Configuración/Contabilidad/Reportes; Cocina/Barra solo accede a su cola.
- AC-06: Estado visible `FUNCIONAL — VALIDADO CON IMPRESIÓN SIMULADA` y `PRODUCCIÓN REAL BLOQUEADA` hasta completar los tres gates.

## Evidencia

La automatización de CI puede probar los criterios funcionales anteriores con PostgreSQL real de integración y simulación de comanda. Ninguna prueba automatizada puede cambiar `physicalPrinterFieldPass` a verdadero.
