#!/usr/bin/env bash
set -Eeuo pipefail

CONTROL_ROOT="/opt/vantix-control"
SERVICE_USER="vantixbot"
ENV_DIR="/etc/vantix-control"
ENV_FILE="$ENV_DIR/core.env"
COMPOSE_FILE="$CONTROL_ROOT/docker-compose.bootstrap.yml"

log(){ printf '\n[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
fail(){ echo "ERROR: $*" >&2; exit 1; }

[[ "${EUID}" -eq 0 ]] || fail "Ejecuta este instalador con sudo/root."
command -v apt-get >/dev/null 2>&1 || fail "Esta primera versión soporta Ubuntu/Debian."

log "Actualizando paquetes base"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg openssl ufw fail2ban git jq rsync unzip

if ! command -v docker >/dev/null 2>&1; then
  log "Instalando Docker Engine desde el repositorio oficial"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/$(. /etc/os-release; echo "$ID")/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$ID $VERSION_CODENAME stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

systemctl enable --now docker

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  log "Creando usuario de automatización $SERVICE_USER"
  useradd --create-home --shell /bin/bash "$SERVICE_USER"
fi
usermod -aG docker "$SERVICE_USER"

log "Creando estructura aislada"
install -d -m 0750 -o root -g "$SERVICE_USER" \
  "$CONTROL_ROOT" \
  "$CONTROL_ROOT/app" \
  "$CONTROL_ROOT/data/postgres" \
  "$CONTROL_ROOT/backups" \
  "$CONTROL_ROOT/logs" \
  "$CONTROL_ROOT/runner"
install -d -m 0750 -o root -g "$SERVICE_USER" "$CONTROL_ROOT/secrets"
install -d -m 0750 -o root -g "$SERVICE_USER" "$ENV_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  log "Generando secretos locales del núcleo"
  PG_PASSWORD="$(openssl rand -base64 36 | tr -d '\n')"
  SESSION_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
  VAULT_MASTER_KEY="$(openssl rand -base64 32 | tr -d '\n')"
  umask 027
  cat > "$ENV_FILE" <<EOF
POSTGRES_DB=vantix_auxiliar
POSTGRES_USER=vantix_auxiliar
POSTGRES_PASSWORD=$PG_PASSWORD
SESSION_SECRET=$SESSION_SECRET
VAULT_MASTER_KEY=$VAULT_MASTER_KEY
EOF
  chown root:"$SERVICE_USER" "$ENV_FILE"
  chmod 0640 "$ENV_FILE"
fi

log "Creando PostgreSQL aislado para Vantix Control"
cat > "$COMPOSE_FILE" <<'YAML'
services:
  postgres:
    image: postgres:16-alpine
    container_name: vantix-control-postgres
    restart: unless-stopped
    env_file:
      - /etc/vantix-control/core.env
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - /opt/vantix-control/data/postgres:/var/lib/postgresql/data
    networks:
      - control_internal
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 5s
      timeout: 3s
      retries: 20
    security_opt:
      - no-new-privileges:true

networks:
  control_internal:
    name: vantix-control-internal
    internal: true
YAML
chmod 0640 "$COMPOSE_FILE"
chown root:"$SERVICE_USER" "$COMPOSE_FILE"

log "Configurando firewall sin alterar el puerto SSH actual"
SSH_PORTS="$(sshd -T 2>/dev/null | awk '$1=="port"{print $2}' | sort -u || true)"
[[ -n "$SSH_PORTS" ]] || SSH_PORTS="22"
ufw default deny incoming
ufw default allow outgoing
while read -r port; do
  [[ -n "$port" ]] && ufw allow "${port}/tcp" comment 'SSH'
done <<< "$SSH_PORTS"
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable

log "Configurando Fail2ban para SSH"
cat > /etc/fail2ban/jail.d/vantix-control.conf <<'EOF'
[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
banaction = ufw
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

log "Arrancando PostgreSQL"
cd "$CONTROL_ROOT"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d

log "Verificando salud"
for i in $(seq 1 30); do
  status="$(docker inspect -f '{{.State.Health.Status}}' vantix-control-postgres 2>/dev/null || true)"
  [[ "$status" == "healthy" ]] && break
  sleep 2
done
status="$(docker inspect -f '{{.State.Health.Status}}' vantix-control-postgres 2>/dev/null || true)"
[[ "$status" == "healthy" ]] || fail "PostgreSQL no quedó healthy. Revisa: docker logs vantix-control-postgres"

cat > "$CONTROL_ROOT/BOOTSTRAP_STATUS.txt" <<EOF
VANTIX_CONTROL_BOOTSTRAP_OK=true
DATE=$(date -Is)
HOST=$(hostname -f 2>/dev/null || hostname)
SERVICE_USER=$SERVICE_USER
POSTGRES_HEALTH=$status
FIREWALL=enabled
FAIL2BAN=enabled
SECRETS_FILE=$ENV_FILE
NEXT=register_remote_agent_and_deploy_core
EOF
chmod 0640 "$CONTROL_ROOT/BOOTSTRAP_STATUS.txt"
chown root:"$SERVICE_USER" "$CONTROL_ROOT/BOOTSTRAP_STATUS.txt"

log "Bootstrap completado"
echo "VANTIX_CONTROL_BOOTSTRAP_OK=true"
echo "POSTGRES_HEALTH=$status"
echo "NEXT=register_remote_agent_and_deploy_core"
echo
printf 'No se deshabilitó root ni autenticación SSH existente. Ese endurecimiento se hará después de verificar el acceso remoto.\n'
