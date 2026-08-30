# VantixGC Mesero — Interaction Stability V6

Objetivo: eliminar congelamientos aparentes, renders superpuestos y resultados tardíos en la PWA del mesero.

## Causa corregida

La vista Mesero reconstruye su superficie al cambiar zona, mesa, persona, categoría o pedido. Antes podían existir dos `renderWaiter()` simultáneos y ambos modificaban el mismo estado global (`S.tables`, `S.draft`, `S.orders`). En una tablet o red lenta, una respuesta antigua podía terminar después de una nueva y volver a dibujar información atrasada.

## V6

- `renderWaiter()` se ejecuta de forma serial; si llega otra intención mientras está cargando, se conserva una sola actualización pendiente y se ejecuta inmediatamente después.
- GET repetidos de zonas, menú, mesas, borrador y pedidos tienen caché corto sólo en la PWA del Mesero.
- GET idénticos en vuelo se deduplican.
- Toda mutación invalida las lecturas que puede haber dejado obsoletas.
- Mientras existe una mutación se bloquea un segundo toque sobre acciones de escritura y se muestra `Actualizando…`.
- El Service Worker V6 no cachea APIs ni reintenta POST/PUT/PATCH/DELETE.

La asignación flexible de zonas/mesas y los permisos RBAC no cambian en esta revisión.
