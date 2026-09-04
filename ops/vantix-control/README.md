# Vantix Control — Bootstrap inicial

Esta carpeta es temporal para arrancar el VPS dedicado del Centro de Operaciones Vantix. Cuando el repositorio privado `vantix-auxiliar` exista, estos archivos se moverán allí.

## Objetivo

La primera ejecución deja preparado un host Ubuntu/Debian con:

- Docker Engine + Compose;
- usuario de automatización `vantixbot`;
- estructura `/opt/vantix-control`;
- secretos locales en `/etc/vantix-control/core.env`;
- PostgreSQL 16 aislado en red Docker interna;
- UFW conservando el/los puertos SSH detectados;
- HTTP/HTTPS abiertos para el futuro portal;
- Fail2ban para SSH;
- archivo de estado `/opt/vantix-control/BOOTSTRAP_STATUS.txt`.

## Seguridad

El bootstrap deliberadamente **NO**:

- cambia ni elimina las claves SSH existentes;
- deshabilita root;
- deshabilita autenticación por contraseña;
- abre PostgreSQL a Internet;
- inserta tokens de GitHub, OpenAI, Claude, Gemini o Firebase;
- modifica aplicaciones existentes.

El endurecimiento final del SSH se hace únicamente después de verificar un segundo canal de acceso.

## Flujo después del bootstrap

```text
GitHub
  ↓
Vantix Control
  ↓
CI / pruebas
  ↓
Agente autorizado
  ↓
VPS destino
  ↓
deploy
  ↓
health check
  ↓
rollback automático si falla
```

## Estado esperado al finalizar

```text
VANTIX_CONTROL_BOOTSTRAP_OK=true
POSTGRES_HEALTH=healthy
NEXT=register_remote_agent_and_deploy_core
```

## Nota

No guardar credenciales reales en este repositorio. El portal usará una bóveda cifrada y las claves maestras permanecerán fuera de Git.
