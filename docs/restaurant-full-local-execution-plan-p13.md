# P13 · VantixGC Restaurantes — Plan de ejecución Full Local

Estado: laboratorio aislado. Este plan no modifica `main`, no reemplaza Edge `8788` y no escribe en datos productivos.

## Arquitectura aprobada

### Operación interna

`PC / Tablet / KDS / Caja -> LAN/Wi-Fi -> Vantix Local -> PostgreSQL local`

El restaurante opera localmente aun sin Internet. La sede no cambia de aplicación cuando se cae la conexión.

### QR de clientes

`Cliente con datos -> Core nube -> cola cloud -> sincronización -> Vantix Local`

El QR público permanece cloud. Core no puede marcar un pedido como recibido por cocina hasta que la sede local confirme importación.

### Core cloud

Core deja de ser dependencia para la operación interna y conserva estas responsabilidades:

- licenciamiento y activación;
- sincronización bidireccional;
- respaldo/snapshots;
- QR público;
- actualizaciones y rollout;
- administración remota;
- observabilidad de la flota.

## Principios obligatorios

1. Un solo código funcional para Core y Local. No mantener una segunda Caja, un segundo KDS o un segundo Mesero.
2. PostgreSQL local es la autoridad inmediata de la operación interna.
3. Ningún cobro, pedido interno o impresión espera respuesta de Internet.
4. Toda sincronización es idempotente y versionada.
5. QR cliente sigue cloud y entra al local por sincronización.
6. Licencia y actualización se verifican localmente con firmas criptográficas.
7. La pérdida de Internet no equivale a pérdida de licencia.
8. Ninguna actualización reemplaza archivos en vivo sin backup, health check y rollback.
9. El paquete local es single-tenant: no contiene secretos centrales ni datos de otros negocios.
10. La migración productiva solo ocurre después de pruebas offline, reconexión y desastre.

## Fases de ejecución

### P13-A · Mismo Super Core local

Objetivo: demostrar que el PC sirve el mismo `src/app.js`, los mismos assets y rutas canónicas que Core.

Estado actual:

- runtime aislado en `127.0.0.1:8790`;
- Edge productivo `8788` intacto;
- PostgreSQL aislado `127.0.0.1:55432/vantix_p13_lab`;
- control plane y QR público excluidos del runtime local;
- CI completo del repositorio validado sobre la rama de laboratorio.

Criterio de salida: Dashboard y Restaurante V2 se sirven desde el mismo código canónico.

### P13-B · Identidad local single-tenant

Objetivo: cada instalación representa exactamente un negocio.

B1 — validado:

- `P13_TENANT_SUBDOMAIN` fijo;
- JWT local distinto al de Core;
- login contra PostgreSQL local;
- bootstrap de tenant demo desechable.

B2 — base criptográfica validada en laboratorio:

- `installationId` único;
- par de claves Ed25519 de instalación;
- fingerprint SHA-256 ligado a la licencia;
- challenge/response de posesión de clave privada;
- almacenamiento seguro Windows (TPM/DPAPI) queda para el empaquetado nativo.

### P13-C · Licenciamiento offline verificable

Formato objetivo de licencia firmada:

- `licenseVersion`;
- `tenantId`;
- `tenantSubdomain`;
- `installationId`;
- fingerprint de clave pública de instalación;
- `plan`;
- `features`;
- `issuedAt`;
- `validUntil`;
- `graceUntil`;
- `keyId`;
- firma Ed25519 de Vantix.

Estado de laboratorio: verificación de firma, binding de instalación, entitlements y estados `VALID`, `GRACE`, `EXPIRED` validados.

Reglas:

- el PC solo lleva la clave pública de Vantix;
- la clave privada de firma vive únicamente en infraestructura central;
- la verificación no requiere Internet;
- Core renueva el lease cuando hay conexión;
- una caída de Internet no interrumpe una venta ni un pedido;
- la política comercial posterior a `EXPIRED` se mantiene separada del motor criptográfico.

### P13-D · Paquete local completo

El instalador debe dejar disponibles localmente:

- Node runtime administrado;
- backend Super Core del tenant;
- Restaurante V2;
- PostgreSQL local;
- Prisma + migraciones;
- impresión/Edge;
- supervisor;
- updater;
- backup/restore;
- servicio de sincronización.

No incluye:

- secretos maestros de Vantix;
- panel SaaS global;
- credenciales de otros tenants;
- claves privadas de firma;
- tokens centrales de proveedores.

### P13-E · Habilitar operación local por fronteras

Orden obligatorio:

1. usuarios/roles/permisos;
2. mesas/visitas;
3. mesero/pedidos/personas;
4. KDS/comandas;
5. impresión;
6. caja/pagos;
7. domicilios;
8. inventario/ventas/terceros;
9. tesorería/contabilidad/reportes;
10. configuración tenant.

Cada frontera debe probarse aislada antes de abrir la siguiente.

#### P13-E1 · Usuarios / roles / permisos — VALIDADO EN LABORATORIO

- se mantiene el mismo `auth`, `user.service` y RBAC canónico del Super Core;
- runtime local permite mutaciones únicamente en `AUTH_LOGIN`, `IDENTITY_USERS` e `IDENTITY_RBAC`;
- cualquier otra mutación de negocio sigue respondiendo `P13_BOUNDARY_LOCKED`;
- ADMIN puede crear/editar usuarios y administrar roles/permisos localmente;
- MESERO autentica localmente y no puede entrar a administración de Usuarios/RBAC sin permiso;
- credenciales sobreviven reinicio del runtime sin consultar Core;
- triggers PostgreSQL generan outbox transaccional para Usuario/RBAC dentro de la misma transacción;
- el payload de sincronización de usuario excluye password y hash de password;
- versiones por entidad se incrementan localmente;
- CI aislado verde: `Restaurant P13 Full Local Isolated CI` run `34782773345`.

Siguiente frontera: `P13-E2 · Mesas / visitas`.

### P13-F · Sincronización Local -> Core

Toda mutación local genera outbox transaccional con al menos:

- `eventId` UUID;
- `tenantId`;
- `installationId`;
- `entityType`;
- `entityId`;
- `operation`;
- `entityVersion`;
- `occurredAt`;
- `payload` mínimo.

Core mantiene inbox e idempotencia. El mismo `eventId` aplicado varias veces debe producir un solo efecto.

Regla financiera: una confirmación local de Caja nunca puede ser reescrita silenciosamente por una réplica cloud.

Estado actual: esquema `outbox/inbox/cursor`, idempotencia, detección de colisión y primer outbox transaccional de identidad E1 validados con PostgreSQL real de laboratorio.

### P13-G · QR Core -> Local

El QR continúa en Core.

Flujo:

1. cliente abre QR cloud;
2. Core usa carta/precios sincronizados;
3. cliente confirma pedido;
4. Core genera `QR_ORDER_CREATED` con `eventId` único;
5. Vantix Local importa una sola vez;
6. pedido entra a PostgreSQL local;
7. KDS/impresión operan localmente;
8. Local confirma `QR_ORDER_IMPORTED` a Core;
9. recién entonces Core puede mostrar “recibido por el restaurante”.

Si la sede está offline, Core debe distinguir `PENDIENTE_DE_SEDE` de `RECIBIDO_POR_SEDE`.

### P13-H · Actualizaciones administradas

Estructura objetivo en Windows:

`C:\ProgramData\VantixGC\Restaurant\releases\<version>`

`current` apunta a la versión activa.

Flujo:

1. Core publica manifest firmado;
2. PC descarga paquete en segundo plano;
3. verifica Ed25519 + SHA-256;
4. valida compatibilidad y licencia;
5. realiza backup;
6. instala en directorio nuevo;
7. aplica migración compatible;
8. cambia `current`;
9. ejecuta health check;
10. si falla, rollback automático a la versión anterior.

Canales:

- `PILOT`;
- `STABLE`;
- `EMERGENCY`.

Estado de laboratorio: manifest firmado, hash de paquete y política de canales validados. No actualizar automáticamente durante una operación crítica de Caja.

### P13-I · Backup y recuperación

Core debe conservar snapshots consistentes y deltas sincronizados.

Recuperación de PC:

1. instalar VantixGC Restaurantes;
2. vincular nuevo equipo;
3. emitir nueva identidad/licencia;
4. revocar instalación anterior cuando corresponda;
5. descargar snapshot;
6. restaurar PostgreSQL;
7. aplicar deltas posteriores;
8. validar integridad/consecutivos;
9. habilitar operación.

Estado de laboratorio validado:

- `pg_dump` custom format;
- SHA-256 del snapshot;
- inventario lógico del tenant;
- restore a base de reemplazo;
- credencial ADMIN preservada;
- instalación antigua revocada y nueva instalación activa;
- outbox histórico preservado;
- nuevos eventos Local -> Core y Core/QR -> Local después del restore;
- snapshot alterado rechazado.

Para cubrir datos creados mientras la sede estaba totalmente offline, se admite segundo backup local a USB/NAS/equipo secundario.

### P13-J · Tablets, Mesero y KDS

Los dispositivos internos no llevan una copia independiente del sistema.

- se conectan por LAN/Wi-Fi al Vantix Local;
- conservan las PWA y rutas especializadas;
- cada dispositivo puede emparejarse y revocarse;
- una caída del proveedor de Internet no afecta la LAN interna;
- el nombre local estable debe evitar depender de una IP manual.

Objetivo final de acceso interno:

`http://vantix-restaurante.local/...`

La resolución/nombre definitivo se valida durante el instalador Windows.

## Matriz obligatoria antes de piloto

- abrir el sistema con Internet desconectado;
- login local sin Internet;
- tablet mesero operando solo por LAN;
- pedido interno offline;
- KDS offline;
- impresión offline;
- cobro offline;
- domicilios internos offline;
- reinicio de Windows sin Internet;
- 8–24 h desconectado;
- reconexión y vaciado de outbox;
- reintentos duplicados sin doble efecto;
- pedido QR cloud importado una sola vez;
- actualización correcta;
- actualización defectuosa con rollback;
- daño simulado del PC;
- restauración en otro equipo desde snapshot + deltas;
- revocación de instalación clonada/antigua.

## Regla de migración

Mientras esta matriz no esté completamente verde:

- no fusionar P13 a `main` como runtime productivo;
- no cambiar `8788`;
- no reemplazar el Edge actual;
- no usar base de datos real en el laboratorio;
- no conectar impresoras o Caja reales al P13 salvo prueba física explícitamente controlada.

## Resultado esperado

El restaurante debe poder trabajar normalmente aunque Core o el proveedor de Internet no estén disponibles. Core sigue siendo la central de Vantix para QR, licencia, backup, sincronización, actualización y acceso remoto, pero no participa en el camino crítico de la operación interna.