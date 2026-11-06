// Reads text from photos with Tesseract.js. Everything runs on the phone; the photo is never uploaded.
// The library (~6 MB including the English model) downloads on first use and is cached afterwards.

const TESSERACT_VERSION = '7.0.0';
const CDN = 'https://cdn.jsdelivr.net/npm';

export const OCR_URLS = {
  library: `${CDN}/tesseract.js@${TESSERACT_VERSION}/dist/tesseract.esm.min.js`,
  workerPath: `${CDN}/tesseract.js@${TESSERACT_VERSION}/dist/worker.min.js`,
  corePath: `${CDN}/tesseract.js-core@${TESSERACT_VERSION}`,
  langPath: `${CDN}/@tesseract.js-data/eng/4.0.0_best_int`,
};

const MAX_SIDE = 2000; // big enough for menus, small enough to read in a few seconds
const MIN_SIDE = 1000; // small screenshots are upscaled, which helps recognition

let workerPromise = null;
let progressListener = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { default: Tesseract } = await import(OCR_URLS.library);
      const worker = await Tesseract.createWorker('eng', 1 /* LSTM only: smaller, more accurate model */, {
        workerPath: OCR_URLS.workerPath,
        corePath: OCR_URLS.corePath,
        langPath: OCR_URLS.langPath,
        logger: (message) => progressListener?.(message),
      });
      // Sparse text mode finds scattered text such as price tags and shelf labels.
      await worker.setParameters({ tessedit_pageseg_mode: '11' });
      return worker;
    })().catch((error) => {
      workerPromise = null; // allow a retry, e.g. once the phone is back online
      throw error;
    });
  }
  return workerPromise;
}

/** Start downloading the text reader in the background so the first scan is quicker. */
export function preloadOcr(onProgress) {
  if (onProgress) progressListener = onProgress;
  return getWorker();
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

/**
 * Recognise text in a canvas.
 * @returns {Promise<{text:string, words:{text:string,bbox:object,confidence:number}[]}[]>} lines of words
 */
export async function readText(canvas, onProgress, { mode = 'gray' } = {}) {
  progressListener = onProgress;
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(enhanceForOcr(canvas, mode), {}, { blocks: true, text: false });
    const lines = [];
    for (const block of data.blocks || []) {
      for (const paragraph of block.paragraphs) {
        for (const line of paragraph.lines) {
          lines.push({
            text: line.text,
            words: line.words.map(({ text, bbox, confidence }) => ({ text, bbox, confidence })),
          });
        }
      }
    }
    return lines;
  } finally {
    progressListener = null;
  }
}
