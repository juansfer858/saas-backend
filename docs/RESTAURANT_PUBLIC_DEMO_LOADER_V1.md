# Restaurant Public Demo Loader V1

Hotfix visual para `/restaurantes/demo`.

La sesión demo y el iframe V2 ya cargaban correctamente, pero la capa `.demo-loading` conservaba `display:grid` aunque el código aplicara `hidden=true`. El hotfix hace explícito el cierre del overlay mediante `.demo-loading[hidden]{display:none!important}` y `loading.style.display='none'` en `iframe.onload`.

No modifica tenant demo, autenticación, Caja, KDS, Pedidos, División ni lógica V2.
