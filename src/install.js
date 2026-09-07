import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { paths } from './paths.js';
import { toOnCalendar } from './schedule.js';
import { createLogger } from './logger.js';

const execFileAsync = promisify(execFile);
const USER_UNIT_DIR = join(homedir(), '.config', 'systemd', 'user');

const UNIT_NAMES = [
  'servboard-refresh.service',
  'servboard-refresh.timer',
  'servboard-web.service',
  'servboard-kiosk.service',
  'servboard-display.timer',
  'servboard-display-stop.service',
  'servboard-display-stop.timer',
];

function nodeBin() {
  return process.execPath;
}
function cli() {
  return join(paths.bin, 'servboard.js');
}

/** Gera o conteúdo de todas as units a partir da config. */
export function renderUnits(config) {
  const node = nodeBin();
  const entry = cli();
  const wd = paths.root;
  const startCal = toOnCalendar(config.display.start, config.display.days);
  const stopCal = toOnCalendar(config.display.stop, config.display.days);
  const pm = config.display.powerManagement;
  const xDisplay = config.display.xDisplay || ':0';

  const units = {};

  units['servboard-refresh.service'] = ini('Unit', {
    Description: 'servBoard — refresh dos slots (job pontual)',
  }) + ini('Service', {
    Type: 'oneshot',
    WorkingDirectory: wd,
    ExecStart: `${node} ${entry} refresh`,
  });

  units['servboard-refresh.timer'] = ini('Unit', {
    Description: 'servBoard — agenda de refresh dos slots',
  }) + ini('Timer', {
    OnCalendar: config.refresh.onCalendar,
    Persistent: 'true',
  }) + ini('Install', { WantedBy: 'timers.target' });

  units['servboard-web.service'] = ini('Unit', {
    Description: 'servBoard — servidor web da dashboard',
    Wants: 'servboard-kiosk.service',
  }) + ini('Service', {
    Type: 'simple',
    WorkingDirectory: wd,
    Environment: `SERVBOARD_LOG_LEVEL=info`,
    ...(config.refresh.runBeforeDisplay
      ? { ExecStartPre: `${node} ${entry} refresh` }
      : {}),
    ExecStart: `${node} ${entry} serve`,
    Restart: 'on-failure',
    RestartSec: '3',
  });

  units['servboard-kiosk.service'] = ini('Unit', {
    Description: 'servBoard — navegador em modo kiosk',
    BindsTo: 'servboard-web.service',
    After: 'servboard-web.service graphical-session.target',
    PartOf: 'servboard-web.service',
  }) + ini('Service', {
    Type: 'simple',
    WorkingDirectory: wd,
    Environment: `DISPLAY=${xDisplay}`,
    // espera o servidor responder antes de abrir o navegador
    ExecStartPre: `${node} ${entry} wait-http`,
    ExecStart: `${node} ${entry} kiosk`,
    ...(pm ? { ExecStopPost: `-/usr/bin/xset -display ${xDisplay} dpms force off` } : {}),
    Restart: 'on-failure',
    RestartSec: '3',
  });

  units['servboard-display.timer'] = ini('Unit', {
    Description: 'servBoard — liga a dashboard no horário de início',
  }) + ini('Timer', {
    OnCalendar: startCal,
    Persistent: 'false',
  }) + ini('Install', { WantedBy: 'timers.target' });

  units['servboard-display-stop.service'] = ini('Unit', {
    Description: 'servBoard — desliga a dashboard',
  }) + ini('Service', {
    Type: 'oneshot',
    Environment: `DISPLAY=${xDisplay}`,
    ExecStart: `/usr/bin/systemctl --user stop servboard-web.service`,
    ...(pm ? { ExecStartPost: `-/usr/bin/xset -display ${xDisplay} dpms force off` } : {}),
  });

  units['servboard-display-stop.timer'] = ini('Unit', {
    Description: 'servBoard — liga o desligamento da dashboard no horário de término',
  }) + ini('Timer', {
    OnCalendar: stopCal,
    Persistent: 'false',
  }) + ini('Install', { WantedBy: 'timers.target' });

  // display.timer precisa apontar para servboard-web.service; feito via Unit= no [Timer]
  units['servboard-display.timer'] = units['servboard-display.timer'].replace(
    '[Timer]\n',
    '[Timer]\nUnit=servboard-web.service\n',
  );

  return units;
}

function ini(section, kv) {
  let out = `[${section}]\n`;
  for (const [k, v] of Object.entries(kv)) out += `${k}=${v}\n`;
  return out + '\n';
}

async function systemctlUser(args) {
  try {
    const { stdout } = await execFileAsync('systemctl', ['--user', ...args], { timeout: 10000 });
    return { ok: true, stdout };
  } catch (err) {
    return { ok: false, error: (err.stderr || err.message || '').trim() };
  }
}

export async function installUnits(config, { dryRun = false, sourceFile, logger = createLogger('install') } = {}) {
  const units = renderUnits(config);
  const lines = [];

  if (dryRun) {
    lines.push(`# dry-run — nada foi escrito. Destino: ${USER_UNIT_DIR}\n`);
    for (const [name, content] of Object.entries(units)) {
      lines.push(`### ${name}\n${content}`);
    }
    return { summary: lines.join('\n') };
  }

  await mkdir(USER_UNIT_DIR, { recursive: true });
  for (const [name, content] of Object.entries(units)) {
    const dest = join(USER_UNIT_DIR, name);
    await writeFile(dest, content, 'utf8');
    logger.info(`escrito ${dest}`);
  }

  const enableLinger = await execFileAsync('loginctl', ['enable-linger', process.env.USER || ''])
    .then(() => 'enable-linger ok')
    .catch((e) => `enable-linger falhou (rode manualmente: sudo loginctl enable-linger $USER) — ${(e.stderr || e.message).trim()}`);

  const reload = await systemctlUser(['daemon-reload']);
  const enable = await systemctlUser([
    'enable',
    '--now',
    'servboard-refresh.timer',
    'servboard-display.timer',
    'servboard-display-stop.timer',
  ]);

  lines.push('servBoard instalado (systemd --user).');
  lines.push(`  units: ${USER_UNIT_DIR}`);
  lines.push(`  config: ${sourceFile}`);
  lines.push(`  ${enableLinger}`);
  lines.push(`  daemon-reload: ${reload.ok ? 'ok' : reload.error}`);
  lines.push(`  timers: ${enable.ok ? 'habilitados' : enable.error}`);
  lines.push('');
  lines.push('Verifique:  systemctl --user list-timers | grep servboard');
  lines.push('Testar já:  systemctl --user start servboard-web.service');
  lines.push('Parar:      systemctl --user stop servboard-web.service');
  return { summary: lines.join('\n') };
}

export async function uninstallUnits({ dryRun = false, logger = createLogger('install') } = {}) {
  const lines = [];
  if (!dryRun) {
    await systemctlUser([
      'disable',
      '--now',
      'servboard-refresh.timer',
      'servboard-display.timer',
      'servboard-display-stop.timer',
    ]);
    await systemctlUser(['stop', 'servboard-web.service']);
  }
  for (const name of UNIT_NAMES) {
    const dest = join(USER_UNIT_DIR, name);
    if (existsSync(dest)) {
      if (!dryRun) await rm(dest);
      logger.info(`${dryRun ? '[dry] ' : ''}removido ${dest}`);
      lines.push(`  ${dryRun ? '[dry] ' : ''}removido ${name}`);
    }
  }
  if (!dryRun) await systemctlUser(['daemon-reload']);
  lines.unshift('servBoard removido do systemd --user.');
  return { summary: lines.join('\n') };
}

export { USER_UNIT_DIR, UNIT_NAMES };
