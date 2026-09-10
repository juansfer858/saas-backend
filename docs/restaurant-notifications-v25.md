# Restaurante V25 — Notificaciones operativas V2

V25 termina la unión que V65 dejó pendiente entre Firebase Cloud Messaging y los eventos reales del restaurante V2.

## Regla de seguridad

Push es únicamente un aviso. Ningún envío FCM participa en las transacciones de pedidos, comandas, Caja, inventario, contabilidad, impresión o DIAN. Una caída de Firebase no puede revertir ni bloquear la operación.

## Circuitos conectados

- Cliente QR llama al mesero → Push al mesero principal; si no existe, a los meseros activos; Administración conserva visibilidad.
- Cliente QR pide la cuenta → Push al mesero responsable y Administración.
- Cliente QR envía pedido → Push al mesero responsable y Push por estación a Cocina/Barra/Postres.
- Mesero confirma pedido → conserva el Push especializado por estación ya existente en P6.
- Producción termina todas las comandas de un pedido → Push al mesero para entregar.
- Cliente solicita apertura de mesa → Push a Mesero/Administración.

## Superficies

Mesero V2 carga el cliente Push V65 y registra el dispositivo sólo después del permiso explícito del navegador. Producción V2 conserva el mismo cliente. El Service Worker Push mantiene su scope aislado `/app/push-v65/`, separado de los Service Workers PWA de Mesero y Producción.

## Dedupe

Las entregas operativas no repiten un mismo `eventCode + deepLink` ya `SENDING/SENT` para el mismo dispositivo. Los eventos reutilizables de llamado, cuenta y apertura incluyen la instancia temporal del evento en el deep link para permitir un nuevo aviso real posterior sin duplicar el actual.

## Gate de producción

El CI V25 exige que `/api/public/restaurante/push-v65/config` reporte simultáneamente `enabled=true`, `clientConfigured=true` y `serverConfigured=true` antes de considerar Push operativo.
