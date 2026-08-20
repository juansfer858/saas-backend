# VantixGC Edge Offline-First Core V1

## Principio

Offline-first se clasifica por operación. No existe una promesa de que todo el ERP funcione igual sin internet.

### LOCAL-FIRST

- Crear y cobrar una venta local en efectivo.
- Consultar catálogo, precios, impuestos e inventario previamente sincronizados.
- Consumir localmente el snapshot de recetas/consumo para reflejar disponibilidad del punto.
- Imprimir ticket/comanda por LAN.
- Consultar ventas recientes del mismo Edge Agent.
- En verticales futuros: abrir/cerrar documentos operativos locales que todavía no exijan validación central.

### CONEXIÓN OBLIGATORIA / DIFERIDA

- Transmisión DIAN/PT. La operación comercial no se bloquea: el Core conserva su outbox/contingencia.
- Configuración PUC, roles, impuestos, precios maestros y parametrización central.
- Consolidación contable/reportes multi-punto.
- Validación estricta de stock compartido entre sucursales.
- Administración de Edge Agents.

Toda capacidad nueva debe declarar una de estas dos clasificaciones antes de implementarse.

## Arquitectura

`Edge Agent` corre en cada local/punto físico. Mantiene una base SQLite embebida. Los payloads de catálogo, ventas y cola se cifran con AES-256-GCM usando `EDGE_LOCAL_ENCRYPTION_KEY`; la metadata operativa mínima de la cola permanece indexable.

El agente se autentica con `EDGE_AGENT_ID` + `EDGE_AGENT_KEY`, credenciales de dispositivo independientes de cualquier login humano. El servidor guarda solamente un HMAC de la clave y permite revocarla por punto.

### Base local

- `snapshots`: catálogo/configuración/recetas sincronizados, payload cifrado.
- `operations`: outbox FIFO local con `PENDING | FAILED | SYNCED`, payload cifrado, intentos/error.
- `local_sales`: historial reciente del punto, payload cifrado.
- `stock_delta`: overlay local sobre el último stock central conocido.

## Reconciliación

1. El agente ordena la cola por `local_timestamp` y la envía en ese orden.
2. Cada operación posee un `operationId` idempotente. El Core guarda `EdgeSyncReceipt` y rechaza colisiones de id con payload diferente.
3. Un fallo puntual queda `FAILED`; las operaciones posteriores se siguen intentando cuando el Core es alcanzable.
4. Las ventas offline se consideran ya realizadas. Durante la reconciliación el contexto Edge permite que el stock central quede negativo en vez de anular una venta cobrada.
5. Si queda stock negativo se crea `NEGATIVE_STOCK` para revisión administrativa.
6. Si precio/IVA/impoconsumo central cambió, la venta conserva el snapshot capturado y se crea `CONFIG_DRIFT`; nunca se recalcula retroactivamente.
7. Al quedar la cola en cero se descarga un snapshot central nuevo y se reinicia el overlay local.

## Superficie central

- Tenant: `/api/v1/edge/agents`, revocación/rotación, `/api/v1/edge/alerts`.
- Dispositivo: `/edge/api/v1/ping`, `/bootstrap`, `/sync/operations`.
- UI tenant: `/app/edge`.

## Edge Agent local

Variables mínimas:

```text
CORE_BASE_URL=https://core.vantixgc.com
EDGE_AGENT_ID=<id provisionado>
EDGE_AGENT_KEY=<clave mostrada una sola vez>
EDGE_LOCAL_ENCRYPTION_KEY=<secreto local >=24 caracteres>
EDGE_PORT=8788
```

Opcionales para ticket RAW/ESC-POS:

```text
EDGE_RECEIPT_PRINTER_HOST=192.168.1.50
EDGE_RECEIPT_PRINTER_PORT=9100
```

La UI local queda en `http://127.0.0.1:8788`. El indicador cambia entre `Conectado` y `Modo offline — N pendientes`.

## Límites V1

- Local-first V1 permite cobro en efectivo. Medios que exigen autorización externa no se simulan offline.
- No se permite modificar configuración central desde el Edge Agent.
- La prueba CI provoca una caída real del socket HTTP central y una posterior reconexión; no sustituye una prueba de campo desconectando físicamente WAN/ISP.
- El spooler LAN reutiliza el motor ESC/POS existente. La validación con impresora física continúa siendo un prerrequisito de producción del vertical Restaurante.
