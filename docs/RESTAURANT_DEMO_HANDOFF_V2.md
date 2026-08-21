# Restaurante Demo — Handoff V2

Este cambio rota exclusivamente las credenciales del tenant `demo-restaurante` para pruebas manuales y actualiza el marcador público de despliegue a `ROTATED_V2_2026_08_21`.

No cambia roles, reglas fiscales, datos del negocio, gates de producción ni funcionalidad de Restaurante.

La contraseña en texto plano no se almacena en el repositorio; CI verifica que la contraseña de handoff entregada al dueño coincide con el hash del seed.
