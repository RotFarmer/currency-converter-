// The photo-reading pipeline: find prices, work out the language, re-read text in its own script.
// Rendering lives in app.js; this module only deals with text and boxes.

import { readText, releaseWorkers, dropWorker, lastEngine } from './ocr.js';
import { nativeRead, nativeIdentify, scriptForCurrencies } from './native-vision.js';
import { findPrices } from './price-parser.js';
import {
  looksLikeOtherScript,
  scriptCandidates,
  scriptScore,
  languageFromScript,
  detectLatinLanguage,
  modelForLanguage,
  webOnlyScriptFor,
  languageForCurrencies,
  isLatinLanguage,
} from './language.js';
import { detectLanguageOnDevice } from './translate.js';

const ACCEPT_SCORE = 85; // stop trying models once one reads the text this well
const MIN_SCORE = 70; // below this, no model really read it
const PROBE_TIMEOUT_MS = 45000; // includes downloading the model on a slow connection
const READ_TIMEOUT_MS = 90000;

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

/** Read with a script model, giving up (and skipping that model) if it fails or stalls. */
async function readWith(canvas, model, { probe = false, engine = 'web' } = {}) {
  try {
    return await withTimeout(readText(canvas, null, { lang: model, probe, engine }), probe ? PROBE_TIMEOUT_MS : READ_TIMEOUT_MS);
  } catch {
    dropWorker(model);
    return null;
  }
}

/**
 * Step 1: read the prices. In the Android app the phone's own reader does it, in the script the currencies
 * suggest (each of its readers also reads digits and Latin letters). Otherwise the web reader's English model,
 * which handles digits and common currency signs in any script; if nothing turns up, it tries again with a
 * black-and-white copy, which copes better with shadows and glare.
 * @returns {{lines, prices, engine: 'device'|'web', script: string}}
 */
export async function readPrices(canvas, parseOptions, onProgress, { hints = [] } = {}) {
  const script = scriptForCurrencies(hints);
  const lines = await readText(canvas, (m) => onProgress(m, false), { script });
  const prices = findPrices(lines, parseOptions);
  if (lastEngine === 'device') return { lines, prices, engine: 'device', script };
  if (prices.length) return { lines, prices, engine: 'web', script: 'eng' };
  const retryLines = await readText(canvas, (m) => onProgress(m, true), { mode: 'threshold', engine: 'web' });
  const retryPrices = findPrices(retryLines, parseOptions);
  const result = retryPrices.length ? { lines: retryLines, prices: retryPrices } : { lines, prices };
  return { ...result, engine: 'web', script: 'eng' };
}

const KANA = /[\u3040-\u30ff]/u;
const HAN = /[\u4e00-\u9fff]/u;
const HANGUL = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/u;
const DEVANAGARI = /[\u0900-\u097f]/u;
const textOf = (lines) => lines.map((line) => line.text).join('\n');
const count = (text, pattern) => [...text].filter((ch) => pattern.test(ch)).length;
const letters = (lines) => count(textOf(lines), /\p{L}/u);
const cjk = (lines) => count(textOf(lines), /[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/u);
const DEVICE_SCRIPT = { ja: 'japanese', ko: 'korean', zh: 'chinese', 'zh-TW': 'chinese', hi: 'devanagari' };
const SHORT_TEXT = 30; // letters: below this, a language identified from the words alone is a guess

/**
 * Settle a Latin-alphabet language: a short text's language identified from its words is a guess, so the language the
 * currency suggests wins; with no identification at all, the currency's language stands in.
 */
function settleLatinLanguage(identified, letterCount, currencyLanguage) {
  const fromCurrency = isLatinLanguage(currencyLanguage) ? currencyLanguage : null;
  if (!identified) return fromCurrency;
  if (fromCurrency && identified !== fromCurrency && letterCount < SHORT_TEXT) return fromCurrency;
  return identified;
}

/**
 * Work out the language with the phone's reader. Its readers skip scripts they don't know (rather than misreading
 * them, as the web reader does), so when the Latin reader found little, the Japanese and Korean readers have a
 * look too. CJK and Devanagari text is recognised by its characters; Latin-alphabet text by the phone's language
 * identification. @returns {Promise<{lang, model, lines}|null>} null if cancelled
 */
async function identifyOnDevice(canvas, lines, script, hintCurrencies, isCancelled, region) {
  let best = { script, lines };
  // The photo's currency suggests a language: read with its script first (yen signs: the Japanese reader).
  const currencyLanguage = languageForCurrencies(hintCurrencies, region);
  const currencyScript = DEVICE_SCRIPT[currencyLanguage];
  if (currencyScript && currencyScript !== script) {
    if (isCancelled()) return null;
    const read = await nativeRead(canvas, currencyScript).catch(() => null);
    if (read && letters(read) >= letters(best.lines)) best = { script: currencyScript, lines: read };
  }
  if (best.script === 'latin' && letters(best.lines) < 40) {
    for (const other of ['japanese', 'korean']) {
      if (isCancelled()) return null;
      const read = await nativeRead(canvas, other).catch(() => null);
      if (read && cjk(read) > cjk(best.lines) + 3) best = { script: other, lines: read };
    }
  }
  const text = textOf(best.lines);
  let lang = null;
  if (KANA.test(text)) lang = 'ja';
  else if (HANGUL.test(text)) lang = 'ko';
  else if (HAN.test(text)) lang = hintCurrencies.some((c) => ['TWD', 'HKD', 'MOP'].includes(c)) ? 'zh-TW' : 'zh';
  else if (DEVANAGARI.test(text)) lang = 'hi';
  const wanted = { ja: 'japanese', ko: 'korean', zh: 'chinese', 'zh-TW': 'chinese', hi: 'devanagari' }[lang];
  if (wanted && wanted !== best.script) {
    if (isCancelled()) return null;
    const read = await nativeRead(canvas, wanted).catch(() => null);
    if (read) best = { script: wanted, lines: read };
  }
  const letterCount = letters(best.lines);
  if (!lang && letterCount >= 3) {
    const identified = letterCount >= 6 ? (await nativeIdentify(text)) || (await detectLanguageOnDevice(text)) || detectLatinLanguage(text) : null;
    lang = settleLatinLanguage(identified, letterCount, currencyLanguage);
  }
  return { lang, model: best.script, lines: best.lines };
}

/**
 * Step 2: work out the language of the text.
 * Latin-alphabet text is identified from its words. Other scripts come out of the English
 * model as low-confidence nonsense, so script models are tried (likeliest first, based on
 * currency hints) and the one that reads the text best wins.
 * @returns {Promise<{lang: string|null, model: string, lines: object[]} | null>} null if cancelled
 */
export async function identifyLanguage(canvas, englishLines, { hintCurrencies = [], onProbe, isCancelled, engine = 'web', script = 'eng', region = null }) {
  if (engine !== 'device') return identifyLanguageWeb(canvas, englishLines, { hintCurrencies, onProbe, isCancelled, region });
  const device = await identifyOnDevice(canvas, englishLines, script, hintCurrencies, isCancelled, region);
  if (!device) return null;
  const webScript = webOnlyScriptFor(hintCurrencies);
  if (device.lang && !webScript) return device;
  // The phone doesn't read Thai, Hebrew, Arabic, Cyrillic or Greek: the web reader works those out (slower).
  const webLines = await readWith(canvas, 'eng');
  if (!webLines || isCancelled()) return isCancelled() ? null : device;
  const web = await identifyLanguageWeb(canvas, webLines, { hintCurrencies, onProbe, isCancelled, region });
  if (!web) return null;
  return web.lang ? web : device;
}

async function identifyLanguageWeb(canvas, englishLines, { hintCurrencies = [], onProbe, isCancelled, region = null }) {
  const unknown = { lang: null, model: 'eng', lines: englishLines };
  const currencyLanguage = languageForCurrencies(hintCurrencies, region);
  let candidates;
  let minScore = MIN_SCORE;

  if (!looksLikeOtherScript(englishLines)) {
    const text = englishLines.map((line) => line.text).join('\n');
    const letterCount = count(text, /\p{L}/u);
    const lang = settleLatinLanguage((await detectLanguageOnDevice(text)) || detectLatinLanguage(text), letterCount, letterCount >= 3 ? currencyLanguage : null);
    const words = englishLines.flatMap((line) => line.words).filter((w) => /\p{L}{2}/u.test(w.text)).length;
    if (lang) {
      // Read it again with that language's own model: accents and words come out right,
      // which makes a big difference to the translation.
      const model = modelForLanguage(lang);
      const lines = model === 'eng' || isCancelled() ? null : await readWith(canvas, model);
      releaseWorkers(lines ? [model] : []);
      return lines ? { lang, model, lines } : { lang, model: 'eng', lines: englishLines };
    }
    if (words < 3) return unknown;
    // Cyrillic and Greek letters look like Latin ones, so the English model reads them with
    // fair confidence as nonsense words. Text in no known language gets a quick check for those,
    // and only a clear match counts.
    candidates = scriptCandidates(hintCurrencies).filter((model) => ['rus', 'ell'].includes(model));
    minScore = ACCEPT_SCORE;
  } else {
    candidates = scriptCandidates(hintCurrencies);
  }

  let best = null;
  for (const [index, model] of candidates.entries()) {
    if (isCancelled()) return null;
    onProbe?.(index, candidates.length);
    const lines = await readWith(canvas, model, { probe: true });
    if (!lines) continue; // the model couldn't be loaded; try the next one
    const score = scriptScore(lines, model);
    if (!best || score > best.score) best = { model, score };
    if (score >= ACCEPT_SCORE) break;
  }
  if (isCancelled()) return null;
  if (!best || best.score < minScore) {
    releaseWorkers();
    return unknown;
  }

  let { model } = best;
  let lines = await readWith(canvas, model);
  if (!lines) return { lang: languageFromScript(model, ''), model: 'eng', lines: englishLines };
  let lang = languageFromScript(model, lines.map((line) => line.text).join(''));
  if (lang === 'zh' && model === 'jpn') {
    // Kanji without kana: Chinese. Re-read with a Chinese model.
    const chinese = hintCurrencies.some((c) => ['TWD', 'HKD', 'MOP'].includes(c)) ? 'chi_tra' : 'chi_sim';
    const chineseLines = await readWith(canvas, chinese);
    if (chineseLines) [model, lines, lang] = [chinese, chineseLines, languageFromScript(chinese, '')];
  }
  releaseWorkers([model]);
  return { lang, model, lines };
}

/** Read the text again with the model for a language the user picked (on the phone when it reads that script). */
export async function readInLanguage(canvas, lang, englishLines) {
  const model = modelForLanguage(lang);
  const lines = model === 'eng' ? englishLines : await readWith(canvas, model, { engine: 'auto' });
  if (!lines) throw new Error(`Couldn’t load the ${lang} text model`);
  releaseWorkers([model]);
  return { lang, model, lines };
}

const overlaps = (a, b) => {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (w <= 0 || h <= 0) return false;
  const smaller = Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
  return (w * h) / smaller > 0.3;
};

/**
 * Combine prices from the English model with those from a script model.
 * The English model reads digits more reliably; the script model reads local currency words
 * (円, 원, บาท) and prices the English model rejected, such as "1,080円".
 */
export function mergePrices(englishPrices, scriptPrices) {
  const merged = englishPrices.map((p) => ({ ...p }));
  for (const price of scriptPrices) {
    const match = merged.find((p) => overlaps(p.bbox, price.bbox));
    if (!match) merged.push(price);
    else if (!match.candidates && price.candidates) {
      match.candidates = price.candidates;
      match.confidence = 'high';
    }
  }
  return merged.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
}
