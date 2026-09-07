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
