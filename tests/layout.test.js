import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textLines, labelFor } from '../js/layout.js';

const box = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
const word = (text, b, confidence = 90) => ({ text, bbox: b, confidence });

test('textLines drops prices and low-quality lines', () => {
  const lines = [
    { words: [word('Menu', box(0, 0, 40, 10)), word('du', box(45, 0, 60, 10)), word('jour', box(65, 0, 95, 10)), word('14,90', box(300, 0, 340, 10))] },
    { words: [word('xv', box(0, 20, 20, 30), 10)] },
    { words: [word('醤油', box(0, 40, 30, 50)), word('ラーメン', box(30, 40, 90, 50))] },
  ];
  const result = textLines(lines, [box(295, -2, 345, 12)]);
  assert.deepEqual(result.map((l) => l.text), ['Menu du jour', '醤油ラーメン']);
  assert.deepEqual(result[0].bbox, box(0, 0, 95, 10));
});

test('labelFor picks the name on the same row', () => {
  const lines = [
    { text: 'Coffee', bbox: box(0, 0, 60, 12) },
    { text: 'Tea', bbox: box(0, 30, 30, 42) },
  ];
  assert.deepEqual(labelFor(box(200, 29, 240, 43), lines).map((l) => l.text), ['Tea']);
  assert.deepEqual(labelFor(box(200, 0, 240, 12), lines).map((l) => l.text), ['Coffee']);
});

test('labelFor allows for a tilted photo', () => {
  // Rows rise 0.1px per px to the right, so each price sits ~40px higher than its name.
  const lines = [
    { text: 'Miso ramen', bbox: box(0, 100, 150, 130), slope: -0.1 },
    { text: 'Edamame', bbox: box(0, 160, 120, 190), slope: -0.1 },
    { text: 'Draft beer', bbox: box(0, 220, 150, 250), slope: -0.1 },
  ];
  assert.equal(labelFor(box(450, 118, 520, 148), lines)[0].text, 'Edamame');
  assert.equal(labelFor(box(450, 59, 520, 89), lines)[0].text, 'Miso ramen');
});

test('labelFor prefers the right-hand side for right-to-left languages', () => {
  const lines = [
    { text: 'left', bbox: box(0, 0, 50, 12) },
    { text: 'חומוס', bbox: box(250, 0, 300, 12) },
  ];
  assert.equal(labelFor(box(100, 0, 140, 12), lines, { rtl: true })[0].text, 'חומוס');
  assert.equal(labelFor(box(100, 0, 140, 12), lines)[0].text, 'left');
});

test('labelFor falls back to the lines above, as on a price tag', () => {
  const lines = [
    { text: 'Croissant', bbox: box(10, 0, 120, 20) },
    { text: 'au beurre', bbox: box(10, 24, 90, 36) },
  ];
  assert.deepEqual(labelFor(box(20, 50, 110, 90), lines).map((l) => l.text), ['Croissant', 'au beurre']);
  assert.deepEqual(labelFor(box(400, 50, 450, 90), lines), []);
});
