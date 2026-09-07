# Restaurante V56 — pedido primero, habilitación al confirmar

Contrato funcional aprobado:

1. El QR físico de la mesa funciona siempre.
2. Una mesa libre no bloquea la carta ni el carrito.
3. El cliente puede recorrer categorías, agregar/quitar productos y revisar el pedido completo aunque la mesa siga libre.
4. No se crea ninguna solicitud de habilitación por escanear, navegar o modificar el carrito.
5. Sólo al pulsar **ENVIAR PEDIDO A COCINA** se consulta la sesión de mesa.
6. Si la mesa ya está abierta, el teléfono se autoriza sin PIN y el pedido continúa directamente.
7. Si la mesa está libre, aparece **HABILITAR MESA** y se crea una única solicitud pendiente para personal.
8. Mesero o Centro de Control pueden pulsar **HABILITAR MESA**.
9. La aprobación abre la sesión canónica de mesa; el cliente detecta la apertura y el pedido ya confirmado se envía automáticamente a Cocina/Barra.
10. Cobrar/cerrar la mesa termina la sesión. El QR sigue visible, pero el siguiente pedido volverá a requerir habilitación al confirmar.

La capa V56 corrige únicamente el momento del gate. V55 conserva las rutas de solicitud/aprobación y V54 conserva la autorización del teléfono sin PIN.