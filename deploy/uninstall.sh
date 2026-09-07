#!/usr/bin/env bash
# Remove as units do servBoard do systemd --user. Não apaga o código nem a config.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

node bin/servboard.js uninstall
echo "Feito. O código e config/servboard.json continuam no lugar."
