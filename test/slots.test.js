import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverSlots, resolveSlots, loadSlotModule } from '../src/slots.js';
import { validateConfig } from '../src/config.js';

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
