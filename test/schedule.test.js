import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toOnCalendar } from '../src/schedule.js';

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
