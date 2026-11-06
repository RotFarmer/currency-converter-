import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickTranslation, googleTranslateUrl } from '../js/translate.js';

test('uses a stored translation only when it is for exactly this text', () => {
  const json = {
    responseData: { translatedText: 'Onion soup of the old woman', match: 0.88 },
    matches: [
      { segment: 'Soupe à la vieille', translation: 'Onion soup of the old woman', quality: '74', 'created-by': 'Someone', match: 0.88 },
      { segment: "Soupe à l'oignon", translation: 'Onion soup', quality: '70', 'created-by': 'MT!', match: 0.85 },
    ],
  };
  assert.equal(pickTranslation("Soupe à l'oignon", json), 'Onion soup');
});

test('prefers an exact human translation over machine translation', () => {
  const json = {
    responseData: { translatedText: 'Onion soup', match: 1 },
    matches: [
      { segment: 'Soupe à l’oignon', translation: 'French onion soup', quality: '80', 'created-by': 'Translator', match: 1 },
      { segment: 'Soupe à l’oignon', translation: 'Onion soup', quality: '70', 'created-by': 'MT!', match: 0.85 },
    ],
  };
  assert.equal(pickTranslation('soupe à l’oignon', json), 'French onion soup');
});

test('ignores a loose memory match when nothing better is available', () => {
  assert.equal(pickTranslation('Menu du jour', { responseData: { translatedText: 'Day trip', match: 0.6 }, matches: [] }), null);
  assert.equal(pickTranslation('Menu du jour', { responseData: { translatedText: 'Menu of the day', match: 1 } }), 'Menu of the day');
});

test('builds a Google Translate link', () => {
  const url = googleTranslateUrl('醤油ラーメン', 'ja', 'en');
  assert.match(url, /^https:\/\/translate\.google\.com\/\?sl=ja&tl=en&text=%E9%86%A4/);
  assert.match(googleTranslateUrl('x', 'zh', 'en'), /sl=zh-CN/);
});
