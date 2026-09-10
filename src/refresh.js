import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { paths, cacheFileFor, stateFileFor } from './paths.js';
import { enabledSlots, loadSlotModule } from './slots.js';
import { createLogger } from './logger.js';

/** Estado persistente por slot (data/state/<id>.json) — para acumuladores, EMA, etc. */
async function readState(slotId) {
  const file = stateFileFor(slotId);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function writeState(slotId, obj) {
  await mkdir(paths.stateDir, { recursive: true });
  await writeFile(stateFileFor(slotId), JSON.stringify(obj ?? null, null, 2) + '\n', 'utf8');
}

/** Lê o cache de um slot; devolve null se ainda não existe. */
export async function readCache(slotId) {
  const file = cacheFileFor(slotId);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function writeCache(slotId, entry) {
  await mkdir(paths.cacheDir, { recursive: true });
  await writeFile(cacheFileFor(slotId), JSON.stringify(entry, null, 2) + '\n', 'utf8');
}

/**
 * Roda o refresh() dos slots habilitados e grava data/cache/<id>.json.
 * @param {object} config
 * @param {object} [opts]
 * @param {string[]} [opts.only] - restringe a estes ids
 * @returns {Promise<{ results: Array<{id, ok, ms, error?}> }>}
 */
export async function runRefresh(config, { only, logger = createLogger('refresh') } = {}) {
  let slots = await enabledSlots(config);
  if (only?.length) {
    slots = slots.filter((s) => only.includes(s.id));
    const found = new Set(slots.map((s) => s.id));
    for (const id of only) {
      if (!found.has(id)) logger.warn(`slot "${id}" não está habilitado ou não existe — ignorado.`);
    }
  }

  const results = [];
  for (const slot of slots) {
    const started = Date.now();
    const ctx = {
      settings: slot.settings,
      config: { timezone: config.timezone },
      now: new Date(),
      logger: logger.child(slot.id),
      // estado persistente do slot entre refreshes
      readState: () => readState(slot.id),
      writeState: (obj) => writeState(slot.id, obj),
    };
    try {
      const mod = await loadSlotModule(slot);
      const data = await mod.refresh(ctx);
      const ms = Date.now() - started;
      await writeCache(slot.id, {
        slot: slot.id,
        data: data ?? null,
        updatedAt: new Date().toISOString(),
        durationMs: ms,
        error: null,
      });
      results.push({ id: slot.id, ok: true, ms });
      logger.info(`${slot.id}: ok (${ms}ms)`);
    } catch (err) {
      const ms = Date.now() - started;
      const prev = await readCache(slot.id);
      await writeCache(slot.id, {
        slot: slot.id,
        data: prev?.data ?? null, // mantém o último dado bom
        updatedAt: prev?.updatedAt ?? null,
        failedAt: new Date().toISOString(),
        durationMs: ms,
        error: err.message,
      });
      results.push({ id: slot.id, ok: false, ms, error: err.message });
      logger.error(`${slot.id}: falhou — ${err.message}`);
    }
  }

  return { results };
}

/**
 * Converte "30s" | "5m" | "2h" | 15 (número = minutos) em milissegundos.
 * Valor ausente/inválido cai para `fallbackMs`.
 */
export function parseInterval(value, fallbackMs) {
  if (value == null || value === '') return fallbackMs;
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value * 60_000 : fallbackMs;
  }
  const m = /^(\d+(?:\.\d+)?)\s*(s|m|h)?$/.exec(String(value).trim());
  if (!m) return fallbackMs;
  const mult = m[2] === 's' ? 1000 : m[2] === 'h' ? 3_600_000 : 60_000;
  return Math.max(1000, Math.round(Number(m[1]) * mult));
}

const LOOP_RESOLUTION_MS = 15_000;

/**
 * Loop de atualização para o servidor sempre-ativo. Cada slot é atualizado no
 * seu próprio `refreshInterval` (slot.json), caindo para
 * `config.refresh.everyMinutes` quando o slot não define um.
 *
 * @returns {{ firstRun: Promise<void>, stop: () => void }}
 */
export function startRefreshLoop(config, { logger = createLogger('refresh') } = {}) {
  const globalMs = Math.max(1, Number(config.refresh?.everyMinutes) || 15) * 60_000;
  const nextDue = new Map(); // id -> timestamp em que o slot volta a ser devido
  let running = false;
  let stopped = false;

  async function tick() {
    if (running || stopped) return;
    running = true;
    try {
      const slots = await enabledSlots(config);
      const now = Date.now();
      const live = new Set();
      const due = [];
      for (const slot of slots) {
        live.add(slot.id);
        const everyMs = parseInterval(slot.refreshInterval, globalMs);
        if (now >= (nextDue.get(slot.id) ?? 0)) {
          due.push(slot.id);
          nextDue.set(slot.id, now + everyMs);
        }
      }
      for (const id of [...nextDue.keys()]) if (!live.has(id)) nextDue.delete(id);
      if (due.length) await runRefresh(config, { only: due, logger });
    } catch (err) {
      logger.error(`loop de refresh: ${err.message}`);
    } finally {
      running = false;
    }
  }

  const firstRun = config.refresh?.onStart === false ? Promise.resolve() : tick();
  const timer = setInterval(tick, LOOP_RESOLUTION_MS);

  return {
    firstRun,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
