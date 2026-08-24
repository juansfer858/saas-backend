# VantixGC Edge Workspace V1

Objetivo: convertir Edge en el runtime operativo normal del restaurante, no en una pantalla de contingencia.

## Topologia
- Una sede usa un Edge principal.
- Caja, KDS, tablets y PCs de la sede usan el mismo Edge por LAN.
- El mismo Centro de Control se sirve desde Core o desde Edge.
- Core conserva administracion, acceso remoto, centralizacion, respaldo, despliegues y sincronizacion.

## Sesion local
- El usuario inicia sesion normalmente contra Core.
- Core genera un grant local de un solo uso y corta duracion para un Edge especifico.
- El navegador navega al Edge por LAN con ese grant.
- Edge consume/valida el grant contra Core usando credenciales de dispositivo y crea una sesion local firmada con secreto del propio Edge.
- La sesion local conserva userId, tenant, rol y permisos efectivos.
- Una vez emparejado el navegador puede seguir operando durante una caida WAN sin compartir JWT_SECRET ni copiar contrasenas al Edge.

## Runtime operativo
- Edge sirve `/app/centro-de-control` y los assets Restaurante.
- La UI detecta origen local y usa un adapter local; en Core sigue usando `/api/v1/restaurante`.
- Mesas, pedidos, comandas y caja mutan primero SQLite/local snapshot y encolan operaciones idempotentes.
- Al volver Internet, la cola se reconcilia con Core sin duplicar documentos.

## Seguridad LAN
- Lecturas operativas y escrituras requieren sesion local de usuario.
- El emparejamiento inicial requiere Core online y grant de un solo uso.
- Las APIs tecnicas Edge mantienen `EDGE_LAN_KEY` para escrituras de dispositivo.
- El navegador nunca recibe EDGE_AGENT_KEY ni EDGE_LAN_KEY.

## Experiencia comercial
- En el PC servidor el instalador crea acceso directo al Centro de Control local.
- Otros equipos abren la URL LAN publicada por Edge; si no estan vinculados, se redirigen a Core para autenticar y vuelven con grant.
- Fuera del restaurante, el usuario entra por `https://core.vantixgc.com/app/centro-de-control`.
