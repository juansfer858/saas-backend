# Edge Offline-First V1 — cierre de pendientes antes de Restaurante Fase 2

Estado de arquitectura: esta fase NO crea Mesas, Comandas ni KDS. Cierra bordes del Edge Offline-First Core V1.

## Política de cobro offline por tenant

El tenant elige una política explícita que viaja en el snapshot del Edge Agent:

- `CASH_ONLY` (default): al perder conexión solo se permite efectivo. Tarjeta/QR quedan visibles como no disponibles y la UI muestra `Sin conexión: solo se aceptan pagos en efectivo`.
- `MANUAL_EXTERNAL_PENDING`: permite registrar que el cliente pagó mediante un datáfono/QR externo independiente. El Edge no simula autorización bancaria. Al sincronizar, el Core emite la venta como crédito/CxC pendiente y la conciliación/confirmación del pago se realiza después desde Tesorería.
- `PAUSE_SALES`: si el Edge está offline no permite registrar nuevas ventas y muestra el motivo de forma explícita.

La política es configuración central; el punto local solo consume la última versión sincronizada. No puede cambiarla offline.

## CONFIG_DRIFT / NEGATIVE_STOCK

Las alertas Edge comparten una sola bandeja administrativa (`/app/edge`). Una alerta puede pasar de `OPEN` a `ACKNOWLEDGED` mediante la acción `Revisada, sin acción`. La revisión registra usuario y fecha en la alerta y además escribe en `RbacAudit` con acción `EDGE_ALERT_ACKNOWLEDGED`.

Una diferencia que requiera compensación no se ajusta automáticamente. La bandeja ofrece acceso a Contabilidad para que un administrador genere el comprobante manual/reverso que corresponda, conservando inmutable la venta ya emitida.

## Prueba física de campo

CI no puede reemplazar la evidencia de campo. Para cerrar producción se requiere:

1. Instalar `edge/agent` en un PC real del establecimiento.
2. Configurar una impresora térmica LAN real por IP fija o reserva DHCP, TCP/9100.
3. Sincronizar catálogo una vez con Internet disponible.
4. Cortar físicamente WiFi/cable WAN del dispositivo.
5. Registrar una venta y verificar ticket físico.
6. Reconectar y verificar que pendientes vuelvan a cero y la venta aparezca en el Core con AU/Kardex/Tesorería/Cartera/outbox DIAN.
7. Repetir con red degradada/intermitente y, si es posible, una segunda marca de impresora.
8. Guardar video/captura y exportar `/api/field-evidence` del Edge Agent.

Hasta obtener esa evidencia, el criterio físico sigue marcado como PENDIENTE y Restaurante Fase 2 no debe declararse listo para producción.
