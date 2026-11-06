import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectLatinLanguage,
  currencyForLanguage,
  languageFromScript,
  scriptCandidates,
  scriptScore,
  looksLikeOtherScript,
} from '../js/language.js';

const line = (...words) => ({ words: words.map(([text, confidence]) => ({ text, confidence })) });

test('detects common Latin-alphabet languages from menu text', () => {
  assert.equal(detectLatinLanguage('CARTE Soupe a l oignon Croque-monsieur Café creme Tarte aux pommes du jour'), 'fr');
  assert.equal(detectLatinLanguage('MENÚ Tortilla de patatas Calamares a la romana Café con leche Agua mineral sin gas'), 'es');
  assert.equal(detectLatinLanguage('Speisekarte Kaffee und Kuchen Schnitzel mit Pommes Bier vom Fass'), 'de');
  assert.equal(detectLatinLanguage('Pizza margherita Spaghetti alla carbonara Acqua frizzante Caffè della casa'), 'it');
  assert.equal(detectLatinLanguage('Fresh orange juice Chicken salad with our homemade dressing'), 'en');
  assert.equal(detectLatinLanguage('Phở bò Cơm gà Cà phê sữa đá Bánh mì'), 'vi');
});

test('returns null when there is not enough text to tell', () => {
  assert.equal(detectLatinLanguage('Croissant'), null);
  assert.equal(detectLatinLanguage(''), null);
});

test('maps languages to currencies, keeping the user\'s currency when it fits', () => {
  assert.equal(currencyForLanguage('ja', 'USD'), 'JPY');
  assert.equal(currencyForLanguage('fr', 'USD'), 'EUR');
  assert.equal(currencyForLanguage('fr', 'CHF'), 'CHF');
  assert.equal(currencyForLanguage('es', 'MXN'), 'MXN');
  assert.equal(currencyForLanguage('he', 'EUR'), 'ILS');
  assert.equal(currencyForLanguage('en', 'EUR'), null);
});

test('works out the language from the script model and text', () => {
  assert.equal(languageFromScript('jpn', '醤油ラーメン'), 'ja');
  assert.equal(languageFromScript('jpn', '宫保鸡丁'), 'zh');
  assert.equal(languageFromScript('rus', 'Борщ'), 'ru');
  assert.equal(languageFromScript('rus', 'Борщ український їжа'), 'uk');
  assert.equal(languageFromScript('heb', 'שקשוקה'), 'he');
});

test('tries scripts suggested by currencies first', () => {
  assert.deepEqual(scriptCandidates(['ILS']).slice(0, 2), ['heb', 'jpn']);
  assert.equal(scriptCandidates(['JPY', 'CNY'])[1], 'chi_sim');
  assert.equal(scriptCandidates([]).at(-1), 'tha');
});

test('scores how well a model read its script', () => {
  const japanese = [line(['醤油ラーメン', 90]), line(['餃子', 80])];
  assert.ok(scriptScore(japanese, 'jpn') > 80);
  assert.equal(scriptScore(japanese, 'kor'), 0);
});

test('spots text the English model could not read', () => {
  assert.equal(looksLikeOtherScript([line(['Bho', 0], ['—xv', 0]), line(['BRIE', 14], ['XY', 28]), line(['¥980', 87])]), true);
  assert.equal(looksLikeOtherScript([line(['Croissant', 96]), line(['au', 95], ['beurre', 95]), line(['oignon', 5])]), false);
});
