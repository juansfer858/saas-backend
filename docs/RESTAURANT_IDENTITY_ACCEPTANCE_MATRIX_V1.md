# Restaurante Identity Connected V1 — Matriz de aceptación

| Criterio | Evidencia automatizada |
|---|---|
| 1. Cinco pantallas con datos reales | `restaurant-identity-connected-smoke.js` crea tenant, mesa, venta BORRADOR, menú/receta, KDS, QR y turno reales en PostgreSQL. |
| 2. Mesero → KDS sin recargar | El smoke persiste el pedido de mesero, lo envía y consulta la cola inmediatamente; `restaurant-ui.js` ejecuta polling KDS cada 2 s. |
| 3. QR marcado como QR | El smoke confirma `RestaurantOrder.source = QR`; el UI renderiza `📱 vía autopedido QR` únicamente con ese valor real. |
| 4. Tema único para 5 pantallas | El smoke modifica `ember`, tipografía y nombre en `RestaurantConfig`; contexto interno y QR público reciben el mismo tema. |
| 5. Mesero sin KDS/Caja | El smoke valida permisos efectivos; `restaurant-ui.js` compone La Riel desde permisos del Core, no desde una lista de roles paralela. |
| 6. Diferencia de caja real | El smoke obtiene `systemCashExpected` de Tesorería y valida diferencia cero contra conteo físico; la UI calcula en vivo el mismo delta. |

La matriz no cambia los gates de producción real del vertical.
