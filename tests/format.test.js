import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUserNumber, formatInputNumber, formatMoney } from '../js/format.js';

test('parseUserNumber accepts either decimal separator', () => {
  assert.equal(parseUserNumber('12.5'), 12.5);
  assert.equal(parseUserNumber('12,5'), 12.5);
  assert.equal(parseUserNumber('1,280.50'), 1280.5);
  assert.equal(parseUserNumber('1.280,50'), 1280.5);
  assert.equal(parseUserNumber('1.280.000'), 1280000);
  assert.equal(parseUserNumber('.5'), 0.5);
  assert.equal(parseUserNumber('12.'), 12);
  assert.equal(parseUserNumber('¥ 980'), 980);
  assert.equal(parseUserNumber(''), null);
  assert.equal(parseUserNumber('.'), null);
});

test('formatInputNumber uses the currency decimals and no grouping', () => {
  assert.equal(formatInputNumber(1280.4, 'JPY'), '1280');
  assert.equal(formatInputNumber(8.3712, 'USD'), '8.37');
  assert.equal(formatInputNumber(0.00654, 'USD'), '0.0065');
  assert.equal(formatInputNumber(null, 'USD'), '');
});

test('formatMoney keeps tiny amounts readable', () => {
  assert.equal(formatMoney(8.3712, 'USD'), '$8.37');
  assert.equal(formatMoney(1280, 'JPY'), '¥1,280');
  assert.equal(formatMoney(0.00072, 'USD'), '$0.00072');
  assert.equal(formatMoney(NaN, 'USD'), '—');
});
