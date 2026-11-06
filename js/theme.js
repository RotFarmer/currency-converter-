// Custom accent colours: builds the whole colour set (panels, lines, text, glow) from one
// accent colour, for dark and light mode. The default green look lives in styles.css and is
// used as-is when no custom accent is chosen.

export const ACCENT_PRESETS = [
  { id: 'default', name: 'Default', color: '#7dff72' },
  { id: 'amber', name: 'Amber', color: '#ffb000' },
  { id: 'ice', name: 'Ice', color: '#5ad7ff' },
  { id: 'crimson', name: 'Crimson', color: '#ff4d5e' },
  { id: 'violet', name: 'Violet', color: '#b18cff' },
  { id: 'mono', name: 'Mono', color: '#e6e6e6' },
];

// Whole-app themes. The HUD look (styles.css) is the default; the others live in css/skins.css.
// "mode" marks themes that only come in light or only in dark. The head script in index.html
// keeps its own copy of those, so update both together.
export const SKINS = [
  { id: 'hud', name: 'HUD' },
  { id: 'aurora', name: 'Aurora' },
  { id: 'medieval', name: 'Medieval' },
  { id: 'cottage', name: 'Cottage' },
  { id: 'forest', name: 'Forest' },
  { id: 'ocean', name: 'Ocean' },
  { id: 'frostmire', name: 'Frostmire' },
  { id: 'cloud', name: 'Cloud' },
  { id: 'aero', name: 'Aero' },
  { id: 'retro95', name: '90s', mode: 'light' },
  { id: 'vapor', name: 'Vapor', mode: 'dark' },
  { id: 'pixel', name: '8-bit', mode: 'dark' },
  { id: 'notebook', name: 'Notebook' },
];

export function skinById(id) {
  return SKINS.find((skin) => skin.id === id) || SKINS[0];
}

export function hexToHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: Math.round(((h * 60) + 360) % 360), s: Math.min(100, s * 100), l: l * 100 };
}

const hsl = (h, s, l, a) => `hsl(${h} ${Math.round(s)}% ${l}%${a == null ? '' : ` / ${a}`})`;

/**
 * CSS custom properties for an accent colour.
 * @param {string} hex accent colour, e.g. "#ffb000"
 * @param {boolean} dark dark or light mode
 */
export function accentPalette(hex, dark) {
  const parsed = hexToHsl(hex);
  if (!parsed) return {};
  const { h } = parsed;
  const s = parsed.s;
  const tint = Math.min(s, 35) / 35; // grey accents (Mono) give grey panels
  if (dark) {
    return {
      '--accent': hsl(h, s, 72),
      '--accent-dim': hsl(h, s * 0.45, 46),
      '--accent-soft': hsl(h, s, 72, 0.08),
      '--glow': hsl(h, s, 72, 0.45),
      '--on-accent': hsl(h, 80 * tint, 4),
      '--bg': hsl(h, 20 * tint, 2),
      '--panel': hsl(h, 33 * tint, 5),
      '--panel-2': hsl(h, 30 * tint, 7.5),
      '--line': hsl(h, 35 * tint, 14),
      '--line-strong': hsl(h, 34 * tint, 25),
      '--text': hsl(h, 23 * tint, 85),
      '--text-dim': hsl(h, 11 * tint, 53),
      '--text-faint': hsl(h, 15 * tint, 34),
      '--grid-line': hsl(h, s, 72, 0.028),
      '--topbar-fade': hsl(h, 20 * tint, 2, 0.85),
      '--secondary-fill': hsl(h, 45 * tint, 5.5),
      '--menu-open-fill': hsl(h, 45 * tint, 8),
      '--tag-bg': hsl(h, 50 * tint, 2.4, 0.9),
      '--tag-text': hsl(h, 60 * tint, 94),
      '--tabbar-bg': hsl(h, 30 * tint, 2, 0.96),
      '--toast-bg': hsl(h, 50 * tint, 2, 0.96),
    };
  }
  return {
    '--accent': hsl(h, s * 0.8, 29),
    '--accent-dim': hsl(h, s * 0.3, 48),
    '--accent-soft': hsl(h, s * 0.8, 29, 0.08),
    '--glow': hsl(h, s * 0.8, 29, 0.18),
    '--on-accent': '#ffffff',
    '--bg': hsl(h, 12 * tint, 92),
    '--panel': hsl(h, 18 * tint, 97.5),
    '--panel-2': hsl(h, 16 * tint, 94.5),
    '--line': hsl(h, 15 * tint, 83),
    '--line-strong': hsl(h, 14 * tint, 67),
    '--text': hsl(h, 23 * tint, 10),
    '--text-dim': hsl(h, 12 * tint, 34),
    '--text-faint': hsl(h, 9 * tint, 48),
    '--grid-line': hsl(h, s * 0.8, 29, 0.06),
    '--topbar-fade': hsl(h, 12 * tint, 92, 0.85),
    '--secondary-fill': hsl(h, 25 * tint, 96.5),
    '--menu-open-fill': hsl(h, 30 * tint, 91),
    '--tabbar-bg': hsl(h, 18 * tint, 97.5, 0.96),
  };
}

/** Turn properties into a style string, e.g. for element.style.cssText. */
export function toCssText(vars) {
  return Object.entries(vars)
    .map(([name, value]) => `${name}:${value}`)
    .join(';');
}
