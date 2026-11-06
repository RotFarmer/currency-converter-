// The photo-reading pipeline: find prices, work out the language, re-read text in its own script.
// Rendering lives in app.js; this module only deals with text and boxes.

import { readText, releaseWorkers, dropWorker } from './ocr.js';
import { findPrices } from './price-parser.js';
import {
  looksLikeOtherScript,
  scriptCandidates,
  scriptScore,
  languageFromScript,
  detectLatinLanguage,
  modelForLanguage,
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
async function readWith(canvas, model, { probe = false } = {}) {
  try {
    return await withTimeout(readText(canvas, null, { lang: model, probe }), probe ? PROBE_TIMEOUT_MS : READ_TIMEOUT_MS);
  } catch {
    dropWorker(model);
    return null;
  }
}

/**
 * Step 1: read prices with the English model. It handles digits and common currency signs
 * in any script. If nothing turns up, try again with a black-and-white copy, which copes
 * better with shadows and glare.
 */
export async function readPrices(canvas, parseOptions, onProgress) {
  const lines = await readText(canvas, (m) => onProgress(m, false));
  const prices = findPrices(lines, parseOptions);
  if (prices.length) return { lines, prices };
  const retryLines = await readText(canvas, (m) => onProgress(m, true), { mode: 'threshold' });
  const retryPrices = findPrices(retryLines, parseOptions);
  return retryPrices.length ? { lines: retryLines, prices: retryPrices } : { lines, prices };
}

/**
 * Step 2: work out the language of the text.
 * Latin-alphabet text is identified from its words. Other scripts come out of the English
 * model as low-confidence nonsense, so script models are tried (likeliest first, based on
 * currency hints) and the one that reads the text best wins.
 * @returns {Promise<{lang: string|null, model: string, lines: object[]} | null>} null if cancelled
 */
export async function identifyLanguage(canvas, englishLines, { hintCurrencies = [], onProbe, isCancelled }) {
  const unknown = { lang: null, model: 'eng', lines: englishLines };
  let candidates;
  let minScore = MIN_SCORE;

  if (!looksLikeOtherScript(englishLines)) {
    const text = englishLines.map((line) => line.text).join('\n');
    const lang = (await detectLanguageOnDevice(text)) || detectLatinLanguage(text);
    const words = englishLines.flatMap((line) => line.words).filter((w) => /\p{L}{2}/u.test(w.text)).length;
    if (lang || words < 3) return { lang, model: 'eng', lines: englishLines };
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

/** Read the text again with the model for a language the user picked. */
export async function readInLanguage(canvas, lang, englishLines) {
  const model = modelForLanguage(lang);
  const lines = model === 'eng' ? englishLines : await readWith(canvas, model);
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
