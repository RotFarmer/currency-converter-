// Translates lines of text recognised in photos.
// Uses the browser's on-device translator when it's ready (recent desktop Chrome);
// otherwise the free MyMemory service (no key, roughly 5,000 characters a day per device).
// Only the recognised text is sent, never the photo.

const MYMEMORY_URL = 'https://api.mymemory.translated.net/get';
const MAX_BYTES = 450; // MyMemory accepts up to 500 bytes per request
const TIMEOUT_MS = 12000;
const cache = new Map();

const baseLanguage = (code) => String(code || '').split('-')[0].toLowerCase();

// MyMemory wants region codes for Chinese and "no" for Norwegian.
function serviceCode(lang) {
  if (lang === 'zh') return 'zh-CN';
  if (lang === 'nb') return 'no';
  return lang;
}

/** Translate each line from one language to another. Returns translations in the same order. */
export async function translateLines(lines, from, to) {
  if (!lines.length) return [];
  if (baseLanguage(from) === baseLanguage(to) && from !== 'zh-TW') return lines.slice();
  const key = (line) => `${from}|${to}|${line}`;
  const missing = [...new Set(lines.filter((line) => !cache.has(key(line))))];
  if (missing.length) {
    const translate = await pickTranslator(from, to);
    const results = await translate(missing);
    missing.forEach((line, i) => cache.set(key(line), results[i] || line));
  }
  return lines.map((line) => cache.get(key(line)));
}

// Built-in browser AI APIs can stall (e.g. while a model loads), so they get a time limit.
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

async function pickTranslator(from, to) {
  if (typeof self.Translator?.availability === 'function') {
    try {
      const options = { sourceLanguage: from, targetLanguage: to };
      if ((await withTimeout(self.Translator.availability(options), 2000)) === 'available') {
        const translator = await withTimeout(self.Translator.create(options), 4000);
        return async (texts) => {
          try {
            return await withTimeout(Promise.all(texts.map((text) => translator.translate(text))), 10000);
          } catch {
            return translateOnline(texts, from, to);
          }
        };
      }
    } catch {
      /* fall back to the online service */
    }
  }
  return (texts) => translateOnline(texts, from, to);
}

const encoder = new TextEncoder();
const byteLength = (text) => encoder.encode(text).length;

function trimToBytes(text) {
  let out = text;
  while (byteLength(out) > MAX_BYTES) out = out.slice(0, -1);
  return out;
}

async function translateOnline(texts, from, to) {
  // Send several lines per request, separated by newlines, to save quota and time.
  const chunks = [];
  let current = [];
  for (const text of texts.map(trimToBytes)) {
    if (current.length && byteLength([...current, text].join('\n')) > MAX_BYTES) {
      chunks.push(current);
      current = [];
    }
    current.push(text);
  }
  if (current.length) chunks.push(current);

  const translated = await mapWithLimit(chunks, 3, async (chunk) => {
    if (chunk.length === 1) return [await requestTranslation(chunk[0], from, to)];
    const parts = (await requestTranslation(chunk.join('\n'), from, to)).split(/\r?\n/);
    if (parts.length === chunk.length) return parts;
    // The service merged the lines, so translate them one at a time instead.
    return mapWithLimit(chunk, 3, (line) => requestTranslation(line, from, to));
  });
  return translated.flat();
}

async function requestTranslation(text, from, to) {
  const url = `${MYMEMORY_URL}?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(`${serviceCode(from)}|${serviceCode(to)}`)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const json = await response.json();
    const result = json?.responseData?.translatedText;
    if (Number(json?.responseStatus) !== 200 || !result) {
      throw new Error(json?.responseDetails || `Translation failed (${json?.responseStatus || response.status})`);
    }
    if (/MYMEMORY WARNING|QUOTA/i.test(result)) throw new Error('Daily free translation limit reached. Try again tomorrow.');
    return decodeEntities(result);
  } finally {
    clearTimeout(timer);
  }
}

function decodeEntities(text) {
  if (!/&[#\w]+;/.test(text) || typeof DOMParser === 'undefined') return text;
  return new DOMParser().parseFromString(text, 'text/html').documentElement.textContent;
}

async function mapWithLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/** On-device language detection where the browser offers it; null otherwise. */
export async function detectLanguageOnDevice(text) {
  if (typeof self.LanguageDetector?.availability !== 'function') return null;
  try {
    if ((await withTimeout(self.LanguageDetector.availability(), 2000)) !== 'available') return null;
    const detector = await withTimeout(self.LanguageDetector.create(), 4000);
    const [top] = await withTimeout(detector.detect(text), 4000);
    return top && top.confidence > 0.6 && top.detectedLanguage !== 'und' ? top.detectedLanguage : null;
  } catch {
    return null;
  }
}
