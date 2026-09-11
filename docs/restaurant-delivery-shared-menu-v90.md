# Domicilios V90 · Carta compartida con Mesero

V90 cambia únicamente la captura de productos al crear un domicilio.

- La carta se obtiene de `/api/v1/restaurante/menu`, la misma fuente usada por Mesero.
- Domicilios no crea ni requiere mesa o sesión de mesa.
- El pedido conserva el dominio `domicilios` y sus estados propios.
- Se mantienen cliente, dirección, valor del domicilio, tiempo prometido y autofill V83.
- La carta se renderiza por categoría, búsqueda y páginas de 40 productos para evitar bloquear el navegador.
- Los productos con warning se muestran, pero no se pueden agregar, igual que en Mesero.
- El flujo posterior no cambia: `NUEVO -> ACEPTAR -> PRODUCCIÓN/KDS -> LISTO -> EN CAMINO -> ENTREGADO`.
- V89 queda disponible como rollback, pero deja de interceptar la superficie activa de Domicilios.

Rollback: retirar el asset V90 del HTML y volver a cargar el interceptor V89.
