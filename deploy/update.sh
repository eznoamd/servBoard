#!/usr/bin/env bash
# Atualiza o servBoard já instalado no servidor. Rode com sudo.
set -euo pipefail

KIOSK_USER="${KIOSK_USER:-kiosk}"
APP_DIR="${APP_DIR:-/opt/servboard}"
KUID="$(id -u "$KIOSK_USER")"
run_kiosk() { sudo -u "$KIOSK_USER" env XDG_RUNTIME_DIR="/run/user/$KUID" \
  DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$KUID/bus" "$@"; }

[[ $EUID -eq 0 ]] || { echo "Rode com sudo." >&2; exit 1; }

cd "$APP_DIR"
git pull --ff-only
chown -R "$KIOSK_USER":"$KIOSK_USER" "$APP_DIR"
run_kiosk bash -lc "cd '$APP_DIR' && npm ci --omit=dev"
run_kiosk /usr/local/bin/servboard doctor
run_kiosk /usr/local/bin/servboard install         # re-gera units (horários podem ter mudado)
run_kiosk systemctl --user restart servboard-web.service 2>/dev/null || true
echo "servBoard atualizado."
