#!/usr/bin/env bash
# Instala o servBoard como serviço agendado, via systemd --user.
# Rode como o usuário que fica logado na sessão gráfica do monitor — NÃO como root.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ $EUID -eq 0 ]]; then
  echo "Não rode como root. Use o usuário da sessão gráfica do monitor." >&2
  exit 1
fi

echo "==> Node: $(node --version 2>/dev/null || echo 'AUSENTE')"
command -v node >/dev/null || { echo "Instale o Node >= 20 primeiro."; exit 1; }

echo "==> Instalando dependências (npm ci --omit=dev)"
npm ci --omit=dev

if [[ ! -f config/servboard.json ]]; then
  echo "==> Criando config/servboard.json a partir do exemplo — edite os horários depois"
  cp config/servboard.example.json config/servboard.json
fi

echo "==> Validando ambiente"
node bin/servboard.js doctor || {
  echo
  echo "doctor apontou problemas. Corrija config/servboard.json e rode de novo." >&2
  exit 1
}

echo "==> Instalando units do systemd --user"
node bin/servboard.js install

echo
echo "Pronto. Comandos úteis:"
echo "  systemctl --user list-timers | grep servboard"
echo "  systemctl --user start servboard-web.service     # testar agora"
echo "  systemctl --user stop  servboard-web.service"
echo "  journalctl --user -u servboard-web.service -f    # logs"
