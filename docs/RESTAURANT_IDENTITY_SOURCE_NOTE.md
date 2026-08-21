# Nota de fuente visual — La Riel

La integración `Restaurant Identity Connected V1` usa un preset central `LA_RIEL_V1` con los nombres de token requeridos (`char`, `bone`, `ember`, `verdigris`, `brass`) y un ThemeProvider configurable por tenant.

El artefacto histórico citado como `restaurante_identidad_v1.html` no forma parte del repositorio `saas-backend` ni fue localizado en la biblioteca de archivos disponible durante esta integración. Por esa razón, esta rama no declara que los valores hexadecimales reconstruidos sean una copia byte-a-byte del artefacto histórico.

Esto no afecta la arquitectura ni la conexión funcional: cuando el artefacto histórico esté disponible, sus valores exactos de paleta/tipografía se sustituyen únicamente en el preset/tema; no se cambia ninguna consulta, endpoint, RBAC, pedido, comanda, QR ni cierre de caja.
