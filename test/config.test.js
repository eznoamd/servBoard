import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, ConfigError, DEFAULT_CONFIG } from '../src/config.js';

test('validateConfig: aplica defaults sobre objeto mínimo', () => {
  const cfg = validateConfig({});
  assert.equal(cfg.server.port, DEFAULT_CONFIG.server.port);
  assert.equal(cfg.refresh.everyMinutes, 15);
  assert.equal(cfg.refresh.onStart, true);
  assert.equal(cfg.display.keepScreenOn, true);
  assert.deepEqual(cfg.slots, []);
});

test('validateConfig: normaliza slots (enabled/settings default)', () => {
  const cfg = validateConfig({ slots: [{ id: 'clock' }] });
  assert.equal(cfg.slots[0].enabled, true);
  assert.deepEqual(cfg.slots[0].settings, {});
});

test('validateConfig: merge profundo preserva chaves não informadas', () => {
  const cfg = validateConfig({ server: { port: 8080 } });
  assert.equal(cfg.server.port, 8080);
  assert.equal(cfg.server.host, '127.0.0.1');
});

test('validateConfig: rejeita porta fora de faixa', () => {
  assert.throws(() => validateConfig({ server: { port: 0 } }), ConfigError);
  assert.throws(() => validateConfig({ server: { port: 99999 } }), ConfigError);
});

test('validateConfig: rejeita refresh.everyMinutes fora de faixa', () => {
  assert.throws(() => validateConfig({ refresh: { everyMinutes: 0 } }), ConfigError);
  assert.throws(() => validateConfig({ refresh: { everyMinutes: 5000 } }), ConfigError);
  assert.throws(() => validateConfig({ refresh: { everyMinutes: 'muito' } }), ConfigError);
});

test('validateConfig: rejeita id de slot inválido e duplicado', () => {
  assert.throws(() => validateConfig({ slots: [{ id: 'Clock!' }] }), ConfigError);
  assert.throws(
    () => validateConfig({ slots: [{ id: 'a' }, { id: 'a' }] }),
    /duplicado/,
  );
});

test('validateConfig: rejeita não-objeto', () => {
  assert.throws(() => validateConfig(null), ConfigError);
  assert.throws(() => validateConfig([]), ConfigError);
});
