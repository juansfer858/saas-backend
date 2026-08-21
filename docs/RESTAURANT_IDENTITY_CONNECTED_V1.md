# VantixGC Core — Restaurante Identity Connected V1

## Estado

La identidad visual de Restaurante se conecta al Super Core sin duplicar motores de negocio. Las cinco superficies (Salón, Mesero, KDS, Autopedido QR y Caja) consumen datos reales del tenant y comparten un único tema configurable.

El estado operativo/fiscal del vertical no cambia por este trabajo: sigue siendo **Funcional — validado con impresión simulada (PDF/pantalla)** hasta cerrar los gates de producción documentados.

## Tema como configuración, no como fork

El preset inicial se llama `LA_RIEL_V1`. Sus tokens viven en `restaurant-theme.css` y el valor efectivo del tenant se obtiene desde `RestaurantConfig.themeData` mediante `restaurant-theme.service.js`.

Tokens soportados:

- `char`
- `bone`
- `ember`
- `verdigris`
- `brass`
- `paper`
- `ink`
- `muted`
- `line`
- `success`
- `danger`
- tipografías `display`, `body`, `mono`
- `restaurantName`

`restaurant-theme.js` funciona como ThemeProvider del frontend y transforma la configuración recibida a variables CSS. `restaurant-ui.js` y `restaurant-qr-ui.js` no contienen colores de marca. Cambiar `--ember`, tipografía o nombre desde un solo perfil de tema afecta todas las superficies que vuelvan a cargar el tema.

La fuente HTML histórica `restaurante_identidad_v1.html` no está incluida en este repositorio. Por ello el preset conserva los nombres y concepto La Riel como una capa reemplazable: cuando se disponga del archivo histórico, sus valores exactos pueden copiarse al preset sin modificar la lógica de datos.

## Fuentes de datos reales

### Salón

`GET /api/v1/restaurante/mesas`

La respuesta se decora con la venta BORRADOR activa (`numero`, `estado`, `total`). El frontend hace polling corto y el estado visual deriva del estado real de mesa/documento.

### Mesero

- `GET /api/v1/restaurante/menu`
- `GET /api/v1/restaurante/sesiones/:sessionId/pedido-borrador`
- `PUT /api/v1/restaurante/sesiones/:sessionId/pedido-borrador/items/:menuItemId`
- `POST /api/v1/restaurante/sesiones/:sessionId/pedido-borrador/enviar`

El pedido en curso es persistencia real (`RestaurantOrder.state = BORRADOR`) y sus líneas son simultáneamente líneas reales del `ComprobanteComercial` BORRADOR de la mesa. Al enviar, el pedido pasa a `ENVIADO` y genera las comandas por estación. No se usa un carrito de ejemplo en memoria para el panel del mesero.

### KDS

`GET/PATCH /api/v1/restaurante/comandas`

Polling por defecto: 2 segundos. El servidor sigue imponiendo el scope de estación de Cocina/Barra/Postres. `order.source` distingue `MESERO` y `QR`; el diseño muestra el marcador `📱 vía autopedido QR` solo cuando el origen real es QR. `LISTA` reutiliza el flujo existente y puede encolar `ORDER_READY` si el tenant, la plantilla y el consentimiento lo permiten.

### Autopedido QR

`GET/POST /api/public/restaurante/qr/:token`

El token no adivinable de la mesa resuelve tenant, mesa, sesión, menú y tema. No se acepta un tenantId ni tableId suministrado por el navegador como fuente de identidad.

### Caja

- `GET /api/v1/tesoreria/cajas-bancos`
- `POST /api/v1/restaurante/caja/abrir`
- `GET /api/v1/restaurante/caja/turnos/:id/resumen`
- `POST /api/v1/restaurante/caja/turnos/:id/cerrar`

El resumen conectado discrimina efectivo, medios electrónicos, crédito, propinas y total de operación desde cierres reales del turno. El conteo físico es un input y la diferencia se calcula en cliente contra `systemCashExpected`; el cierre vuelve a validar el saldo en Tesorería del Core.

## Navegación por RBAC

La Riel se construye desde `effectivePermissions` del Core:

- Salón: `MESAS.VER`.
- Mesero: `MESAS.VER + PEDIDOS.CREAR`.
- KDS: `COMANDAS.EDITAR`.
- Caja: `RESTAURANTE.CERRAR + TESORERIA.CERRAR`.
- Tema/Estado: `RESTAURANTE.ADMINISTRAR`.

No existe un segundo mapa de roles de frontend. El backend sigue siendo la autoridad final de cada endpoint.

## Criterios de aceptación automatizados

- ID-AC01: las cinco superficies consumen endpoints/servicios reales del tenant de prueba.
- ID-AC02: un pedido persistido por Mesero genera comanda y es observable inmediatamente; la UI KDS mantiene polling corto.
- ID-AC03: un pedido QR conserva `source = QR` y el KDS lo marca como origen QR.
- ID-AC04: un cambio del tema del tenant se refleja en contexto interno y contexto público QR, compartiendo los mismos tokens.
- ID-AC05: Mesero carece de `COMANDAS.EDITAR` y `TESORERIA.CERRAR`; la composición de La Riel usa permisos efectivos.
- ID-AC06: Caja expone valores reales del turno y calcula diferencia contra `systemCashExpected` antes de cerrar.
