import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { paths } from './paths.js';

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

export const DEFAULT_CONFIG = {
  timezone: 'America/Sao_Paulo',
  server: { host: '127.0.0.1', port: 4870 },
  layout: { columns: 3, gap: 16 },
  display: {
    start: '07:00',
    stop: '23:00',
    days: 'Mon..Sun',
    browser: 'auto',
    powerManagement: true,
    xDisplay: ':0',
  },
  refresh: { onCalendar: '*:0/15', runBeforeDisplay: true },
  slotPaths: [],
  slots: [],
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, override) {
  if (!isObject(base) || !isObject(override)) return override ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = isObject(v) && isObject(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

/** Valida e normaliza um objeto de configuração já parseado. Lança ConfigError. */
export function validateConfig(raw, { source = '<memória>' } = {}) {
  if (!isObject(raw)) {
    throw new ConfigError(`${source}: a configuração deve ser um objeto JSON.`);
  }

  const cfg = deepMerge(DEFAULT_CONFIG, raw);
  const errors = [];

  if (typeof cfg.timezone !== 'string' || !cfg.timezone) {
    errors.push('timezone deve ser uma string (ex.: "America/Sao_Paulo").');
  }

  const { host, port } = cfg.server;
  if (typeof host !== 'string' || !host) errors.push('server.host deve ser uma string.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push('server.port deve ser um inteiro entre 1 e 65535.');
  }

  const { columns, gap } = cfg.layout;
  if (!Number.isInteger(columns) || columns < 1 || columns > 12) {
    errors.push('layout.columns deve ser um inteiro entre 1 e 12.');
  }
  if (!Number.isInteger(gap) || gap < 0 || gap > 128) {
    errors.push('layout.gap deve ser um inteiro entre 0 e 128 (pixels).');
  }

  const d = cfg.display;
  if (!HHMM.test(d.start)) errors.push('display.start deve estar no formato "HH:MM" (ex.: "07:00").');
  if (!HHMM.test(d.stop)) errors.push('display.stop deve estar no formato "HH:MM" (ex.: "23:00").');
  if (typeof d.days !== 'string' || !d.days) {
    errors.push('display.days deve ser uma expressão de dias do systemd (ex.: "Mon..Fri", "Mon,Wed,Fri", "Mon..Sun").');
  }
  if (typeof d.browser !== 'string') errors.push('display.browser deve ser "auto" ou o caminho/nome de um executável.');
  if (typeof d.powerManagement !== 'boolean') errors.push('display.powerManagement deve ser true ou false.');
  if (typeof d.xDisplay !== 'string' || !/^:\d+(\.\d+)?$/.test(d.xDisplay)) {
    errors.push('display.xDisplay deve ser um nome de display X (ex.: ":0").');
  }

  if (typeof cfg.refresh.onCalendar !== 'string' || !cfg.refresh.onCalendar) {
    errors.push('refresh.onCalendar deve ser uma expressão OnCalendar do systemd (ex.: "*:0/15").');
  }
  if (typeof cfg.refresh.runBeforeDisplay !== 'boolean') {
    errors.push('refresh.runBeforeDisplay deve ser true ou false.');
  }

  if (!Array.isArray(cfg.slotPaths)) {
    errors.push('slotPaths deve ser uma lista de caminhos de pastas de slots.');
  } else if (cfg.slotPaths.some((p) => typeof p !== 'string' || !p.trim())) {
    errors.push('slotPaths: cada item deve ser um caminho não-vazio (ex.: "../servboard-slots/slots").');
  }

  if (!Array.isArray(cfg.slots)) {
    errors.push('slots deve ser uma lista.');
  } else {
    const seen = new Set();
    cfg.slots.forEach((slot, i) => {
      if (!isObject(slot)) {
        errors.push(`slots[${i}] deve ser um objeto.`);
        return;
      }
      if (typeof slot.id !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(slot.id)) {
        errors.push(`slots[${i}].id deve ser um identificador (letras minúsculas, números, "-" e "_").`);
        return;
      }
      if (seen.has(slot.id)) errors.push(`slots: id duplicado "${slot.id}".`);
      seen.add(slot.id);
      if (slot.enabled !== undefined && typeof slot.enabled !== 'boolean') {
        errors.push(`slots[${slot.id}].enabled deve ser true ou false.`);
      }
      if (slot.span !== undefined && (!Number.isInteger(slot.span) || slot.span < 1 || slot.span > 12)) {
        errors.push(`slots[${slot.id}].span deve ser um inteiro entre 1 e 12.`);
      }
      if (slot.title !== undefined && typeof slot.title !== 'string') {
        errors.push(`slots[${slot.id}].title deve ser uma string.`);
      }
      if (slot.settings !== undefined && !isObject(slot.settings)) {
        errors.push(`slots[${slot.id}].settings deve ser um objeto.`);
      }
    });
  }

  if (errors.length) {
    throw new ConfigError(
      `Configuração inválida (${source}):\n` + errors.map((e) => `  - ${e}`).join('\n'),
    );
  }

  // Normaliza slots
  cfg.slots = cfg.slots.map((s) => ({
    enabled: true,
    settings: {},
    ...s,
  }));

  return cfg;
}

/**
 * Carrega a config de disco. Usa config/servboard.json; se não existir,
 * cai para config/servboard.example.json (útil em desenvolvimento).
 */
export async function loadConfig() {
  let file = paths.configFile;
  let usingExample = false;
  if (!existsSync(file)) {
    if (!existsSync(paths.configExample)) {
      throw new ConfigError(
        `Nenhuma configuração encontrada. Crie ${paths.configFile} ` +
          `(copie de ${paths.configExample}).`,
      );
    }
    file = paths.configExample;
    usingExample = true;
  }

  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    throw new ConfigError(`Não foi possível ler ${file}: ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(`${file} não é um JSON válido: ${err.message}`);
  }

  const config = validateConfig(parsed, { source: file });
  return { config, file, usingExample };
}
