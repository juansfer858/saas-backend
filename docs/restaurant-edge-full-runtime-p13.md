# P13 · VantixGC Restaurantes — Full Local Runtime

Estado: laboratorio aislado. Esta rama no cambia producción ni sustituye Edge 2.1.18.

## Problema actual

El Edge local sirve un workspace propio y simplificado. Aunque permite operar parte del restaurante sin Internet, no es la misma aplicación que el Super Core/Restaurante V2. Eso provoca diferencias visuales, funcionales y de flujo entre `core.vantixgc.com` y la sede local.

## Objetivo

Convertir la sede en un runtime local-first real del tenant:

- El usuario abre siempre la aplicación local.
- La interfaz local debe ser exactamente la misma interfaz del Super Core/Restaurante que se publica en Core.
- La operación del restaurante no depende de Internet.
- Core pasa a ser control plane, réplica, respaldo, actualizaciones y acceso remoto; no el requisito para cada operación de la sede.
- Si el PC se reemplaza, el instalador puede reconstruir la sede desde una copia cloud válida y continuar la sincronización.

## Aclaración de alcance

No se debe descargar el SaaS multi-tenant completo con secretos, credenciales centrales ni datos de otros tenants. Se instala un runtime single-tenant que contiene el mismo código funcional necesario para ese negocio.

Se distinguen:

1. Runtime tenant local: Restaurante + módulos del Super Core habilitados para ese tenant.
2. Control plane cloud: licencias, aprovisionamiento, releases, configuración central, respaldo y observabilidad.
3. Integraciones externas: siguen siendo adaptadores separados y nunca deben bloquear la operación local cuando no son estrictamente necesarias.

## Arquitectura objetivo

### 1. Misma UI, una sola fuente

El frontend de Restaurante/Super Core se construye una sola vez. El mismo bundle/version se sirve desde:

- Core, cuando se usa acceso remoto.
- Edge Full Runtime, cuando se usa la sede local.

No debe existir una segunda interfaz funcional escrita aparte para offline.

Las rutas deben conservar su forma canónica, por ejemplo:

- `/app/centro-de-control-v2`
- `/app/centro-de-control/mesero-v2/`
- `/app/produccion-v2/`
- módulos tenant del Super Core.

### 2. API local compatible

La UI debe usar las mismas rutas y contratos REST que usa en Core. El runtime local debe exponer los contratos necesarios bajo `/api/v1/...` para que el frontend no necesite una versión visual o funcional alternativa.

Cuando una operación es local:

`UI -> API local -> PostgreSQL local -> outbox de sincronización`

Cuando la sede tiene Internet:

`outbox -> Core -> réplica cloud`

### 3. Base de datos local del tenant

Para un runtime completo del Super Core no conviene recrear todo sobre SQLite. El objetivo es reutilizar Prisma, reglas de negocio y transacciones actuales.

Diseño propuesto:

- PostgreSQL local single-tenant para datos operativos.
- SQLite del Edge se conserva para cola técnica, spool de impresión, estado del agente y tareas pequeñas que ya funcionan bien allí.
- El tenant local queda bloqueado a una sola identidad de empresa y una sola instalación.

### 4. Autoridad de datos

En operación normal de la sede, la base local es la autoridad inmediata de los movimientos operativos.

Ejemplos:

- mesas
- pedidos
- personas
- KDS/comandas
- caja
- domicilios
- ventas
- inventario
- terceros
- tesorería local
- contabilidad derivada de esas operaciones

Core recibe réplica casi en tiempo real cuando hay conexión.

La plataforma central conserva autoridad sobre:

- licencia/entitlement
- aprovisionamiento de tenant
- releases
- revocaciones administrativas
- secretos de infraestructura central

### 5. Sincronización

Toda mutación local debe producir un evento de outbox transaccional con:

- `eventId` UUID
- `tenantId`
- `installationId`
- `entityType`
- `entityId`
- `operation`
- `version`
- `occurredAt`
- payload mínimo necesario

Core mantiene inbox/idempotencia. Un mismo evento no puede aplicarse dos veces.

Para cambios cloud -> local se usa una cola/versionado equivalente. No se permite sobrescribir silenciosamente un movimiento financiero ya confirmado en la sede.

### 6. Recuperación por daño del PC

Flujo objetivo:

1. Instalar Edge Full Runtime en el nuevo PC.
2. Vincular la instalación al tenant.
3. Descargar el último snapshot consistente almacenado en Core.
4. Restaurar PostgreSQL local.
5. Descargar y aplicar deltas posteriores al snapshot.
6. Validar integridad y consecutivos.
7. Habilitar operación.

Advertencia: si el PC se destruye mientras lleva horas sin Internet, los movimientos que nunca alcanzaron Core no pueden recuperarse desde la nube. Por eso el diseño debe incluir además backup local rotativo a un segundo medio cuando el cliente lo configure (otro disco, NAS o segundo equipo de la LAN).

### 7. Acceso del usuario

El acceso cotidiano debe ser local-first siempre, incluso cuando Internet funciona.

Ejemplo PC principal:

`http://127.0.0.1:8788/app/...`

Otros dispositivos de la sede usan la IP/hostname LAN del Edge.

La UI muestra únicamente el estado de conectividad:

- `LOCAL · SINCRONIZADO`
- `LOCAL · SIN INTERNET`
- `LOCAL · N operaciones pendientes`

El usuario no cambia manualmente entre un “sistema local” y un “sistema de nube”.

### 8. Autenticación local

No depender de una cookie de 7 días para poder abrir el negocio.

El runtime completo debe disponer de usuarios/permisos locales sincronizados de forma segura y permitir inicio de sesión local sin Core. La nube refresca revocaciones y permisos cuando vuelve la conexión.

No se almacenan contraseñas en texto plano. Si se reutilizan credenciales, solo se almacenan hashes adecuados y metadatos de autorización necesarios para el tenant local.

### 9. Actualizaciones

Los paquetes deben ser firmados y versionados.

Proceso:

1. Descargar release mientras hay Internet.
2. Verificar firma/hash.
3. Preparar migración local.
4. Crear backup previo.
5. Aplicar release atómicamente.
6. Health check.
7. Rollback automático si falla.

Nunca una actualización debe dejar Caja/KDS sin arrancar.

## Aislamiento del laboratorio P13

Mientras P13 no pase paridad, no se modifica la entrada operativa actual.

Reglas:

- Rama: `lab/edge-full-runtime-p13`.
- No reemplazar `main` ni Edge 2.1.18.
- Runtime experimental en puerto distinto, inicialmente `8790`.
- Datos experimentales en directorio/base separados.
- No escribir en la base productiva del tenant desde el laboratorio.
- No cambiar impresoras, Caja, consecutivos, Inventario ni Contabilidad de producción.
- No modificar los accesos canónicos `8788` hasta tener prueba de recuperación y offline completa.

## Fases

### P13-A · Paridad visual local

Servir exactamente los mismos assets del Restaurante/Super Core desde el laboratorio local. Sin mutaciones. Objetivo: que visualmente y en navegación sea la misma aplicación.

### P13-B · PostgreSQL local single-tenant

Levantar base local separada, ejecutar schema/migraciones compatibles y cargar un snapshot de laboratorio.

### P13-C · Contratos API locales

Ejecutar el backend tenant local con los mismos contratos que Core, empezando por lectura y luego mutaciones por frontera funcional.

Orden sugerido:

1. identidad/usuarios/permisos
2. mesas/visitas
3. mesero/pedidos/personas
4. KDS/comandas
5. caja/pagos
6. domicilios
7. inventario/ventas/terceros
8. tesorería/contabilidad/reportes
9. configuración tenant

### P13-D · Sync outbox/inbox

Replicar mutaciones locales a Core con idempotencia y descargar cambios compatibles de Core.

### P13-E · Pruebas de desastre

Obligatorias antes de pilotear:

- Internet desconectado antes de abrir la app.
- Internet cae en medio de un pedido.
- Reinicio de Windows sin Internet.
- Reinicio del Edge sin Internet.
- Caja y KDS durante caída.
- Impresión durante caída.
- 8-24 h de operación aislada.
- reconexión con cola pendiente.
- reenvío duplicado de eventos.
- PC reemplazado y restauración desde cloud.
- rollback de actualización.

### P13-F · Piloto opt-in

Solo después de paridad y recuperación, un tenant de prueba puede habilitar el nuevo runtime. El Edge actual permanece como rollback hasta cierre formal del piloto.

## Criterio de éxito

El operador no debe poder distinguir por la interfaz si tiene o no Internet. Debe ver el mismo Super Core/Restaurante y continuar trabajando. La única diferencia visible será el estado de sincronización.
