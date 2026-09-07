import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverSlots, resolveSlots, resolveSlotRoots, loadSlotModule } from '../src/slots.js';
import { validateConfig } from '../src/config.js';
import { paths } from '../src/paths.js';

test('discoverSlots: encontra os slots de exemplo', async () => {
  const slots = await discoverSlots();
  const ids = slots.map((s) => s.id);
  assert.ok(ids.includes('clock'), 'deve achar o slot clock');
  assert.ok(ids.includes('notes'), 'deve achar o slot notes');
});

test('resolveSlots: respeita ordem e enabled da config', async () => {
  const config = validateConfig({
    slots: [
      { id: 'notes', enabled: true, title: 'Meus Avisos', span: 2 },
      { id: 'clock', enabled: false },
    ],
  });
  const resolved = await resolveSlots(config);
  assert.equal(resolved[0].id, 'notes');
  assert.equal(resolved[0].title, 'Meus Avisos');
  assert.equal(resolved[0].span, 2);
  assert.equal(resolved[1].id, 'clock');
  assert.equal(resolved[1].enabled, false);
});

test('resolveSlots: erro se config referencia slot inexistente', async () => {
  const config = validateConfig({ slots: [{ id: 'inexistente' }] });
  await assert.rejects(() => resolveSlots(config), /não existem/);
});

test('loadSlotModule: slots de exemplo expõem refresh()', async () => {
  const [clock] = (await discoverSlots()).filter((s) => s.id === 'clock');
  const mod = await loadSlotModule(clock);
  const data = await mod.refresh({ now: new Date('2026-01-01T10:00:00Z'), config: { timezone: 'UTC' }, settings: {} });
  assert.equal(data.isoTime, '2026-01-01T10:00:00.000Z');
});

test('resolveSlotRoots: env > slotPaths > repo, sem duplicatas', () => {
  const config = validateConfig({ slotPaths: ['/tmp/aa', '/tmp/bb', '/tmp/aa'] });
  process.env.SERVBOARD_SLOTS_PATH = '/tmp/zz:/tmp/aa';
  try {
    const roots = resolveSlotRoots(config);
    assert.deepEqual(roots, ['/tmp/zz', '/tmp/aa', '/tmp/bb', paths.slotsDir]);
  } finally {
    delete process.env.SERVBOARD_SLOTS_PATH;
  }
});

test('discoverSlots: pasta externa entra e id repetido respeita prioridade', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sb-slots-'));
  try {
    await mkdir(join(dir, 'externo'));
    await writeFile(join(dir, 'externo', 'index.js'), 'export async function refresh(){return{ok:1}}');
    // "clock" também no root externo — deve vencer a versão do repo
    await mkdir(join(dir, 'clock'));
    await writeFile(join(dir, 'clock', 'index.js'), 'export async function refresh(){return{fonte:"externa"}}');

    const slots = await discoverSlots([dir, paths.slotsDir]);
    const byId = Object.fromEntries(slots.map((s) => [s.id, s]));
    assert.ok(byId.externo, 'slot externo descoberto');
    assert.equal(byId.externo.root, dir);
    assert.equal(byId.clock.root, dir, 'clock externo tem prioridade sobre o do repo');
    assert.ok(byId.notes, 'slot notes do repo continua presente');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveSlots: slot só existe numa pasta externa via config.slotPaths', async () => {
  const base = await mkdtemp(join(tmpdir(), 'sb-ext-'));
  const dir = join(base, 'slots');
  try {
    await mkdir(join(dir, 'energia'), { recursive: true });
    await writeFile(join(dir, 'energia', 'index.js'), 'export async function refresh(){return{w:1}}');

    const config = validateConfig({ slotPaths: [dir], slots: [{ id: 'energia', enabled: true }] });
    const resolved = await resolveSlots(config);
    assert.equal(resolved[0].id, 'energia');
    assert.equal(resolved[0].root, dir);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
