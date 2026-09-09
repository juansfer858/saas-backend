# Restaurant V2 · aislamiento de overlays V1

El Centro de Control V2 suprime el dock legacy `#restaurantAccountAttentionDock` cuando:

- hay un workspace V2 abierto; o
- P10 está activo para el tenant.

La ruta de rollback `/app/restaurante-v1` no usa el bridge V2, por lo que conserva el comportamiento V1 completo.
