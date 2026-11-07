// Translates lines of text recognised in photos.
// In the Android app it translates on the phone (fast, unlimited, offline once a language is downloaded); then the
// browser's on-device translator when it's ready (recent desktop Chrome); otherwise the free MyMemory service (no
// key, roughly 5,000 characters a day per device). Only the recognised text is sent, never the photo.

import { nativeTranslate } from './native-vision.js';

const MYMEMORY_URL = 'https://api.mymemory.translated.net/get';
const MAX_BYTES = 450; // MyMemory accepts up to 500 bytes per request
const TIMEOUT_MS = 12000;
const cache = new Map();
/** How the last translation was done: 'device', 'browser', 'online', or 'downloading' (online while the phone
 * downloads the language). */
let lastMethod = '';
export const translationMethod = () => lastMethod;

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
  const fresh = new Map();
  if (missing.length) {
    const translate = await pickTranslator(from, to);
    const results = await translate(missing);
    // Online stand-ins while the phone downloads the language aren't kept: next time the phone translates.
    const keep = lastMethod !== 'downloading';
    missing.forEach((line, i) => {
      fresh.set(line, results[i] || line);
      if (keep) cache.set(key(line), results[i] || line);
    });
  }
  return lines.map((line) => cache.get(key(line)) ?? fresh.get(line));
}

// Built-in browser AI APIs can stall (e.g. while a model loads), so they get a time limit.
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

async function pickTranslator(from, to) {
  const fallback = await webTranslator(from, to);
  return async (texts) => {
    const device = await nativeTranslate(texts, from, to);
    if (device?.status === 'done' && device.translations?.length === texts.length) {
      lastMethod = 'device';
      return device.translations;
    }
    const results = await fallback(texts);
    if (device?.status === 'downloading') lastMethod = 'downloading';
    return results;
  };
}

/** The browser's on-device translator for these languages, if it has one ready; null otherwise. */
async function browserTranslator(from, to) {
  if (typeof self.Translator?.availability !== 'function') return null;
  try {
    const options = { sourceLanguage: from, targetLanguage: to };
    if ((await withTimeout(self.Translator.availability(options), 2000)) !== 'available') return null;
    return await withTimeout(self.Translator.create(options), 4000);
  } catch {
    return null;
  }
}

/**
 * Translate for the live camera: on the phone (or the browser's own translator) only, since every frame can bring
 * new lines and the online service has a daily limit. Uses and fills the same cache.
 * @returns {Promise<{status: 'done'|'downloading'|'unavailable', translations?: string[]}>}
 */
export async function translateLive(lines, from, to) {
  if (baseLanguage(from) === baseLanguage(to) && from !== 'zh-TW') return { status: 'done', translations: lines.slice() };
  const key = (line) => `${from}|${to}|${line}`;
  const missing = [...new Set(lines.filter((line) => !cache.has(key(line))))];
  if (missing.length) {
    const device = await nativeTranslate(missing, from, to);
    let results = device?.status === 'done' ? device.translations : null;
    if (!results && device?.status === 'downloading') return { status: 'downloading' };
    if (!results) {
      const browser = await browserTranslator(from, to);
      if (!browser) return { status: 'unavailable' };
      try {
        results = await withTimeout(Promise.all(missing.map((text) => browser.translate(text))), 10000);
      } catch {
        return { status: 'unavailable' };
      }
    }
    missing.forEach((line, i) => cache.set(key(line), results[i] || line));
  }
  return { status: 'done', translations: lines.map((line) => cache.get(key(line))) };
}

async function webTranslator(from, to) {
  if (typeof self.Translator?.availability === 'function') {
    try {
      const options = { sourceLanguage: from, targetLanguage: to };
      if ((await withTimeout(self.Translator.availability(options), 2000)) === 'available') {
        const translator = await withTimeout(self.Translator.create(options), 4000);
        return async (texts) => {
          try {
            const results = await withTimeout(Promise.all(texts.map((text) => translator.translate(text))), 10000);
            lastMethod = 'browser';
            return results;
          } catch {
            lastMethod = 'online';
            return translateOnline(texts, from, to);
          }
        };
      }
    } catch {
      /* fall back to the online service */
    }
  }
  return (texts) => {
    lastMethod = 'online';
    return translateOnline(texts, from, to);
  };
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
  const url = `${MYMEMORY_URL}?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(`${serviceCode(from)}|${serviceCode(to)}`)}&mt=1`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const json = await response.json();
    const fallback = json?.responseData?.translatedText;
    if (Number(json?.responseStatus) !== 200 || !fallback) {
      throw new Error(json?.responseDetails || `Translation failed (${json?.responseStatus || response.status})`);
    }
    if (/MYMEMORY WARNING|QUOTA/i.test(fallback)) throw new Error('Daily free translation limit reached. Try again tomorrow.');
    return decodeEntities(pickTranslation(text, json) || fallback);
  } finally {
    clearTimeout(timer);
  }
}

const comparable = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * MyMemory mixes human translation memory with machine translation. Its "best" answer is
 * sometimes a stored translation of a merely *similar* phrase, which reads as nonsense. Use a
 * stored translation only when it is for exactly this text; otherwise use the machine translation.
 */
export function pickTranslation(text, json) {
  const matches = Array.isArray(json?.matches) ? json.matches : [];
  const wanted = comparable(text);
  const exact = matches
    .filter((m) => m.translation && comparable(m.segment) === wanted && !/MT/i.test(m['created-by'] || ''))
    .sort((a, b) => Number(b.quality || 0) - Number(a.quality || 0))[0];
  if (exact && Number(exact.quality || 0) >= 50) return exact.translation;
  const machine = matches.find((m) => m.translation && /MT/i.test(m['created-by'] || ''));
  if (machine) return machine.translation;
  const best = json?.responseData;
  // A fuzzy memory match with nothing better: only trust it if it's a close match.
  if (best?.translatedText && Number(best.match ?? 1) >= 0.85) return best.translatedText;
  return null;
}

/** A link that opens the text in Google Translate (website or app) for a second opinion. */
export function googleTranslateUrl(text, from, to) {
  const code = (lang) => (lang === 'zh' ? 'zh-CN' : lang === 'nb' ? 'no' : lang || 'auto');
  return `https://translate.google.com/?sl=${encodeURIComponent(code(from))}&tl=${encodeURIComponent(code(to))}&text=${encodeURIComponent(text)}&op=translate`;
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
