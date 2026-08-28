# VantixGC SaaS Runtime Stability V1

Objetivo: que el Super Core permanezca disponible de forma continua y que un despliegue/reinicio no entregue una aplicación parcialmente inicializada.

## Contratos introducidos

1. `npm start` sólo levanta el proceso web (`node server.js`). Ya no recorre todos los tenants ni ejecuta seeds globales como efecto secundario de cada arranque.
2. Las tareas históricas de preparación quedan agrupadas en `npm run release`. Esta separación es transitoria mientras se construye la baseline de migraciones Prisma versionadas; el objetivo de la siguiente fase es sustituir `prisma db push` por `prisma migrate deploy`.
3. `/healthz` indica que el proceso HTTP está vivo.
4. `/readyz` sólo responde `200` cuando el runtime está marcado READY y PostgreSQL responde.
5. `/api/public/runtime-info` expone uptime, fase y commit cuando el proveedor lo inyecta (`SOURCE_COMMIT`, `COOLIFY_GIT_COMMIT_SHA`, `GIT_COMMIT`, `COMMIT_SHA` o `GITHUB_SHA`).
6. DIAN y Notificaciones usan un advisory lock de PostgreSQL. Durante rolling deploy sólo una instancia puede ejecutar cada cola.
7. Los workers pueden separarse del proceso web con:
   - `DIAN_EMBEDDED_WORKER_ENABLED=false`
   - `NOTIFICATION_EMBEDDED_WORKER_ENABLED=false`
   - proceso dedicado `npm run worker:dian`
   - proceso dedicado `npm run worker:notifications`
8. La UI Restaurante reintenta automáticamente únicamente lecturas GET/HEAD ante 429/5xx o fallo de red. POST/PUT/PATCH/DELETE nunca se reproducen automáticamente.

## Configuración de despliegue recomendada

Mientras exista `npm run release` basado en `db push`, ejecutarlo una sola vez como comando de release/pre-deploy antes de publicar la nueva revisión. El comando de arranque debe ser `npm start`.

El health check del orquestador debe apuntar a `/readyz`, no solamente a que el puerto esté abierto. El contenedor anterior debe permanecer recibiendo tráfico hasta que el nuevo responda `200` en `/readyz`.

## Siguiente fase obligatoria

Crear una baseline de migraciones para la base PostgreSQL existente y pasar a:

`prisma migrate deploy -> data migrations versionadas -> web READY`

Después de esa baseline se eliminarán los `db push` de los self-heal Runtime de Restaurante, Edge y Self-Service. Los self-heal se convertirán en verificadores de esquema (fail-fast), no modificadores de producción.

## Regla operativa

VantixGC no requiere reinicios diarios. Un proceso puede permanecer activo indefinidamente. Reinicios sólo deben ocurrir por despliegue, recuperación ante fallo o mantenimiento de infraestructura. Ningún tenant debe depender de reiniciar la aplicación para recuperar operación normal.
