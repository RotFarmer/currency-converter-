// Works out where text sits on the photo: which words are item names, and which name goes with
// which price. Pure functions with no DOM access, so they can be unit tested in Node.

const centerInside = (word, box) => {
  const cx = (word.bbox.x0 + word.bbox.x1) / 2;
  const cy = (word.bbox.y0 + word.bbox.y1) / 2;
  return cx >= box.x0 && cx <= box.x1 && cy >= box.y0 && cy <= box.y1;
};

function unionBox(boxes) {
  return boxes.reduce(
    (b, w) => ({ x0: Math.min(b.x0, w.x0), y0: Math.min(b.y0, w.y0), x1: Math.max(b.x1, w.x1), y1: Math.max(b.y1, w.y1) }),
    { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  );
}

/**
 * Text lines with the prices taken out, e.g. "Menu du jour 14,90" → "Menu du jour".
 * Lines without at least two letters, or that the model was unsure about, are dropped.
 */
// Stray marks OCR picks up from borders, dots and dashes on menus.
const NOISE_EDGES = /^[\s|_~•·.,:;'"`´^*=+\-–—…<>()[\]{}/\\]+|[\s|_~•·,:;'"`´^*=+\-–—…<>([{/\\]+$/gu;

export function textLines(lines, priceBoxes) {
  const result = [];
  for (const line of lines) {
    // Drop prices and words the model was clearly guessing at.
    const words = line.words.filter(
      (w) => w.text.trim() && w.confidence >= 35 && !priceBoxes.some((box) => centerInside(w, box))
    );
    const text = words
      .map((w) => w.text)
      .join(isSpaceless(words) ? '' : ' ')
      .replace(/\.{3,}|…+/g, ' ') // dot leaders between a dish and its price
      .replace(NOISE_EDGES, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    const letters = (text.match(/\p{L}/gu) || []).length;
    const confidence = words.length ? words.reduce((sum, w) => sum + w.confidence, 0) / words.length : 0;
    // Mostly symbols, or low confidence overall: probably not real text.
    if (letters < 2 || letters / text.replace(/\s/g, '').length < 0.5 || confidence < 55) continue;
    const base = line.baseline;
    const slope = base && base.x1 - base.x0 > 0 ? (base.y1 - base.y0) / (base.x1 - base.x0) : null;
    result.push({ text, bbox: unionBox(words.map((w) => w.bbox)), slope });
  }
  return result;
}

// Chinese, Japanese and Thai don't put spaces between words.
function isSpaceless(words) {
  return words.some((w) => /[぀-ヿ一-鿿฀-๿]/u.test(w.text));
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Find the item name for a price: a text line on the same row (to the left, or to the right
 * for right-to-left languages), or failing that, the line just above it, as on a price tag.
 * @returns {{line: object, above: boolean} | null}
 */
function nearestLine(priceBox, lines, rtl) {
  const ph = priceBox.y1 - priceBox.y0;
  const pcx = (priceBox.x0 + priceBox.x1) / 2;
  const pcy = (priceBox.y0 + priceBox.y1) / 2;
  // How much rows rise or fall across the photo (it's rarely held perfectly level).
  const skew = median(lines.map((l) => l.slope).filter((s) => Number.isFinite(s) && Math.abs(s) < 0.3));
  let best = null;
  let bestScore = Infinity;
  let bestAbove = false;
  for (const line of lines) {
    const b = line.bbox;
    const lh = b.y1 - b.y0;
    const lcx = (b.x0 + b.x1) / 2;
    const lcy = (b.y0 + b.y1) / 2;
    let score = Infinity;
    // Where this line's row would be at the price's position, allowing for the tilt.
    const dy = Math.abs(lcy + skew * (pcx - lcx) - pcy);
    const sameRow = dy < Math.max(ph, lh) * 0.9;
    if (sameRow && b.x1 <= priceBox.x0 + ph * 0.3) {
      const gap = priceBox.x0 - b.x1 + dy * 4;
      score = rtl ? gap * 3 + 50 : gap;
    } else if (sameRow && b.x0 >= priceBox.x1 - ph * 0.3) {
      const gap = b.x0 - priceBox.x1 + dy * 4;
      score = rtl ? gap : gap * 3 + 50;
    } else {
      const above = priceBox.y0 - b.y1;
      const overlap = Math.min(b.x1, priceBox.x1) - Math.max(b.x0, priceBox.x0);
      if (above > -ph * 0.2 && above < ph * 2.5 && overlap > 0) score = 1000 + above;
    }
    if (score < bestScore) {
      bestScore = score;
      best = line;
      bestAbove = score >= 1000;
    }
  }
  return best && { line: best, above: bestAbove };
}

/**
 * The text lines that name the item a price belongs to. On price tags a name often spans
 * two or three stacked lines ("Croissant" / "au beurre"), so those are collected too.
 */
export function labelFor(priceBox, lines, { rtl = false } = {}) {
  const found = nearestLine(priceBox, lines, rtl);
  if (!found) return [];
  const result = [found.line];
  if (!found.above) return result;
  for (let i = 0; i < 2; i++) {
    const top = result[0].bbox;
    const h = top.y1 - top.y0;
    const next = lines.find((line) => {
      const b = line.bbox;
      const gap = top.y0 - b.y1;
      const overlap = Math.min(b.x1, top.x1) - Math.max(b.x0, top.x0);
      return !result.includes(line) && gap > -h * 0.2 && gap < h * 0.9 && overlap > 0;
    });
    if (!next) break;
    result.unshift(next);
  }
  return result;
}
