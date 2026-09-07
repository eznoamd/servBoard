import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, isAbsolute, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { paths } from './paths.js';

/**
 * Um slot vive em <root>/<id>/ com:
 *   slot.json   -> metadados default { id, title, span, refreshInterval }
 *   index.js    -> lógica server-side, exporta async refresh(ctx)
 *   view.js     -> render client-side, exporta render(el, data, ctx)   (opcional mas recomendado)
 *   view.css    -> estilos do slot                                     (opcional)
 *
 * <root> pode ser a pasta slots/ do próprio repo OU uma pasta externa
 * (config.slotPaths / env SERVBOARD_SLOTS_PATH) — ver resolveSlotRoots().
 */

/** Expande "~", torna absoluto (relativo à raiz do projeto). */
function expandPath(p) {
  const raw = String(p).trim();
  if (raw === '~') return homedir();
  if (raw.startsWith('~/')) return join(homedir(), raw.slice(2));
  return isAbsolute(raw) ? raw : resolve(paths.root, raw);
}

/**
 * Lista ordenada de pastas onde procurar slots, sem duplicatas.
 * Prioridade (primeiro vence em caso de mesmo id):
 *   1. env SERVBOARD_SLOTS_PATH (separado por ":")
 *   2. config.slotPaths (na ordem dada)
 *   3. slots/ do próprio repositório (menor prioridade)
 */
export function resolveSlotRoots(config = {}) {
  const roots = [];
  const seen = new Set();
  const add = (p) => {
    const abs = expandPath(p);
    if (!seen.has(abs)) {
      seen.add(abs);
      roots.push(abs);
    }
  };
  for (const p of (process.env.SERVBOARD_SLOTS_PATH || '')
    .split(':')
    .map((s) => s.trim())
    .filter(Boolean)) {
    add(p);
  }
  for (const p of config.slotPaths ?? []) add(p);
  add(paths.slotsDir);
  return roots;
}

async function readSlotJson(dir, id) {
  const file = join(dir, 'slot.json');
  const defaults = { id, title: id, span: 1, refreshInterval: null };
  if (!existsSync(file)) return defaults;
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    return { ...defaults, ...parsed, id };
  } catch (err) {
    throw new Error(`${id}/slot.json inválido: ${err.message}`);
  }
}

/**
 * Descobre todos os slots presentes no disco (independente da config).
 * @param {string[]} [roots] pastas a varrer; default: só a slots/ do repo.
 */
export async function discoverSlots(roots = [paths.slotsDir]) {
  const slots = [];
  const byId = new Map();
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const id = entry.name;
      const dir = join(root, id);
      const indexFile = join(dir, 'index.js');
      if (!existsSync(indexFile)) continue;
      if (byId.has(id)) continue; // pasta de maior prioridade já forneceu este id
      const meta = await readSlotJson(dir, id);
      const slot = {
        id,
        dir,
        root,
        indexFile,
        viewFile: existsSync(join(dir, 'view.js')) ? join(dir, 'view.js') : null,
        cssFile: existsSync(join(dir, 'view.css')) ? join(dir, 'view.css') : null,
        meta,
      };
      byId.set(id, slot);
      slots.push(slot);
    }
  }
  slots.sort((a, b) => a.id.localeCompare(b.id));
  return slots;
}

/** Importa o módulo server-side de um slot e valida a interface. */
export async function loadSlotModule(slot) {
  const mod = await import(pathToFileURL(slot.indexFile).href);
  if (typeof mod.refresh !== 'function') {
    throw new Error(`${slot.indexFile} precisa exportar "async function refresh(ctx)".`);
  }
  return mod;
}

/**
 * Resolve a lista efetiva de slots: cruza o que está no disco com o que a
 * config habilita, na ordem da config. Slots na config sem pasta viram erro.
 */
export async function resolveSlots(config) {
  const roots = resolveSlotRoots(config);
  const onDisk = await discoverSlots(roots);
  const byId = new Map(onDisk.map((s) => [s.id, s]));

  const configured = config.slots ?? [];
  const missing = configured.filter((c) => !byId.has(c.id)).map((c) => c.id);
  if (missing.length) {
    throw new Error(
      `Config referencia slots que não existem em nenhuma pasta de slots ` +
        `(${roots.join(', ')}): ${missing.join(', ')}`,
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
