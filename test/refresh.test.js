import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRefresh, readCache } from '../src/refresh.js';
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
