#!/usr/bin/env bash
set -euo pipefail

ROOT=/opt/vantix-saas/p15-backup-receiver
DATA=/opt/vantix-saas/data/p15-backups
SECRETS=/opt/vantix-saas/secrets
SERVICE=/etc/systemd/system/vantix-p15-backup-receiver.service
SOURCE=${1:-./cloud-backup-receiver.js}

if [[ ${EUID} -ne 0 ]]; then
  echo 'Ejecuta como root/sudo.' >&2
  exit 1
fi

id vantix >/dev/null 2>&1 || { echo 'No existe usuario vantix.' >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo 'Node.js no instalado.' >&2; exit 1; }
[[ -f "$SOURCE" ]] || { echo "No existe $SOURCE" >&2; exit 1; }

install -d -m 0750 -o vantix -g vantix "$ROOT" "$DATA"
install -d -m 0700 -o root -g root "$SECRETS"
install -m 0640 -o vantix -g vantix "$SOURCE" "$ROOT/cloud-backup-receiver.js"

ENV_FILE="$SECRETS/p15-backup-receiver.env"
if [[ ! -f "$ENV_FILE" ]]; then
  TOKEN=$(openssl rand -hex 32)
  cat >"$ENV_FILE" <<EOF
P15_BACKUP_RECEIVER_HOST=127.0.0.1
P15_BACKUP_RECEIVER_PORT=18915
P15_BACKUP_RECEIVER_TOKEN=$TOKEN
P15_BACKUP_STORAGE_DIR=$DATA
P15_BACKUP_MAX_BYTES=2147483648
EOF
  chmod 0600 "$ENV_FILE"
  echo "TOKEN_GENERATED=$TOKEN"
fi

install -m 0644 "$(dirname "$0")/p15-backup-receiver.service" "$SERVICE"
systemctl daemon-reload
systemctl enable --now vantix-p15-backup-receiver.service
sleep 1
curl -fsS http://127.0.0.1:18915/health
echo
echo 'P15_BACKUP_RECEIVER_INSTALLED'
