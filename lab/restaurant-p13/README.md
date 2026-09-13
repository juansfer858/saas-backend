# P13-A/B1 · Runtime local canónico

Este directorio es un laboratorio aislado. No sustituye al Edge productivo de `8788` y no debe ejecutarse contra una base de datos de producción.

## Qué prueba P13-A

P13-A no construye una segunda interfaz. `runtime.js` importa directamente `src/app.js`, es decir, el mismo grafo Express y los mismos assets versionados de Super Core/Restaurante V2 que usa Core.

Entrada prevista del laboratorio:

`http://127.0.0.1:8790/app/dashboard`

Rutas de Restaurante que deben salir del mismo código canónico:

- `/app/centro-de-control-v2`
- `/app/restaurante-v2/mesas`
- `/app/restaurante-v2/pedidos`
- `/app/restaurante-v2/kds`
- `/app/restaurante-v2/caja`
- `/app/restaurante-v2/division`
- `/app/restaurante-v2/carta`

## P13-B1 · identidad y login locales

B1 agrega una identidad single-tenant de laboratorio sin copiar datos del restaurante real ni contactar Core. `bootstrap-demo.js` prepara exclusivamente `demo-restaurante` dentro de `vantix_p13_lab`, reutiliza los seeders existentes sobre PostgreSQL local y reemplaza la clave del ADMIN por un hash bcrypt generado desde `P13_ADMIN_PASSWORD`.

El runtime queda fijado a `P13_TENANT_SUBDOMAIN`; cualquier API que declare otro tenant se rechaza antes de entrar a Core. Además utiliza `P13_JWT_SECRET` como clave de sesión exclusivamente local, por lo que nunca necesita ni reutiliza el secreto JWT de producción.

B1 sirve para comprobar físicamente que login, Dashboard, Mesas, Pedidos, KDS, Caja y demás pantallas son las mismas de Core. Las mutaciones siguen bloqueadas.

## Barreras de seguridad

El proceso se niega a iniciar salvo que se cumplan todas estas condiciones:

- `VANTIX_P13_LAB_ENABLED=true`.
- Host HTTP exclusivo `127.0.0.1` o `::1`.
- Puerto HTTP exclusivo `8790`.
- No se puede usar `8788` ni el puerto normal del Core.
- PostgreSQL debe estar en loopback.
- PostgreSQL debe usar el puerto `55432`.
- La base debe llamarse exactamente `vantix_p13_lab`.
- `NODE_ENV=production` está prohibido.
- `P13_MUTATIONS_ENABLED=true` está prohibido.
- `P13_TENANT_SUBDOMAIN` es obligatorio y fija una sola empresa local.
- `P13_JWT_SECRET` debe ser exclusivo del laboratorio.
- Todas las mutaciones de negocio responden `423 P13_A_READ_ONLY`.
- Solo se permite el POST de login contra la base local.
- El control plane SaaS y `/edge/api` no se exponen como funciones locales.
- El QR público no se mueve al laboratorio; conserva la arquitectura híbrida actual.
- Las llamadas HTTP salientes del servidor se bloquean para evitar contacto accidental con servicios externos.

## PostgreSQL de laboratorio

`docker-compose.postgres.yml` define únicamente una base de laboratorio en:

`127.0.0.1:55432 / vantix_p13_lab`

No comparte volumen, puerto ni nombre con producción.

## Estado

P13-A/B1 demuestra una sola fuente de UI, aislamiento de proceso/base e inicio de sesión local. Todavía no es un POS local operativo: las mutaciones siguen bloqueadas deliberadamente. La siguiente frontera es cargar un snapshot de tenant controlado y después habilitar contratos operativos locales por módulo con outbox/idempotencia.

No fusionar esta rama a `main` ni cambiar el acceso `8788` mientras no se complete la secuencia de pruebas definida en `docs/restaurant-edge-full-runtime-p13.md`.
