# VantixGC Notifications Core V1

## Alcance

Núcleo transversal y multitenant para notificaciones de clientes finales. No pertenece a Restaurante: cualquier vertical puede disparar eventos genéricos hacia el mismo motor.

V1 implementa WhatsApp Cloud API como proveedor operativo. El modelo de datos mantiene `channel` y `providerCode` separados para permitir SMS/u otros BSP posteriormente sin cambiar los documentos de negocio.

## Conexión WhatsApp por tenant

La UI vive como quinto bloque dentro de `/app/configuracion-avanzada`.

El tenant solo ve **Conectar mi WhatsApp Business**. No existen campos para pegar access tokens, WABA IDs o Phone Number IDs manualmente.

Variables de plataforma (administradas por VantixGC, no por cada tenant):

- `META_APP_ID`
- `META_APP_SECRET`
- `META_EMBEDDED_SIGNUP_CONFIG_ID`
- `META_GRAPH_VERSION`
- `META_WEBHOOK_VERIFY_TOKEN`
- `NOTIFICATION_CREDENTIALS_SECRET`
- `VANTIXGC_PUBLIC_BASE_URL`

El flujo se declara `embeddedSignupVersion = v4`. El Graph API version se configura por entorno para evitar fijar en código una versión que posteriormente quede obsoleta.

Backend:

1. recibe `code + wabaId + phoneNumberId` del popup oficial;
2. intercambia el código por token mediante Graph API;
3. suscribe la WABA a la app;
4. consulta el número verificado;
5. cifra el token con AES-256-GCM;
6. asocia todo al tenant;
7. la respuesta pública nunca expone token/WABA/Phone Number ID.

Al desconectar se intenta invalidación provider-side y, siempre, se elimina el token local cifrado de ese tenant. Otros tenants no se modifican.

## Cola y estados

`NotificationMessage` es el outbox común. Estados:

- `QUEUED`
- `SENDING`
- `SENT`
- `DELIVERED`
- `READ`
- `FAILED`
- `CANCELLED`

El worker ejecuta reintentos 1m, 5m, 15m, 60m, 180m y luego 720m. Errores definitivos quedan `FAILED` sin `nextRetryAt`.

El webhook `/webhooks/whatsapp` valida `X-Hub-Signature-256` con `META_APP_SECRET` y actualiza entrega/lectura/fallo.

## Plantillas y eventos

Eventos base:

- `ORDER_CONFIRMED`
- `ORDER_READY`
- `RESERVATION_CONFIRMED`
- `ACCOUNT_CLOSED_INVOICE`
- `MARKETING_CAMPAIGN`
- `TRACKING_STATUS_CHANGED`

Todos nacen desactivados. Un evento no puede activarse si su plantilla no está en estado `APPROVED`.

Las plantillas se crean localmente, se envían a Meta mediante `/{WABA_ID}/message_templates` y se sincroniza su estado remoto.

## Consentimiento

La regla de producto es consentimiento previo/expreso/informado para los envíos automáticos que lo requieren. Se registra teléfono, alcance (`TRANSACTIONAL`, `MARKETING`, `ALL`), fuente, evidencia, fecha y actor.

La cola vuelve a comprobar la existencia de consentimiento antes de crear el mensaje. Sin consentimiento el resultado es `CONSENT_REQUIRED` y no se encola nada.

Mensajes inbound con `STOP`, `SALIR`, `BAJA`, `CANCELAR` o `UNSUBSCRIBE` revocan la preferencia y quedan auditados.

Base regulatoria usada para la regla de producto: Ley 1581 de 2012 y conceptos publicados por la Superintendencia de Industria y Comercio sobre autorización previa, expresa e informada. Antes de modificar reglas legales, debe revisarse nuevamente la fuente oficial vigente.

## Documento fiscal por WhatsApp

Notificaciones **no genera un PDF fiscal paralelo**.

Cuando `ACCOUNT_CLOSED_INVOICE` incluye `dianDocumentId`, el motor solo acepta la URL de representación canónica ya almacenada en `DianDocument.providerResponse` (`representationUrl`/equivalente). Si no existe, el envío se bloquea con `NOTIFICATION_DIAN_REPRESENTATION_REQUIRED`.

Así, el documento enviado por WhatsApp es el mismo artefacto fiscal asociado al motor DIAN.

## Magic Link

`TrackingLink` es genérico por `originType + originId`.

- token aleatorio de 32 bytes (`base64url`);
- DB indexa solo SHA-256;
- token recuperable se guarda cifrado para reutilizar exactamente el mismo enlace durante el ciclo;
- vista pública solo muestra referencia, estado y timeline;
- no expone teléfono, costos internos ni otros pedidos;
- al completar, la expiración se ajusta al valor del tenant (30–90 días).

URL pública:

`/seguimiento/:token`

Modificar un token produce 404; un token expirado produce HTTP 410.

## Bot inbound V1

Al llegar un mensaje por webhook:

- un pedido activo asociado al teléfono → responde con el link;
- varios pedidos activos → lista hasta 5 referencias + links;
- ninguno → respuesta humana configurable del tenant;
- STOP/equivalente → baja automática.

No incorpora IA conversacional: es un flujo determinista de búsqueda por teléfono.

## Gate de producción Meta

CI prueba el contrato HTTP completo contra un servidor Meta-compatible local: intercambio de código, suscripción, templates, envío, webhook lógico y revocación.

Esto **no sustituye** una sesión humana real de Embedded Signup con el App/Config ID de producción y OTP de Meta. El criterio de conexión real se marca aprobado únicamente después de completar ese popup contra Meta y enviar/recibir un mensaje real del número del tenant.
