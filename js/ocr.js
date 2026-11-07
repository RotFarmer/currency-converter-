// Reads text from photos. Inside the Android app it uses the phone's own text reader (js/native-vision.js), which is
// much faster and more accurate; otherwise, and for scripts the phone doesn't read, Tesseract.js in the page.
// Everything runs on the phone; the photo is never uploaded.
// The library and English model (~6 MB) download on first use; other scripts (Japanese, Thai, …)
// add 1–3 MB each, only when a photo needs them. Everything is cached afterwards.

import { nativeRead, scriptForModel } from './native-vision.js';

const TESSERACT_VERSION = '7.0.0';
const CDN = 'https://cdn.jsdelivr.net/npm';

export const OCR_URLS = {
  library: `${CDN}/tesseract.js@${TESSERACT_VERSION}/dist/tesseract.esm.min.js`,
  workerPath: `${CDN}/tesseract.js@${TESSERACT_VERSION}/dist/worker.min.js`,
  corePath: `${CDN}/tesseract.js-core@${TESSERACT_VERSION}`,
  langPath: (lang) => `${CDN}/@tesseract.js-data/${lang}/4.0.0_best_int`,
};

const MAX_SIDE = 2000; // big enough for menus, small enough to read in a few seconds
const MIN_SIDE = 1000; // small screenshots are upscaled, which helps recognition
const PROBE_SIDE = 1000; // smaller copy used when trying out language models

const workers = new Map(); // OCR model → Promise<worker>
/** Which reader read the last text: 'device' (the app's) or 'web' (Tesseract). */
export let lastEngine = 'web';
let libraryPromise = null;
let progressListener = null;

function loadLibrary() {
  libraryPromise ||= import(OCR_URLS.library)
    .then((module) => module.default)
    .catch((error) => {
      libraryPromise = null;
      throw error;
    });
  return libraryPromise;
}

function getWorker(lang = 'eng') {
  if (!workers.has(lang)) {
    const promise = (async () => {
      const Tesseract = await loadLibrary();
      const worker = await Tesseract.createWorker(lang, 1 /* LSTM only: smaller, more accurate models */, {
        workerPath: OCR_URLS.workerPath,
        corePath: OCR_URLS.corePath,
        langPath: OCR_URLS.langPath(lang),
        logger: (message) => progressListener?.(message),
      });
      // Sparse text mode finds scattered text such as price tags and shelf labels.
      await worker.setParameters({ tessedit_pageseg_mode: '11' });
      return worker;
    })();
    promise.catch(() => workers.delete(lang)); // allow a retry, e.g. once the phone is back online
    workers.set(lang, promise);
  }
  return workers.get(lang);
}

/** Forget a model whose worker failed or stalled (e.g. its download broke), so it can be retried. */
export function dropWorker(lang) {
  const promise = workers.get(lang);
  if (!promise) return;
  workers.delete(lang);
  promise.then((worker) => worker.terminate()).catch(() => {});
}

/** Free the memory used by language models that are no longer needed. */
export async function releaseWorkers(keep = []) {
  for (const [lang, promise] of workers) {
    if (lang === 'eng' || keep.includes(lang)) continue;
    workers.delete(lang);
    promise.then((worker) => worker.terminate()).catch(() => {});
  }
}

/** Start downloading the text reader in the background so the first scan is quicker. */
export function preloadOcr() {
  return getWorker('eng');
}

/** Draw a photo onto a canvas, applying EXIF rotation and scaling it to a size OCR handles well. */
export async function photoToCanvas(file, canvas) {
  let source;
  let width;
  let height;
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
    ({ width, height } = source);
  } catch {
    source = await loadImageElement(file);
    width = source.naturalWidth;
    height = source.naturalHeight;
  }
  const longest = Math.max(width, height);
  const scale = longest > MAX_SIDE ? MAX_SIDE / longest : longest < MIN_SIDE ? Math.min(2, MIN_SIDE / longest) : 1;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close?.();
  return canvas;
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This file could not be opened as an image.'));
    };
    img.src = url;
  });
}

/**
 * Make a clean copy of the photo for text recognition.
 * - "gray": grayscale with stretched contrast. Tesseract's own colour handling can skip
 *   text on coloured backgrounds (e.g. a yellow price tag), so we convert it ourselves.
 * - "threshold": black and white using the local average brightness. Helps with shadows,
 *   glare and uneven light, so it is used as a second attempt when the first finds nothing.
 */
export function enhanceForOcr(canvas, mode = 'gray') {
  const { width: w, height: h } = canvas;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0);
  const image = ctx.getImageData(0, 0, w, h);
  const px = image.data;
  const gray = new Uint8ClampedArray(w * h);
  const histogram = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) {
    const v = (px[i * 4] * 77 + px[i * 4 + 1] * 150 + px[i * 4 + 2] * 29) >> 8;
    gray[i] = v;
    histogram[v]++;
  }

  if (mode === 'threshold') {
    // Integral image so each pixel's neighbourhood average is cheap to compute.
    const stride = w + 1;
    const integral = new Float64Array(stride * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += gray[y * w + x];
        integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row;
      }
    }
    const r = Math.max(8, Math.round(Math.max(w, h) / 40));
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r);
        const x1 = Math.min(w, x + r + 1);
        const sum = integral[y1 * stride + x1] - integral[y0 * stride + x1] - integral[y1 * stride + x0] + integral[y0 * stride + x0];
        const mean = sum / ((x1 - x0) * (y1 - y0));
        const v = gray[y * w + x] < mean - 12 ? 0 : 255;
        px[(y * w + x) * 4] = px[(y * w + x) * 4 + 1] = px[(y * w + x) * 4 + 2] = v;
      }
    }
  } else {
    // Stretch contrast so the darkest 1% becomes black and the lightest 1% white.
    const cutoff = gray.length * 0.01;
    let low = 0;
    let high = 255;
    for (let n = 0; low < 255 && n + histogram[low] < cutoff; low++) n += histogram[low];
    for (let n = 0; high > 0 && n + histogram[high] < cutoff; high--) n += histogram[high];
    const range = Math.max(1, high - low);
    for (let i = 0; i < gray.length; i++) {
      const v = ((gray[i] - low) * 255) / range;
      px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v;
    }
  }
  ctx.putImageData(image, 0, 0);
  return out;
}

function scaledCopy(canvas, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  if (scale === 1) return canvas;
  const out = document.createElement('canvas');
  out.width = Math.round(canvas.width * scale);
  out.height = Math.round(canvas.height * scale);
  out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

/**
 * Recognise text in a canvas.
 * @param {object} options  mode: "gray" | "threshold"; lang: Tesseract model; probe: use a small copy;
 *   script: the device reader's script to use (latin, japanese, chinese, korean, devanagari), else from lang;
 *   engine: "auto" (the device's reader when it reads that script) or "web" (always Tesseract)
 * @returns {Promise<{text:string, bbox:object, words:{text:string,bbox:object,confidence:number}[]}[]>}
 *   lines of words, with boxes in the canvas's own pixel coordinates
 */
export async function readText(canvas, onProgress, { mode = 'gray', lang = 'eng', probe = false, script = null, engine = 'auto', maxSide } = {}) {
  if (engine !== 'web') {
    const deviceScript = script || scriptForModel(lang);
    if (deviceScript) {
      try {
        const lines = await nativeRead(canvas, deviceScript, maxSide ? { maxSide } : undefined);
        if (lines) {
          lastEngine = 'device';
          return lines;
        }
      } catch {
        // the web reader below takes over
      }
    }
  }
  lastEngine = 'web';
  progressListener = onProgress;
  try {
    const worker = await getWorker(lang);
    const input = scaledCopy(enhanceForOcr(canvas, mode), probe ? PROBE_SIDE : Infinity);
    const factor = canvas.width / input.width;
    const scale = (b) => ({ x0: b.x0 * factor, y0: b.y0 * factor, x1: b.x1 * factor, y1: b.y1 * factor });
    const { data } = await worker.recognize(input, {}, { blocks: true, text: false });
    const lines = [];
    for (const block of data.blocks || []) {
      for (const paragraph of block.paragraphs) {
        for (const line of paragraph.lines) {
          lines.push({
            text: line.text.trim(),
            bbox: scale(line.bbox),
            baseline: line.baseline ? scale(line.baseline) : null,
            words: line.words.map(({ text, bbox, confidence }) => ({ text, bbox: scale(bbox), confidence })),
          });
        }
      }
    }
    return lines;
  } finally {
    // Another read (e.g. the live camera) may have started meanwhile; leave its listener alone.
    if (progressListener === onProgress) progressListener = null;
  }
}
