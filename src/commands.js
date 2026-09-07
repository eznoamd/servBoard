import { existsSync } from 'node:fs';
import process from 'node:process';
import { paths } from './paths.js';
import { loadConfig, ConfigError } from './config.js';
import { resolveSlots, discoverSlots } from './slots.js';
import { runRefresh, readCache } from './refresh.js';
import { startServer } from './server.js';
import { launchKiosk, findBrowser, setScreenPower } from './kiosk.js';
import { toOnCalendar, validateOnCalendar, isWithinWindow } from './schedule.js';
import { installUnits, uninstallUnits } from './install.js';
import { createLogger } from './logger.js';

const logger = createLogger('cli');

/** doctor: valida ambiente e config sem alterar nada. */
export async function cmdDoctor() {
  let problems = 0;
  const ok = (m) => console.log(`  ok   ${m}`);
  const bad = (m) => {
    console.log(`  FALHA ${m}`);
    problems++;
  };
  const warn = (m) => console.log(`  aviso ${m}`);

  console.log('servBoard doctor\n');

  const [maj] = process.versions.node.split('.').map(Number);
  maj >= 20 ? ok(`Node ${process.versions.node}`) : bad(`Node ${process.versions.node} (precisa >= 20)`);

  let config;
  try {
    const loaded = await loadConfig();
    config = loaded.config;
    ok(`config: ${loaded.file}${loaded.usingExample ? ' (exemplo — crie config/servboard.json)' : ''}`);
  } catch (err) {
    bad(err.message.split('\n')[0]);
    for (const line of err.message.split('\n').slice(1)) console.log(`       ${line}`);
    console.log('\nCorrija a config antes de continuar.');
    return 1;
  }

  try {
    const slots = await resolveSlots(config);
    const enabled = slots.filter((s) => s.enabled);
    ok(`slots: ${slots.length} no disco, ${enabled.length} habilitados (${enabled.map((s) => s.id).join(', ') || '-'})`);
    for (const s of slots.filter((x) => x.enabled && !x.viewFile)) {
      warn(`slot "${s.id}" não tem view.js — vai renderizar como JSON cru`);
    }
  } catch (err) {
    bad(`slots: ${err.message}`);
  }

  const browser = await findBrowser(config.display.browser);
  browser ? ok(`navegador: ${browser}`) : bad('navegador Chromium não encontrado (sudo apt install chromium)');

  if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
    ok(`sessão gráfica: DISPLAY=${process.env.DISPLAY || ''} WAYLAND_DISPLAY=${process.env.WAYLAND_DISPLAY || ''}`);
  } else {
    warn('sem $DISPLAY/$WAYLAND_DISPLAY — "kiosk"/"show" só funcionam dentro da sessão do monitor');
  }

  for (const [label, expr] of [
    ['display.start', toOnCalendarSafe(config.display.start, config.display.days)],
    ['display.stop', toOnCalendarSafe(config.display.stop, config.display.days)],
    ['refresh.onCalendar', config.refresh.onCalendar],
  ]) {
    const res = await validateOnCalendar(expr);
    res.ok
      ? ok(`${label}: "${expr}"${res.next ? ` (próximo: ${res.next})` : ''}`)
      : bad(`${label}: "${expr}" inválido — ${res.reason || 'ver systemd-analyze calendar'}`);
  }

  try {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(paths.cacheDir, { recursive: true });
    ok(`cache gravável: ${paths.cacheDir}`);
  } catch (err) {
    bad(`cache: ${err.message}`);
  }

  console.log(`\n${problems === 0 ? 'Tudo certo.' : `${problems} problema(s) encontrado(s).`}`);
  return problems === 0 ? 0 : 1;
}

function toOnCalendarSafe(hhmm, days) {
  try {
    return toOnCalendar(hhmm, days);
  } catch (err) {
    return `<inválido: ${err.message}>`;
  }
}

/** refresh: roda os jobs dos slots e sai. */
export async function cmdRefresh(argv) {
  const { config } = await loadConfig();
  const only = collectFlag(argv, '--slot');
  const { results } = await runRefresh(config, { only: only.length ? only : undefined, logger });
  const failed = results.filter((r) => !r.ok);
  console.log(
    `\nrefresh: ${results.length - failed.length}/${results.length} ok` +
      (failed.length ? ` — falhou: ${failed.map((f) => f.id).join(', ')}` : ''),
  );
  return failed.length ? 1 : 0;
}

/** serve: sobe só o servidor web (foreground). */
export async function cmdServe() {
  const { config, usingExample } = await loadConfig();
  if (usingExample) logger.warn('usando config de exemplo — crie config/servboard.json');
  const { url } = await startServer(config, { logger });
  logger.info(`dashboard em ${url}`);
  logger.info('Ctrl-C para parar');
  await waitForSignal();
  return 0;
}

/**
 * within-window: exit 0 se AGORA está dentro da janela de exibição, 1 se não.
 * Usado pelo .xinitrc para reabrir a dashboard se o servidor reiniciar no meio
 * da janela (os timers só disparam nos horários exatos).
 */
export async function cmdWithinWindow(argv) {
  const { config } = await loadConfig();
  const inside = isWithinWindow(new Date(), {
    start: config.display.start,
    stop: config.display.stop,
    days: config.display.days,
    timezone: config.timezone,
  });
  if (!argv.includes('--quiet')) {
    console.log(
      inside
        ? `dentro da janela (${config.display.start}–${config.display.stop} ${config.display.days})`
        : `fora da janela (${config.display.start}–${config.display.stop} ${config.display.days})`,
    );
  }
  return inside ? 0 : 1;
}

/** wait-http: bloqueia até o servidor responder /api/health (usado pelas units). */
export async function cmdWaitHttp() {
  const { config } = await loadConfig();
  const url = `http://${config.server.host}:${config.server.port}/api/health`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return 0;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error(`wait-http: ${url} não respondeu em 30s`);
  return 1;
}

/** kiosk: sobe só o navegador apontando para a URL configurada. */
export async function cmdKiosk() {
  const { config } = await loadConfig();
  const url = `http://${config.server.host}:${config.server.port}`;
  if (config.display.powerManagement) await setScreenPower(true);
  const kiosk = await launchKiosk(url, config, { logger });
  const done = new Promise((res) => kiosk.process.on('exit', res));
  await Promise.race([done, waitForSignal()]);
  kiosk.stop();
  if (config.display.powerManagement) await setScreenPower(false);
  return 0;
}

/** show: modo teste completo — refresh + servidor + navegador juntos. */
export async function cmdShow() {
  const { config, usingExample } = await loadConfig();
  if (usingExample) logger.warn('usando config de exemplo — crie config/servboard.json');

  logger.info('refresh inicial...');
  await runRefresh(config, { logger: logger.child('refresh') });

  const { app, url } = await startServer(config, { logger });
  logger.info(`servidor em ${url}`);

  if (config.display.powerManagement) await setScreenPower(true);

  let kiosk;
  try {
    kiosk = await launchKiosk(url, config, { logger });
  } catch (err) {
    logger.error(err.message);
    logger.warn(`servidor continua no ar em ${url} — abra manualmente. Ctrl-C para parar.`);
    await waitForSignal();
    await app.close();
    return 1;
  }

  const browserClosed = new Promise((res) => kiosk.process.on('exit', res));
  await Promise.race([browserClosed, waitForSignal()]);

  logger.info('encerrando...');
  kiosk.stop();
  await app.close();
  if (config.display.powerManagement) await setScreenPower(false);
  return 0;
}

/** install / uninstall: units do systemd --user a partir da config. */
export async function cmdInstall(argv) {
  const { config, file, usingExample } = await loadConfig();
  if (usingExample) {
    console.error('Recuse: crie config/servboard.json antes de instalar (não instale a partir do exemplo).');
    return 1;
  }
  const dryRun = argv.includes('--dry-run');
  const res = await installUnits(config, { dryRun, sourceFile: file, logger });
  console.log(res.summary);
  return 0;
}

export async function cmdUninstall(argv) {
  const res = await uninstallUnits({ dryRun: argv.includes('--dry-run'), logger });
  console.log(res.summary);
  return 0;
}

export async function cmdList() {
  const { config } = await loadConfig();
  const slots = await resolveSlots(config).catch(() => discoverSlots().then((d) => d.map((s) => ({ ...s, enabled: false, title: s.meta.title, span: s.meta.span }))));
  console.log('slots:');
  for (const s of slots) {
    const cache = await readCache(s.id);
    const state = cache?.error ? `erro: ${cache.error}` : cache ? `atualizado ${cache.updatedAt}` : 'sem cache';
    console.log(`  ${s.enabled ? '[x]' : '[ ]'} ${s.id.padEnd(14)} span=${s.span}  ${state}`);
  }
  return 0;
}

// ---- helpers ----

function collectFlag(argv, name) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name && argv[i + 1]) out.push(argv[++i]);
    else if (argv[i].startsWith(`${name}=`)) out.push(argv[i].slice(name.length + 1));
  }
  return out;
}

function waitForSignal() {
  return new Promise((resolve) => {
    const handler = () => {
      process.off('SIGINT', handler);
      process.off('SIGTERM', handler);
      resolve('signal');
    };
    process.on('SIGINT', handler);
    process.on('SIGTERM', handler);
  });
}

export { ConfigError };
