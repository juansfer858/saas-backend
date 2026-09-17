# Restaurante Edge-first · Cobertura P1

Base auditada: `main` en `ec6537f20dcfe04978cb92e24f2f7f0b5981dcbf`.

Objetivo: saber qué partes del restaurante continúan operando cuando Internet/Core no están disponibles, antes de ampliar el modo offline.

| Módulo | Estado actual | Evidencia / límite |
| --- | --- | --- |
| Entrada PC / Workspace local | PARCIAL | Existe entrada local en `127.0.0.1:8788`, sesión local y snapshot SQLite. Requiere haber vinculado el equipo previamente; la duración de sesión se está reforzando en P0. |
| Mesas | PARCIAL | El Workspace local permite abrir mesa, pedir cuenta y cerrar. Cambio de mesa y todas las variantes operativas todavía no quedan declaradas como cobertura completa. |
| Mesero / Pedidos | LOCAL VERIFICADO | El Edge mantiene borrador/estado local, registra pedidos y posee CI específico con Core caído. |
| KDS / Comandas | LOCAL VERIFICADO | El Workspace/Edge permite cambiar estados de comandas localmente y conservar operación en la sede. |
| Impresión | LOCAL VERIFICADO | Bridge y spooler residen en Edge; la impresión local no depende del navegador llegando al Core. |
| QR cliente | LOCAL VERIFICADO | Existe runtime QR LAN/offline y CI que prueba operación con Core no disponible. |
| Caja | PARCIAL | Existe apertura/cierre local, cierre de mesa y cola de operación; falta declarar paridad completa para división, crédito y todos los métodos/variantes. |
| Domicilios | CORE | No existe todavía una ruta de Domicilios en el Workspace local. Hoy no debe considerarse disponible sin Core. |
| Inventario administrativo | CORE | No hay contrato de escritura local completo para ajustes/administración de inventario. |
| Administración / Reportes | CORE | Se mantienen como funciones de nube; no son requisito para sostener la atención durante una caída. |
| Sincronización | LOCAL + CORE | Edge mantiene cola local y sincroniza operaciones al recuperar conectividad. |

## Prioridad de implementación

1. Convertir Domicilios a operación local-first.
2. Completar Caja offline hasta cubrir cobro normal, medios de pago y reglas críticas sin duplicación.
3. Cerrar las brechas de Mesas (movimiento/casos especiales) y confirmar KDS/impresión extremo a extremo.
4. Mantener Inventario administrativo y Reportes como nube, salvo las afectaciones automáticas derivadas de ventas/pedidos que deban reconciliarse al sincronizar.

## Regla de seguridad

No se considera un módulo `LOCAL VERIFICADO` por tener UI cacheada. Debe existir persistencia local, cola/idempotencia o estado local equivalente y una prueba con Core no disponible.
