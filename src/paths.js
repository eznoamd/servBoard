import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// src/ -> raiz do projeto
export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export const paths = {
  root: ROOT,
  bin: join(ROOT, 'bin'),
  src: join(ROOT, 'src'),
  slotsDir: join(ROOT, 'slots'),
  publicDir: join(ROOT, 'public'),
  configDir: join(ROOT, 'config'),
  configFile: join(ROOT, 'config', 'servboard.json'),
  configExample: join(ROOT, 'config', 'servboard.example.json'),
  dataDir: join(ROOT, 'data'),
  cacheDir: join(ROOT, 'data', 'cache'),
  chromiumProfile: join(ROOT, 'data', 'chromium-profile'),
  deployDir: join(ROOT, 'deploy'),
  systemdTemplates: join(ROOT, 'deploy', 'systemd'),
};

export function cacheFileFor(slotId) {
  return join(paths.cacheDir, `${slotId}.json`);
}
