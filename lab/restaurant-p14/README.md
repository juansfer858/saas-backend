# VantixGC Restaurante P14 · Home Pilot

> Estado actual: laboratorio aislado. No instalar todavía en el restaurante real.

P14 ejecuta el mismo Restaurante V2 del Super Core sobre PostgreSQL local. En la frontera `P14-1A` únicamente permite iniciar sesión y consultar superficies canónicas; todas las mutaciones operativas permanecen bloqueadas.

## Identidad fija del piloto

```text
Tenant:          demo-restaurante
Instalación:     HOME-PILOT-01
Canal:           PILOT
Modo:            LOCAL_FIRST
Runtime HTTP:    8790
PostgreSQL:      55432/vantix_p14_home_pilot
Edge productivo: 8788, sin tocar
Super Core:      https://core.vantixgc.com
Sincronización:  apagada hasta P14-3
QR público:      únicamente en Super Core
```

## Archivos principales

- `runtime-config.js`: valida tenant, instalación, canal, puertos, base, LAN y secretos.
- `bootstrap-demo.js`: crea únicamente `demo-restaurante` en la base local y fija la contraseña del administrador piloto.
- `runtime.js`: monta el grafo canónico `src/app.js` detrás de fronteras locales.
- `.env.example`: plantilla de variables, sin secretos reales.

## Protección de red

En loopback el runtime escucha solo en `127.0.0.1:8790`.

En modo LAN:

```text
P14_LAN_ENABLED=true
P14_BIND_HOST=0.0.0.0
P14_ADVERTISE_HOST=<IP privada reservada del PC>
P14_LAN_CIDR=<subred privada autorizada>
```

La protección es doble:

1. Windows Firewall deberá permitir `8790` únicamente desde la subred configurada.
2. El runtime vuelve a comprobar la IP remota y rechaza cualquier cliente externo a la subred, incluso si el firewall quedara mal configurado.

PostgreSQL nunca escucha para otros equipos; permanece en loopback `127.0.0.1:55432`.

## Arranque técnico de laboratorio

Estos comandos son para CI o desarrollo controlado. El usuario final recibirá un instalador y no deberá ejecutarlos manualmente.

```bash
cp lab/restaurant-p14/.env.example lab/restaurant-p14/.env
# completar secretos locales y, cuando corresponda, la IP/CIDR de la casa

npx prisma generate
npx prisma db push
node lab/restaurant-p14/bootstrap-demo.js
node lab/restaurant-p14/runtime.js
```

Estado:

```text
GET http://127.0.0.1:8790/__p14/status
```

Acceso local:

```text
http://127.0.0.1:8790/app
```

En LAN se reemplaza `127.0.0.1` por `P14_ADVERTISE_HOST`.

## Qué permite P14-1A

- Arrancar el grafo canónico de Restaurante V2.
- Iniciar sesión como administrador local.
- Consultar pantallas y APIs de solo lectura.
- Acceder desde loopback o desde la subred privada autorizada.
- Ver el estado local sin revelar secretos.

## Qué bloquea P14-1A

- Abrir o cerrar mesas.
- Crear o enviar pedidos.
- Cambiar estados de Cocina, Barra o Postres.
- Abrir o cerrar turnos.
- Cobrar.
- Imprimir.
- Escribir en inventario, tesorería o contabilidad.
- Acceder al plano administrativo de Super Core desde el runtime local.
- Hospedar el QR público localmente.
- Sincronizar con Core.

La respuesta para una mutación operativa es:

```text
423 P14_OPERATIONAL_MUTATIONS_LOCKED
```

## Pruebas automáticas

```bash
node scripts/restaurant-local-first-p14-gate-smoke.js
node scripts/restaurant-local-first-p14-runtime-config-smoke.js
node scripts/restaurant-local-first-p14-runtime-shell-smoke.js
```

El workflow dedicado también crea un PostgreSQL descartable, ejecuta el bootstrap, arranca el runtime, realiza login, verifica la sesión, comprueba el bloqueo de mutaciones y confirma que el QR continúa cloud-only.

## Siguiente frontera

`P14-1B · Windows + LAN física`:

1. Empaquetar Node y PostgreSQL sin reutilizar la instalación Edge 8788.
2. Corregir definitivamente supervisor, arranque y desinstalación.
3. Crear regla de firewall limitada al CIDR privado.
4. Detectar y mostrar la IP LAN reservada.
5. Probar desde otro computador y una tablet en casa.
6. Mantener todas las mutaciones operativas bloqueadas durante esa prueba.

Solo después de superar P14-1B se abrirán, una por una, las fronteras de mesas, pedidos, KDS, Caja e impresión.
