import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { paths } from './paths.js';

/**
 * Um slot vive em slots/<id>/ com:
 *   slot.json   -> metadados default { id, title, span, refreshInterval }
 *   index.js    -> lógica server-side, exporta async refresh(ctx)
 *   view.js     -> render client-side, exporta render(el, data, ctx)   (opcional mas recomendado)
 *   view.css    -> estilos do slot                                     (opcional)
 */

async function readSlotJson(dir, id) {
  const file = join(dir, 'slot.json');
  const defaults = { id, title: id, span: 1, refreshInterval: null };
  if (!existsSync(file)) return defaults;
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    return { ...defaults, ...parsed, id };
  } catch (err) {
    throw new Error(`slots/${id}/slot.json inválido: ${err.message}`);
  }
}

/** Descobre todos os slots presentes no disco (independente da config). */
export async function discoverSlots() {
  if (!existsSync(paths.slotsDir)) return [];
  const entries = await readdir(paths.slotsDir, { withFileTypes: true });
  const slots = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    const dir = join(paths.slotsDir, id);
    const indexFile = join(dir, 'index.js');
    if (!existsSync(indexFile)) continue;
    const meta = await readSlotJson(dir, id);
    slots.push({
      id,
      dir,
      indexFile,
      viewFile: existsSync(join(dir, 'view.js')) ? join(dir, 'view.js') : null,
      cssFile: existsSync(join(dir, 'view.css')) ? join(dir, 'view.css') : null,
      meta,
    });
  }
  slots.sort((a, b) => a.id.localeCompare(b.id));
  return slots;
}

/** Importa o módulo server-side de um slot e valida a interface. */
export async function loadSlotModule(slot) {
  const mod = await import(pathToFileURL(slot.indexFile).href);
  if (typeof mod.refresh !== 'function') {
    throw new Error(`slots/${slot.id}/index.js precisa exportar "async function refresh(ctx)".`);
  }
  return mod;
}

/**
 * Resolve a lista efetiva de slots: cruza o que está no disco com o que a
 * config habilita, na ordem da config. Slots na config sem pasta viram erro.
 */
export async function resolveSlots(config) {
  const onDisk = await discoverSlots();
  const byId = new Map(onDisk.map((s) => [s.id, s]));

  const configured = config.slots ?? [];
  const missing = configured.filter((c) => !byId.has(c.id)).map((c) => c.id);
  if (missing.length) {
    throw new Error(
      `Config referencia slots que não existem em slots/: ${missing.join(', ')}`,
    );
  }

  // Ordem: primeiro os da config (na ordem dada), depois quaisquer outros do disco.
  const orderedIds = [
    ...configured.map((c) => c.id),
    ...onDisk.map((s) => s.id).filter((id) => !configured.some((c) => c.id === id)),
  ];

  return orderedIds.map((id) => {
    const disk = byId.get(id);
    const cfg = configured.find((c) => c.id === id) ?? { id, enabled: false, settings: {} };
    return {
      ...disk,
      config: cfg,
      enabled: cfg.enabled !== false,
      title: cfg.title ?? disk.meta.title,
      span: cfg.span ?? disk.meta.span ?? 1,
      settings: cfg.settings ?? {},
      refreshInterval: disk.meta.refreshInterval,
    };
  });
}

export async function enabledSlots(config) {
  return (await resolveSlots(config)).filter((s) => s.enabled);
}

export async function fileMtime(file) {
  try {
    return (await stat(file)).mtimeMs;
  } catch {
    return 0;
  }
}
