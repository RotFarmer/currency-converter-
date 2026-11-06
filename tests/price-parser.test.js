import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, findPricesInText, findPrices } from '../js/price-parser.js';

const CODES = new Set(['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'CAD', 'ILS', 'CHF', 'SEK', 'NOK', 'RUB', 'KWD', 'ALL', 'TRY']);
const DECIMALS = { JPY: 0, KWD: 3 };
const opts = (source, extra = {}) => ({
  source,
  knownCodes: CODES,
  decimalsFor: (c) => DECIMALS[c] ?? 2,
  ...extra,
});
const simple = (text, source = 'EUR', extra) =>
  findPricesInText(text, opts(source, extra)).map(({ amount, currency, confidence }) => ({ amount, currency, confidence }));

test('parseAmount handles common separator styles', () => {
  assert.equal(parseAmount('12.99'), 12.99);
  assert.equal(parseAmount('12,99'), 12.99);
  assert.equal(parseAmount('1,280.50'), 1280.5);
  assert.equal(parseAmount('1.280,50'), 1280.5);
  assert.equal(parseAmount('1.280'), 1280);
  assert.equal(parseAmount('1,280'), 1280);
  assert.equal(parseAmount('1.280.000'), 1280000);
  assert.equal(parseAmount("1'280.50"), 1280.5);
  assert.equal(parseAmount('0.500'), 0.5);
  assert.equal(parseAmount('12.5'), 12.5);
  assert.equal(parseAmount('1.250', 3), 1.25); // 3-decimal currencies like KWD
  assert.equal(parseAmount('980'), 980);
});

test('detects currency symbols before and after the number', () => {
  assert.deepEqual(simple('€12.99'), [{ amount: 12.99, currency: 'EUR', confidence: 'high' }]);
  assert.deepEqual(simple('12,50 €', 'USD'), [{ amount: 12.5, currency: 'EUR', confidence: 'high' }]);
  assert.deepEqual(simple('£ 4.20', 'USD'), [{ amount: 4.2, currency: 'GBP', confidence: 'high' }]);
  assert.deepEqual(simple('¥1,280', 'USD'), [{ amount: 1280, currency: 'JPY', confidence: 'high' }]);
  assert.deepEqual(simple('29.90 ₪', 'USD'), [{ amount: 29.9, currency: 'ILS', confidence: 'high' }]);
  assert.deepEqual(simple('USD 15', 'EUR'), [{ amount: 15, currency: 'USD', confidence: 'high' }]);
  assert.deepEqual(simple('15 CHF', 'EUR'), [{ amount: 15, currency: 'CHF', confidence: 'high' }]);
  assert.deepEqual(simple('39 NIS', 'USD'), [{ amount: 39, currency: 'ILS', confidence: 'high' }]);
  assert.deepEqual(simple('1 280 ₽', 'USD'), [{ amount: 1280, currency: 'RUB', confidence: 'high' }]);
  assert.deepEqual(simple('€ 1 280,00', 'USD'), [{ amount: 1280, currency: 'EUR', confidence: 'high' }]);
});

test('ambiguous symbols prefer the "prices in" currency', () => {
  assert.equal(simple('$5.99', 'CAD')[0].currency, 'CAD');
  assert.equal(simple('$5.99', 'EUR')[0].currency, 'USD');
  assert.equal(simple('¥58', 'CNY')[0].currency, 'CNY');
  assert.equal(simple('¥580', 'EUR')[0].currency, 'JPY');
  assert.equal(simple('49 kr', 'NOK')[0].currency, 'NOK');
  assert.equal(simple('CA$5.99', 'USD')[0].currency, 'CAD');
});

test('numbers without a symbol use the "prices in" currency', () => {
  assert.deepEqual(simple('Cappuccino 3.50', 'EUR'), [{ amount: 3.5, currency: 'EUR', confidence: 'medium' }]);
  assert.deepEqual(simple('Ramen 980', 'JPY'), [{ amount: 980, currency: 'JPY', confidence: 'low' }]);
  assert.deepEqual(simple('Pizza 12,-', 'EUR'), [{ amount: 12, currency: 'EUR', confidence: 'low' }]);
});

test('turning symbol detection off forces the "prices in" currency', () => {
  assert.equal(simple('$5.99', 'MXN', { detectCurrency: false })[0].currency, 'MXN');
});

test('ignores things that are not prices', () => {
  assert.deepEqual(simple('500g'), []);
  assert.deepEqual(simple('500 g'), []);
  assert.deepEqual(simple('20% off'), []);
  assert.deepEqual(simple('Open 10:30'), []);
  assert.deepEqual(simple('12.05.2024'), []);
  assert.deepEqual(simple('Call 555-1234'), []);
  assert.deepEqual(simple('A4 paper'), []);
  assert.deepEqual(simple('MP3'), []);
  assert.deepEqual(simple('Serves 2'), []);
  assert.deepEqual(simple('Since 2019'), []);
  assert.deepEqual(simple('1.5 l'), []);
  assert.deepEqual(simple('4006381333931'), []); // barcode
  assert.deepEqual(simple('Tel. 01 45 67 89'), []); // phone number in groups
});

test('everyday words that are also currency codes are not treated as currencies', () => {
  assert.deepEqual(simple('ALL 20.00', 'EUR'), [{ amount: 20, currency: 'EUR', confidence: 'medium' }]);
  assert.deepEqual(simple('ALL 20.00', 'ALL'), [{ amount: 20, currency: 'ALL', confidence: 'high' }]);
});

test('reads "S" glued to a decimal number as a dollar sign', () => {
  assert.deepEqual(simple('S12.99', 'USD'), [{ amount: 12.99, currency: 'USD', confidence: 'high' }]);
  assert.deepEqual(simple('S12', 'USD'), []);
});

test('finds several prices on one line', () => {
  const found = simple('Small €3.20 Large €4.10', 'USD');
  assert.deepEqual(found.map((p) => p.amount), [3.2, 4.1]);
});

test('3-decimal currencies keep their decimals', () => {
  assert.deepEqual(simple('KWD 1.250', 'USD'), [{ amount: 1.25, currency: 'KWD', confidence: 'high' }]);
});

test('findPrices maps prices back to word boxes', () => {
  const lines = [
    {
      words: [
        { text: 'Coffee', bbox: { x0: 0, y0: 0, x1: 50, y1: 10 } },
        { text: '€', bbox: { x0: 60, y0: 0, x1: 66, y1: 10 } },
        { text: '3.50', bbox: { x0: 68, y0: 1, x1: 90, y1: 11 } },
      ],
    },
    {
      words: [
        { text: '12', bbox: { x0: 0, y0: 20, x1: 10, y1: 30 } },
        { text: '.99', bbox: { x0: 10, y0: 20, x1: 25, y1: 30 } },
      ],
    },
  ];
  const prices = findPrices(lines, opts('USD'));
  assert.equal(prices.length, 2);
  assert.deepEqual(prices[0].bbox, { x0: 60, y0: 0, x1: 90, y1: 11 });
  assert.equal(prices[0].currency, 'EUR');
  assert.equal(prices[1].amount, 12.99);
  assert.deepEqual(prices[1].bbox, { x0: 0, y0: 20, x1: 25, y1: 30 });
});
