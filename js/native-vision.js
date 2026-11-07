// The Android app's on-device text reader, translator and language identifier (VisionPlugin.java, Google's ML Kit),
// when the app has them (build 14 and later). Much faster and more accurate than reading text inside the page.
// Everything here resolves to null when it isn't available, so callers fall back to the web versions.

/** The web reader's text models (Tesseract codes) that the device reads, and the device's script for each. */
const SCRIPT_FOR_MODEL = {
  jpn: 'japanese', chi_sim: 'chinese', chi_tra: 'chinese', kor: 'korean', hin: 'devanagari',
  eng: 'latin', fra: 'latin', spa: 'latin', deu: 'latin', ita: 'latin', por: 'latin', nld: 'latin', swe: 'latin',
  nor: 'latin', dan: 'latin', fin: 'latin', pol: 'latin', ces: 'latin', slk: 'latin', slv: 'latin', hun: 'latin',
  ron: 'latin', hrv: 'latin', tur: 'latin', vie: 'latin', ind: 'latin', msa: 'latin', tgl: 'latin', isl: 'latin',
};

/** The device's script for prices in a currency: each non-Latin reader also reads Latin letters and digits. */
const SCRIPT_FOR_CURRENCY = {
  JPY: 'japanese', CNY: 'chinese', TWD: 'chinese', HKD: 'chinese', MOP: 'chinese', KRW: 'korean', INR: 'devanagari', NPR: 'devanagari',
};

const JPEG_QUALITY = 0.85;
let infoPromise = null;

const plugin = (method, data = {}) => window.Capacitor.nativePromise('Vision', method, data);

/** What the device can do ({ scripts, translate }), or null in a browser or an older app. */
export function nativeVision() {
  if (!window.Capacitor?.isNativePlatform?.()) return Promise.resolve(null);
  infoPromise ||= plugin('info').then((info) => (info && Array.isArray(info.scripts) ? info : null), () => null);
  return infoPromise;
}

/** The device's script for a web text model, or null if the device can't read that script. */
export function scriptForModel(model) {
  return SCRIPT_FOR_MODEL[model] || null;
}

export function scriptForCurrencies(currencies = []) {
  for (const code of currencies) if (SCRIPT_FOR_CURRENCY[code]) return SCRIPT_FOR_CURRENCY[code];
  return 'latin';
}

function scaled(canvas, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  if (scale === 1) return canvas;
  const out = document.createElement('canvas');
  out.width = Math.round(canvas.width * scale);
  out.height = Math.round(canvas.height * scale);
  out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

/**
 * Read the text in a canvas on the device. Lines come back like the web reader's (text, bbox, words with their
 * own boxes and a 0–100 confidence), in the canvas's own pixels. Null when the device can't do it.
 */
export async function nativeRead(canvas, script = 'latin', { maxSide = 2000 } = {}) {
  const info = await nativeVision();
  if (!info || !info.scripts.includes(script)) return null;
  const input = scaled(canvas, maxSide);
  const image = input.toDataURL('image/jpeg', JPEG_QUALITY).split(',')[1];
  const result = await plugin('recognize', { image, script });
  const factor = canvas.width / (result.width || input.width);
  const box = (b) => ({ x0: b.x0 * factor, y0: b.y0 * factor, x1: b.x1 * factor, y1: b.y1 * factor });
  return (result.lines || []).map((line) => ({
    text: String(line.text || '').trim(),
    bbox: box(line.bbox),
    baseline: null,
    confidence: line.confidence,
    angle: line.angle || 0,
    words: (line.words || []).map((word) => ({ text: word.text, bbox: box(word.bbox), confidence: word.confidence ?? line.confidence ?? 90 })),
  }));
}

// ML Kit's language codes where they differ from the app's.
const TRANSLATE_CODE = { nb: 'no', fil: 'tl', 'zh-TW': 'zh' };

/**
 * Translate on the device. Resolves { status: 'done', translations } when the language models are on the phone;
 * { status: 'downloading' } while they download (the first time a language is used); { status: 'unsupported' };
 * or null when the device can't translate at all.
 */
export async function nativeTranslate(texts, from, to) {
  const info = await nativeVision();
  if (!info?.translate) return null;
  try {
    return await plugin('translate', { texts, from: TRANSLATE_CODE[from] || from, to: TRANSLATE_CODE[to] || to });
  } catch {
    return null;
  }
}

/** The language of some text on the device (such as "fr"), or null. */
export async function nativeIdentify(text) {
  const info = await nativeVision();
  if (!info || !text) return null;
  try {
    return (await plugin('identify', { text })).lang || null;
  } catch {
    return null;
  }
}
