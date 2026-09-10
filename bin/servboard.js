#!/usr/bin/env node
import {
  cmdDoctor,
  cmdRefresh,
  cmdServe,
  cmdKiosk,
  cmdShow,
  cmdWaitHttp,
  cmdInstall,
  cmdUninstall,
  cmdList,
  cmdNewSlot,
  ConfigError,
} from '../src/commands.js';

const USAGE = `servBoard — dashboard em kiosk para servidor doméstico

Uso: servboard <comando> [opções]

Comandos:
  doctor              Valida ambiente e configuração (não altera nada)
  refresh [--slot id] Roda o refresh() dos slots, grava o cache e sai
  serve               Sobe o servidor web + o loop de refresh dos slots  [foreground]
  kiosk               Sobe só o navegador em modo kiosk            [foreground]
  show                Modo teste: servidor + refresh + navegador   [foreground]
  list                Lista os slots e o estado do cache
  new-slot <id>       Cria o esqueleto de um slot [--path <pasta>]
  install [--dry-run] Gera/ativa as units do systemd --user a partir da config
  uninstall [--dry-run]  Remove as units do systemd --user
  wait-http           (uso interno) espera o servidor responder

Config: config/servboard.json  (cai para config/servboard.example.json se ausente)
Logs:   SERVBOARD_LOG_LEVEL=debug|info|warn|error
`;

const [cmd, ...argv] = process.argv.slice(2);

const table = {
  doctor: cmdDoctor,
  refresh: cmdRefresh,
  serve: cmdServe,
  kiosk: cmdKiosk,
  show: cmdShow,
  list: cmdList,
  'new-slot': cmdNewSlot,
  install: cmdInstall,
  uninstall: cmdUninstall,
  'wait-http': cmdWaitHttp,
};

async function main() {
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    console.log(USAGE);
    return 0;
  }
  const fn = table[cmd];
  if (!fn) {
    console.error(`comando desconhecido: ${cmd}\n`);
    console.error(USAGE);
    return 2;
  }
  return (await fn(argv)) ?? 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    if (err instanceof ConfigError) {
      console.error(err.message);
    } else {
      console.error(err?.stack || String(err));
    }
    process.exit(1);
  });
