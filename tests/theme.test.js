import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hexToHsl, accentPalette, toCssText, ACCENT_PRESETS } from '../js/theme.js';

test('hexToHsl reads colours', () => {
  assert.deepEqual(hexToHsl('#7dff72'), { h: 115, s: 100, l: hexToHsl('#7dff72').l });
  assert.equal(Math.round(hexToHsl('#7dff72').l), 72);
  assert.equal(hexToHsl('#e6e6e6').s, 0);
  assert.equal(hexToHsl('#ffb000').h, 41);
  assert.equal(hexToHsl('nope'), null);
});

test('the default green rebuilt from its hue matches the hand-tuned accent', () => {
  // hsl(115 100% 72%) is the bright phosphor green used by the default theme
  assert.equal(accentPalette('#7dff72', true)['--accent'], 'hsl(115 100% 72%)');
});

test('light mode uses a darker accent for contrast', () => {
  const light = accentPalette('#ffb000', false);
  assert.equal(light['--accent'], 'hsl(41 80% 29%)');
  assert.equal(light['--on-accent'], '#ffffff');
});

test('grey accents give grey panels', () => {
  assert.match(accentPalette('#e6e6e6', true)['--panel'], /hsl\(0 0% 5%\)/);
});

test('toCssText and presets', () => {
  assert.equal(toCssText({ '--a': 'red', '--b': 'blue' }), '--a:red;--b:blue');
  assert.equal(ACCENT_PRESETS[0].id, 'default');
  assert.equal(accentPalette('bad', true)['--accent'], undefined);
});
