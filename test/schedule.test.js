import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toOnCalendar, parseDays, isWithinWindow } from '../src/schedule.js';

test('toOnCalendar: horário + intervalo de dias', () => {
  assert.equal(toOnCalendar('07:00', 'Mon..Fri'), 'Mon..Fri 07:00:00');
});

test('toOnCalendar: lista de dias', () => {
  assert.equal(toOnCalendar('23:30', 'Mon,Wed,Fri'), 'Mon,Wed,Fri 23:30:00');
});

test('toOnCalendar: todos os dias com "*" ou vazio', () => {
  assert.equal(toOnCalendar('06:15', '*'), '*-*-* 06:15:00');
  assert.equal(toOnCalendar('06:15', ''), '*-*-* 06:15:00');
});

test('toOnCalendar: rejeita horário inválido', () => {
  assert.throws(() => toOnCalendar('7:00', 'Mon..Fri'), /Horário inválido/);
  assert.throws(() => toOnCalendar('24:00'), /Horário inválido/);
  assert.throws(() => toOnCalendar('12:60'), /Horário inválido/);
});

test('toOnCalendar: rejeita dia inválido', () => {
  assert.throws(() => toOnCalendar('07:00', 'Mun..Fri'), /Dia inválido/);
  assert.throws(() => toOnCalendar('07:00', 'Segunda'), /Dia inválido/);
});

test('parseDays: intervalos, listas e curinga', () => {
  assert.deepEqual([...parseDays('Mon..Fri')], [1, 2, 3, 4, 5]);
  assert.deepEqual([...parseDays('Sat,Sun')], [6, 7]);
  assert.deepEqual([...parseDays('*')].sort(), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual([...parseDays('Fri..Mon')], [5, 6, 7, 1]); // volta na semana
});

test('isWithinWindow: janela diurna', () => {
  const w = { start: '07:00', stop: '23:00', days: 'Mon..Sun', timezone: 'UTC' };
  assert.equal(isWithinWindow(new Date('2026-09-07T12:00:00Z'), w), true);
  assert.equal(isWithinWindow(new Date('2026-09-07T06:59:00Z'), w), false);
  assert.equal(isWithinWindow(new Date('2026-09-07T23:00:00Z'), w), false);
});

test('isWithinWindow: respeita os dias', () => {
  const w = { start: '07:00', stop: '23:00', days: 'Mon..Fri', timezone: 'UTC' };
  // 2026-09-07 é segunda; 2026-09-06 é domingo
  assert.equal(isWithinWindow(new Date('2026-09-07T12:00:00Z'), w), true);
  assert.equal(isWithinWindow(new Date('2026-09-06T12:00:00Z'), w), false);
});

test('isWithinWindow: janela que vira a meia-noite', () => {
  const w = { start: '22:00', stop: '06:00', days: 'Mon..Sun', timezone: 'UTC' };
  assert.equal(isWithinWindow(new Date('2026-09-07T23:30:00Z'), w), true);
  assert.equal(isWithinWindow(new Date('2026-09-07T02:00:00Z'), w), true);
  assert.equal(isWithinWindow(new Date('2026-09-07T12:00:00Z'), w), false);
});

test('isWithinWindow: timezone é aplicado', () => {
  const w = { start: '07:00', stop: '23:00', days: 'Mon..Sun', timezone: 'America/Sao_Paulo' };
  // 09:00Z = 06:00 em São Paulo (UTC-3) -> fora da janela
  assert.equal(isWithinWindow(new Date('2026-09-07T09:00:00Z'), w), false);
  // 11:00Z = 08:00 em São Paulo -> dentro
  assert.equal(isWithinWindow(new Date('2026-09-07T11:00:00Z'), w), true);
});
