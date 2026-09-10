import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRefresh, readCache, parseInterval, startRefreshLoop } from '../src/refresh.js';
import { validateConfig } from '../src/config.js';
import { cacheFileFor, stateFileFor } from '../src/paths.js';

const ID = 'probe_refresh_test';

test('runRefresh: ctx.readState/writeState existem e persistem entre refreshes', async () => {
  const base = await mkdtemp(join(tmpdir(), 'sb-refresh-'));
  const dir = join(base, 'slots', ID);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'index.js'),
    `export async function refresh(ctx) {
       const prev = (await ctx.readState()) || { n: 0 };
       const n = prev.n + 1;
       await ctx.writeState({ n });
       return { n, hasHelpers: typeof ctx.readState === 'function' && typeof ctx.writeState === 'function' };
     }`,
  );
  const config = validateConfig({
    slotPaths: [join(base, 'slots')],
    slots: [{ id: ID, enabled: true }],
  });

  try {
    const r1 = await runRefresh(config);
    assert.equal(r1.results[0].ok, true);
    let cache = await readCache(ID);
    assert.equal(cache.data.hasHelpers, true);
    assert.equal(cache.data.n, 1);

    await runRefresh(config);
    cache = await readCache(ID);
    assert.equal(cache.data.n, 2, 'state do slot persistiu entre refreshes');
  } finally {
    await rm(base, { recursive: true, force: true });
    await rm(cacheFileFor(ID), { force: true });
    await rm(stateFileFor(ID), { force: true });
  }
});

test('parseInterval: sufixos s/m/h, número em minutos e fallback', () => {
  assert.equal(parseInterval('30s', 999), 30_000);
  assert.equal(parseInterval('5m', 999), 300_000);
  assert.equal(parseInterval('2h', 999), 7_200_000);
  assert.equal(parseInterval(15, 999), 900_000);
  assert.equal(parseInterval(null, 999), 999);
  assert.equal(parseInterval('', 999), 999);
  assert.equal(parseInterval('lixo', 999), 999);
});

test('startRefreshLoop: firstRun atualiza os slots habilitados uma vez', async () => {
  const base = await mkdtemp(join(tmpdir(), 'sb-loop-'));
  const id = 'probe_loop_test';
  const dir = join(base, 'slots', id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'index.js'),
    'export async function refresh() { return { at: Date.now() }; }',
  );
  const config = validateConfig({
    slotPaths: [join(base, 'slots')],
    slots: [{ id, enabled: true }],
    refresh: { everyMinutes: 15, onStart: true },
  });

  const loop = startRefreshLoop(config);
  try {
    await loop.firstRun;
    const cache = await readCache(id);
    assert.equal(cache.error, null);
    assert.ok(cache.data.at > 0);
  } finally {
    loop.stop();
    await rm(base, { recursive: true, force: true });
    await rm(cacheFileFor(id), { force: true });
    await rm(stateFileFor(id), { force: true });
  }
});
