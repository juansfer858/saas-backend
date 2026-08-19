# VantixGC Platform Core V1 — DIAN, Nómina, RBAC, Impresión y Panel SaaS

## Alcance

Este bloque implementa cuatro motores transversales del Core y los mantiene separados de las capas de vertical:

1. Núcleo DIAN compartido por Facturación Electrónica y Nómina Electrónica.
2. Roles/permisos tenant-scoped por módulo y acción.
3. Configuración de impresión por tenant con formatos físicos y endpoints LAN.
4. Super-Administración SaaS con autenticación independiente de cualquier tenant.

La dirección funcional proviene del prompt de ejecución del proyecto. Las cifras, resoluciones, plazos y detalles técnicos normativos no se convierten en constantes legales sin verificación previa contra fuentes oficiales DIAN vigentes.

## 1. Núcleo DIAN

### Modelo

- `DianTenantConfig`: una sola configuración por tenant para PT, ambiente, credenciales cifradas, certificado y flags de Facturación/Nómina.
- `DianNumberingRange`: rangos fiscales por tipo documental, prefijo, autorización, vigencia y siguiente consecutivo.
- `DianDocument`: outbox fiscal desacoplado del documento de negocio.
- `DianTransmissionAttempt`: historial de transmisión/reintentos.

Tipos de documento del contrato interno:

- `FACTURA_ELECTRONICA`
- `DOCUMENTO_EQUIVALENTE_POS`
- `DOCUMENTO_SOPORTE`
- `NOMINA_ELECTRONICA`
- `NOTA_AJUSTE`

Estados:

`GENERADO -> PENDIENTE_ENVIO -> ENVIANDO -> ACEPTADO | RECHAZADO | CONTINGENCIA`

### Principio de contingencia

La operación de negocio se confirma localmente y crea su registro en el outbox DIAN. La transmisión externa se procesa en segundo plano. Una caída del PT no anula una venta ya registrada: el documento fiscal pasa a `CONTINGENCIA` y se reintenta.

La falta de configuración local indispensable (por ejemplo rango fiscal agotado/no configurado) sí bloquea la emisión fiscal, porque no es una caída externa sino una configuración incompleta del tenant.

### Adaptadores

V1 incluye `MOCK_PT` y `MOCK_PT_DOWN` exclusivamente para pruebas/habilitación del Core. No constituyen transmisión real ante DIAN.

Para producción falta seleccionar/contratar el Proveedor Tecnológico y desarrollar su adaptador API concreto. `MOCK_PT` está explícitamente prohibido en ambiente `PRODUCCION`.

### Integración comercial

La creación directa de una venta `EMITIDO` a través del endpoint de Ventas usa una transacción única para:

- documento de venta;
- inventario/tesorería/cartera;
- asiento AU;
- outbox fiscal DIAN.

El flujo de borrador -> emitir conserva el motor comercial actual; la creación fiscal queda conectada al momento de emisión, pero su atomicidad completa se considera requisito de endurecimiento antes de declarar el motor DIAN listo para producción real.

### Documento soporte

Existe endpoint explícito para crear el outbox de `DOCUMENTO_SOPORTE` a partir de una compra ya emitida. La regla que determine automáticamente si un proveedor está o no obligado a facturar no se hardcodea todavía: debe modelarse con datos fiscales verificados y/o la integración del PT.

## 2. Nómina electrónica mínima

### Modelo

- `PayrollEmployee`: empleado apoyado en `Tercero` como origen transversal.
- `PayrollConfig`: cuentas PUC para gasto, nómina por pagar y aportes/deducciones.
- `PayrollPeriod`: periodo mensual/quincenal.
- `PayrollLine`: devengados, deducciones, neto y vínculo al documento DIAN.

### Flujo

`BORRADOR -> GENERADO -> TRANSMITIDO`

Al generar:

1. valida parametrización contable;
2. crea un único AU balanceado por el periodo;
3. crea un `DianDocument` `NOMINA_ELECTRONICA` por empleado;
4. no duplica credenciales PT/certificado: consume `DianTenantConfig`.

No se codifica un plazo legal fijo de transmisión. `transmissionReminderDays` es una preferencia operativa, no una interpretación legal.

## 3. Roles y permisos

### Modelo

- `RbacRole`
- `RbacPermission`
- `RbacRolePermission`
- `RbacUserRole`
- `RbacUserPermissionOverride`
- `RbacAudit`

Permisos son `MODULO.ACCION`, por ejemplo:

- `VENTAS.EMITIR`
- `COMPRAS.ANULAR`
- `INVENTARIO.AJUSTAR`
- `CONTABILIDAD.CERRAR`
- `CONTABILIDAD.REABRIR`
- `CONFIGURACION.ADMINISTRAR`

Roles base: `ADMIN`, `CONTADOR`, `AUXILIAR`, `VENDEDOR`, `BODEGUERO`.

Los roles personalizados pueden almacenar `vertical` (por ejemplo `RESTAURANTE`) sin agregar conceptos específicos del vertical al catálogo base del Core.

Los overrides por usuario soportan `ALLOW` y `DENY`. Todo cambio administrativo se registra en `RbacAudit` y también en la auditoría contable existente bajo entidad `RBAC`.

Durante la transición, el campo legado `User.rol` se conserva como fallback para no romper clientes existentes.

## 4. Impresión

### Formatos modelados

- Térmica 58 mm
- Térmica 80 mm
- Carta 215.9 x 279.4 mm
- Media carta 139.7 x 215.9 mm
- PDF carta / media carta

`PrintTenantConfig` guarda formato predeterminado, logo, encabezado, pie y bloque QR. `PrinterEndpoint` permite declarar impresoras de navegador o LAN con roles como `DOCUMENTOS`, `COCINA`, `BARRA`.

V1 configura topología/plantillas; no implementa todavía un spooler RAW/ESC-POS que abra sockets LAN desde el servidor/cliente.

### Límite QR

El producto reserva por defecto 20 mm. Ese valor se conserva por requisito del prompt, pero **no se etiqueta como mínimo legal DIAN verificado** hasta contrastarlo con el anexo técnico oficial vigente. La API devuelve `PENDING_OFFICIAL_ANNEX_SIZE_VERIFICATION`.

## 5. Panel SaaS

### Separación de seguridad

`PlatformSuperAdmin` es una identidad separada de `User` del tenant.

El token de plataforma usa issuer/audience distintos y scope `PLATFORM_ADMIN`. Un JWT normal del tenant no puede autenticarse en `/platform/api`.

### Modelo

- `PlatformSuperAdmin`
- `PlatformTenantControl`
- `PlatformUsageMetric`
- `PlatformAudit`

### Capacidades

- listar tenants;
- activar/suspender tenant sin borrar información;
- listar y activar/desactivar usuarios de cualquier tenant;
- plan y límites;
- `currentVersion` / `targetVersion`;
- canal `ESTABLE`, `PILOTO`, `PAUSADO`;
- métricas agregadas y estados DIAN;
- auditoría de plataforma.

`demo-core` se inicializa como canal `PILOTO` en el bootstrap V1.

El panel usa `/platform` y no se enlaza desde la navegación tenant. La API es el límite de seguridad: requiere credenciales de super-administrador de plataforma independientes.

## 6. Pantallas

- `/app/configuracion-avanzada`: DIAN, roles/permisos, impresión y nómina del tenant.
- `/platform`: login y Panel SaaS independiente.

## 7. Despliegue y bootstrap

Scripts idempotentes:

- `scripts/ensure-all-tenant-platform-v1.js`
- `scripts/ensure-platform-superadmin.js`

El super-administrador no tiene contraseña hardcodeada. Se crea únicamente cuando existen las variables seguras de despliegue:

- `PLATFORM_SUPERADMIN_EMAIL`
- `PLATFORM_SUPERADMIN_PASSWORD`
- `PLATFORM_SUPERADMIN_NAME` opcional

Credenciales PT tampoco se almacenan en código; se cifran en base de datos con `DIAN_CREDENTIALS_SECRET` (fallback técnico a `JWT_SECRET`).

## 8. Criterios que V1 puede probar sin PT real

- una sola configuración DIAN sirve a facturación y nómina;
- venta emitida crea AU + outbox fiscal;
- caída simulada del PT deja venta válida y documento en contingencia;
- nómina genera AU + documento electrónico por empleado sin doble configuración PT;
- permisos por acción, roles de vertical y overrides por usuario;
- configuración 58/80/Carta, bloque QR y endpoint LAN;
- autenticación SaaS separada, suspensión tenant/usuario y rollout piloto;
- JWT tenant rechazado por la API de plataforma.

## 9. Bloqueadores externos antes de producción fiscal real

1. Elegir Proveedor Tecnológico autorizado y obtener su contrato/API/sandbox.
2. Completar habilitación oficial del tenant según proceso vigente.
3. Implementar firma/XML/validaciones exactas exigidas por el anexo técnico vigente o delegadas por el PT.
4. Validar oficialmente requisitos de representación gráfica, incluido el tamaño exacto del QR.
5. Configurar certificados/credenciales en secretos; nunca en repositorio.

Por estas dependencias, V1 puede declararse **arquitectura y operación interna listas para integrar PT**, pero no “facturación DIAN real en producción” hasta completar esos puntos.
