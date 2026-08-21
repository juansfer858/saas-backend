# Restaurante — acceso desde Super Core

El panel tenant debe mostrar **Restaurante** únicamente cuando el usuario autenticado tenga acceso real al endpoint protegido `/api/v1/restaurante/ui-context`, que exige `RESTAURANTE.VER` mediante el RBAC del Core.

El enlace abre `/app/restaurante`; no duplica la lógica de mesas, pedidos ni roles dentro del panel general.
