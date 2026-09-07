#!/usr/bin/env bash
#
# provision-base.sh — organiza um Debian recém-instalado (mínimo, sem interface).
# Rode como o SEU usuário administrador (o que tem sudo), NÃO como root:
#
#     sudo -v && ./deploy/provision-base.sh
#
# É idempotente: pode rodar de novo sem problema.
set -euo pipefail

TIMEZONE="${TIMEZONE:-America/Sao_Paulo}"
NODE_MAJOR="${NODE_MAJOR:-22}"
KIOSK_USER="${KIOSK_USER:-kiosk}"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!  %s\033[0m\n' "$*"; }

if [[ $EUID -eq 0 ]]; then
  echo "Não rode como root. Use seu usuário com sudo." >&2
  exit 1
fi
sudo -v

# ----------------------------------------------------------------------------
say "Atualizando o sistema"
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get -y full-upgrade

say "Instalando utilitários essenciais"
sudo DEBIAN_FRONTEND=noninteractive apt-get -y install \
  ca-certificates curl gnupg git rsync vim htop tmux \
  unattended-upgrades chrony ufw avahi-daemon libnss-mdns \
  jq unzip

# ----------------------------------------------------------------------------
say "Fuso horário e relógio (NTP via chrony)"
sudo timedatectl set-timezone "$TIMEZONE"
sudo systemctl enable --now chrony
timedatectl | sed 's/^/    /'

# ----------------------------------------------------------------------------
say "Atualizações de segurança automáticas (unattended-upgrades)"
sudo tee /etc/apt/apt.conf.d/20auto-upgrades >/dev/null <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
sudo systemctl enable --now unattended-upgrades

# ----------------------------------------------------------------------------
say "Firewall (ufw): nega entrada, libera SSH e mDNS"
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 5353/udp comment 'mDNS (avahi / .local)'
sudo ufw --force enable
sudo ufw status verbose | sed 's/^/    /'
warn "A dashboard escuta só em 127.0.0.1 — não precisa de porta liberada."

# ----------------------------------------------------------------------------
say "Node.js $NODE_MAJOR LTS (repositório NodeSource)"
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo DEBIAN_FRONTEND=noninteractive apt-get -y install nodejs
fi
echo "    node $(node --version) / npm $(npm --version)"

# ----------------------------------------------------------------------------
say "Estrutura de diretórios do servidor"
# /opt/<serviço>  -> código das aplicações (repositórios git)
# /srv/<serviço>  -> dados persistentes / volumes
# /srv/backups    -> destino de backups locais
sudo mkdir -p /opt /srv /srv/backups
sudo chmod 755 /opt /srv
cat <<EOF
    /opt/<serviço>   código das aplicações (ex.: /opt/servboard)
    /srv/<serviço>   dados persistentes de cada serviço
    /srv/backups     backups locais
EOF

# ----------------------------------------------------------------------------
say "Usuário dedicado da dashboard: $KIOSK_USER"
if ! id "$KIOSK_USER" >/dev/null 2>&1; then
  sudo adduser --disabled-password --gecos "" "$KIOSK_USER"
fi
# grupos necessários para a sessão gráfica no monitor físico
sudo usermod -aG video,input,tty,render,audio "$KIOSK_USER"
sudo passwd -l "$KIOSK_USER" >/dev/null   # sem login por senha; só autologin no console
echo "    $KIOSK_USER criado (sem sudo, sem senha, grupos: video input tty render audio)"

# ----------------------------------------------------------------------------
say "Base pronta."
cat <<EOF

Próximos passos:
  1. (opcional) definir o hostname:   sudo hostnamectl set-hostname servboard
  2. garantir acesso SSH por chave e depois desabilitar senha:
       ssh-copy-id $USER@<ip-do-servidor>      # da sua máquina
       sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
       sudo systemctl restart ssh
  3. clonar o servBoard e rodar o provisionamento do kiosk:
       sudo git clone <URL-do-repo> /opt/servboard
       sudo /opt/servboard/deploy/provision-kiosk.sh
EOF
