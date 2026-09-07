#!/usr/bin/env bash
#
# provision-kiosk.sh — instala a pilha gráfica mínima (X + openbox), o login
# automático no monitor e o servBoard, tudo sob o usuário dedicado `kiosk`.
#
# Rode com sudo, a partir do repositório já clonado em /opt/servboard:
#
#     sudo /opt/servboard/deploy/provision-kiosk.sh
#
# Idempotente. Requer que deploy/provision-base.sh já tenha rodado.
set -euo pipefail

KIOSK_USER="${KIOSK_USER:-kiosk}"
APP_DIR="${APP_DIR:-/opt/servboard}"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!  %s\033[0m\n' "$*"; }

[[ $EUID -eq 0 ]] || { echo "Rode com sudo." >&2; exit 1; }
id "$KIOSK_USER" >/dev/null 2>&1 || { echo "Usuário '$KIOSK_USER' não existe — rode provision-base.sh antes." >&2; exit 1; }
[[ -f "$APP_DIR/bin/servboard.js" ]] || { echo "$APP_DIR não parece o servBoard (falta bin/servboard.js)." >&2; exit 1; }

KUID="$(id -u "$KIOSK_USER")"
run_kiosk() { sudo -u "$KIOSK_USER" env XDG_RUNTIME_DIR="/run/user/$KUID" \
  DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$KUID/bus" "$@"; }

# ----------------------------------------------------------------------------
say "Pilha gráfica mínima + Chromium"
DEBIAN_FRONTEND=noninteractive apt-get -y install \
  xserver-xorg xserver-xorg-legacy xinit x11-xserver-utils \
  openbox unclutter chromium fonts-noto fonts-noto-color-emoji

# Permite o X ser iniciado pelo usuário logado no console (autologin do tty1).
tee /etc/X11/Xwrapper.config >/dev/null <<'EOF'
allowed_users=console
needs_root_rights=yes
EOF

# ----------------------------------------------------------------------------
say "Código do servBoard em $APP_DIR"
chown -R "$KIOSK_USER":"$KIOSK_USER" "$APP_DIR"
run_kiosk bash -lc "cd '$APP_DIR' && npm ci --omit=dev"

if [[ ! -f "$APP_DIR/config/servboard.json" ]]; then
  run_kiosk cp "$APP_DIR/config/servboard.example.json" "$APP_DIR/config/servboard.json"
  warn "criado config/servboard.json a partir do exemplo — edite os horários depois"
fi

# `servboard` no PATH (o shebang usa /usr/bin/env node)
ln -sfn "$APP_DIR/bin/servboard.js" /usr/local/bin/servboard
echo "    /usr/local/bin/servboard -> $APP_DIR/bin/servboard.js"

# ----------------------------------------------------------------------------
say "Login automático do usuário $KIOSK_USER no tty1"
mkdir -p /etc/systemd/system/getty@tty1.service.d
tee /etc/systemd/system/getty@tty1.service.d/autologin.conf >/dev/null <<EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $KIOSK_USER --noclear %I \$TERM
EOF
systemctl daemon-reload

say "Perfil de shell e sessão X do usuário $KIOSK_USER"
install -o "$KIOSK_USER" -g "$KIOSK_USER" -m 0644 "$APP_DIR/deploy/kiosk/bash_profile" "/home/$KIOSK_USER/.bash_profile"
install -o "$KIOSK_USER" -g "$KIOSK_USER" -m 0755 "$APP_DIR/deploy/kiosk/xinitrc" "/home/$KIOSK_USER/.xinitrc"

# ----------------------------------------------------------------------------
say "Habilitando o gerenciador systemd --user do $KIOSK_USER (linger)"
loginctl enable-linger "$KIOSK_USER"
for _ in $(seq 1 20); do [[ -S "/run/user/$KUID/bus" ]] && break; sleep 0.5; done

say "Validando ambiente (servboard doctor)"
run_kiosk /usr/local/bin/servboard doctor || {
  warn "doctor apontou problemas. Alguns só passam depois do primeiro boot gráfico"
  warn "(ex.: \$DISPLAY). Corrija a config e siga."
}

say "Instalando os timers do systemd --user (servboard install)"
run_kiosk /usr/local/bin/servboard install

# ----------------------------------------------------------------------------
say "Kiosk provisionado."
cat <<EOF

Edite os horários e os slots:
    sudo -u $KIOSK_USER vim $APP_DIR/config/servboard.json
    sudo -u $KIOSK_USER servboard install     # re-gera os timers após mudar horários

Depois:
    sudo reboot

No boot: tty1 faz autologin -> startx -> openbox. Dentro da janela de exibição
a dashboard abre sozinha; fora dela, a tela fica apagada até o display.start.

Teste manual (sem esperar o horário), como o usuário $KIOSK_USER:
    systemctl --user start servboard-web.service     # liga agora
    systemctl --user stop  servboard-web.service     # desliga agora
    journalctl --user -u servboard-web.service -f    # logs
EOF
