import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { paths } from './paths.js';
import { createLogger } from './logger.js';

const execFileAsync = promisify(execFile);

const CANDIDATES = [
  'chromium',
  'chromium-browser',
  'google-chrome-stable',
  'google-chrome',
  'brave-browser',
  'microsoft-edge',
];

/** Acha um executável de navegador Chromium-like. Retorna o caminho ou null. */
export async function findBrowser(preferred = 'auto') {
  const list = preferred && preferred !== 'auto' ? [preferred, ...CANDIDATES] : CANDIDATES;
  for (const name of list) {
    // caminho absoluto informado na config
    if (name.includes('/')) {
      try {
        await execFileAsync(name, ['--version'], { timeout: 5000 });
        return name;
      } catch {
        continue;
      }
    }
    try {
      const { stdout } = await execFileAsync('bash', ['-lc', `command -v ${name}`], { timeout: 5000 });
      const path = stdout.trim();
      if (path) return path;
    } catch {
      /* tenta o próximo */
    }
  }
  return null;
}

/**
 * Sobe o navegador em modo kiosk apontando para `url`.
 * Retorna um handle com { process, stop() }.
 */
export async function launchKiosk(url, config, { logger = createLogger('kiosk') } = {}) {
  const bin = await findBrowser(config?.display?.browser);
  if (!bin) {
    throw new Error(
      'Nenhum navegador Chromium encontrado. Instale um: sudo apt install chromium ' +
        '(ou defina display.browser na config com o caminho do executável).',
    );
  }
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    throw new Error(
      'Sem sessão gráfica ($DISPLAY / $WAYLAND_DISPLAY vazios). ' +
        'Rode dentro da sessão do monitor do servidor.',
    );
  }

  await mkdir(paths.chromiumProfile, { recursive: true });

  const args = [
    `--user-data-dir=${paths.chromiumProfile}`,
    '--kiosk',
    `--app=${url}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-translate',
    '--disable-infobars',
    '--disable-session-crashed-bubble',
    '--disable-features=TranslateUI',
    '--check-for-update-interval=31536000',
    '--overscroll-history-navigation=0',
    '--noerrdialogs',
    '--incognito',
  ];

  logger.info(`abrindo ${bin} em kiosk -> ${url}`);
  const child = spawn(bin, args, { stdio: 'ignore', detached: false });

  let stopped = false;
  const stop = () => {
    if (stopped || child.exitCode !== null) return;
    stopped = true;
    logger.info('encerrando navegador');
    child.kill('SIGTERM');
    setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 3000).unref();
  };

  child.on('exit', (code, signal) => {
    logger.info(`navegador saiu (code=${code ?? '-'} signal=${signal ?? '-'})`);
  });

  return { process: child, stop, browserPath: bin };
}

/** Controla o DPMS/screensaver via xset (best-effort; ignora se não houver X). */
export async function setScreenPower(on) {
  if (!process.env.DISPLAY) return { ok: false, reason: 'sem $DISPLAY' };
  try {
    if (on) {
      await execFileAsync('xset', ['-dpms']);
      await execFileAsync('xset', ['s', 'off']);
      await execFileAsync('xset', ['dpms', 'force', 'on']);
    } else {
      await execFileAsync('xset', ['dpms', 'force', 'off']);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}
