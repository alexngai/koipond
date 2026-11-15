import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeAt } from './time.ts';

const at = (hhmm: string) => new Date(`2026-01-01T${hhmm}:00`);

test('day between dayFrom and nightFrom', () => {
  assert.equal(timeAt('07:00', '19:00', at('06:59')), 'night');
  assert.equal(timeAt('07:00', '19:00', at('07:00')), 'day');
  assert.equal(timeAt('07:00', '19:00', at('18:59')), 'day');
  assert.equal(timeAt('07:00', '19:00', at('19:00')), 'night');
});

test('day running past midnight', () => {
  assert.equal(timeAt('10:00', '02:00', at('23:30')), 'day');
  assert.equal(timeAt('10:00', '02:00', at('01:59')), 'day');
  assert.equal(timeAt('10:00', '02:00', at('02:00')), 'night');
  assert.equal(timeAt('10:00', '02:00', at('09:59')), 'night');
});
