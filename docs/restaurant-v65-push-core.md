# Restaurante V65 — Push Core

V65 inicia el canal Push del Notifications Core sin alterar WhatsApp/SMS ni convertir Push en requisito para la operación.

## Regla operativa

`Evento real → Core/Edge → operación` sigue siendo autoritativo. Push es sólo aviso. Si FCM, el navegador o el permiso de notificaciones fallan, pedidos, comandas, Caja, inventario, contabilidad e impresión continúan sin bloqueo.

## Alcance V65

- Registro multi-tenant de dispositivos Push por usuario, rol y tipo de autorización.
- Tokens FCM cifrados en reposo con AES-256-GCM; la base conserva hash para deduplicación.
- Proveedor Firebase Cloud Messaging HTTP v1 sin dependencia adicional de `firebase-admin`.
- OAuth2 de service account en servidor; credenciales nunca llegan al navegador.
- Cliente Web/PWA con permiso explícito del usuario. Nunca abre el prompt automáticamente.
- Service Worker dedicado a Push con scope aislado `/app/push-v65/`; no reemplaza los Service Workers existentes.
- Primera vinculación automática en Centro de Control, PWA Mesero y tablet de Producción.
- Prueba punta a punta al propio dispositivo: `Push activo → Probar`.
- Deep link de prueba hacia `/app/centro-de-control`.
- QR del cliente queda fuera de V65 y se reserva para la fase V68.

## Configuración requerida en producción

Servidor secreto: `FCM_SERVICE_ACCOUNT_JSON` (JSON o base64 JSON), o `FCM_PROJECT_ID` + `FCM_CLIENT_EMAIL` + `FCM_PRIVATE_KEY`.

Cliente público: `FCM_WEB_API_KEY`, `FCM_WEB_PROJECT_ID`, `FCM_WEB_MESSAGING_SENDER_ID`, `FCM_WEB_APP_ID`, `FCM_WEB_VAPID_KEY`. `FCM_WEB_AUTH_DOMAIN` es opcional.

## Siguiente capa

V66 conectará eventos reales del Restaurante al registro V65: nuevas comandas, productos listos, llamadas de cliente, solicitud de cuenta, habilitación de mesa, pagos y alertas operativas.
