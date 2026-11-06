// Finds prices in OCR text and works out which currency each one is in.
// Pure functions with no DOM access, so they can be unit tested in Node.

const DOLLARS = [
  'USD', 'CAD', 'AUD', 'NZD', 'HKD', 'SGD', 'TWD', 'MXN', 'ARS', 'CLP', 'COP', 'UYU', 'DOP',
  'CUP', 'BSD', 'BBD', 'BZD', 'BMD', 'BND', 'FJD', 'GYD', 'JMD', 'KYD', 'LRD', 'NAD', 'SBD',
  'SRD', 'TTD', 'XCD',
];

// Text that can sit next to a number to say which currency it is in.
// `currencies` lists candidates: the first is the default, but if the user's
// "prices in" currency is among them, that one wins (e.g. "$" in Canada → CAD).
const TOKEN_LIST = [
  ['US$', 'USD'], ['U$S', 'USD'], ['CA$', 'CAD'], ['C$', ['CAD', 'NIO']], ['AU$', 'AUD'],
  ['A$', 'AUD'], ['NZ$', 'NZD'], ['HK$', 'HKD'], ['SG$', 'SGD'], ['S$', 'SGD'], ['MX$', 'MXN'],
  ['NT$', 'TWD'], ['R$', 'BRL'], ['RD$', 'DOP'], ['J$', 'JMD'], ['TT$', 'TTD'], ['N$', 'NAD'],
  ['BZ$', 'BZD'], ['FJ$', 'FJD'], ['$', DOLLARS], ['＄', DOLLARS],
  ['€', 'EUR'], ['£', ['GBP', 'GIP', 'FKP', 'SHP']], ['E£', 'EGP'], ['¥', ['JPY', 'CNY']],
  ['￥', ['JPY', 'CNY']], ['円', 'JPY'], ['元', 'CNY'], ['₩', 'KRW'], ['₹', 'INR'], ['₪', 'ILS'],
  ['₨', ['INR', 'PKR', 'LKR', 'NPR', 'MUR', 'SCR']], ['฿', 'THB'], ['₫', 'VND'], ['₱', 'PHP'],
  ['₺', 'TRY'], ['₽', 'RUB'], ['₴', 'UAH'], ['₦', 'NGN'], ['₡', 'CRC'], ['₲', 'PYG'],
  ['₵', 'GHS'], ['₸', 'KZT'], ['₼', 'AZN'], ['₾', 'GEL'], ['₭', 'LAK'], ['៛', 'KHR'],
  ['₮', 'MNT'], ['zł', 'PLN'], ['Zł', 'PLN'], ['ZŁ', 'PLN'], ['Kč', 'CZK'], ['Ft', 'HUF'],
  ['lei', 'RON'], ['Lei', 'RON'], ['LEI', 'RON'], ['лв', 'BGN'], ['ден', 'MKD'], ['дин', 'RSD'],
  ['kr', ['SEK', 'NOK', 'DKK', 'ISK']], ['Kr', ['SEK', 'NOK', 'DKK', 'ISK']],
  ['KR', ['SEK', 'NOK', 'DKK', 'ISK']], ['Rp', 'IDR'], ['RM', 'MYR'],
  ['Rs', ['INR', 'PKR', 'LKR', 'NPR']], ['Rs.', ['INR', 'PKR', 'LKR', 'NPR']],
  ['Fr.', 'CHF'], ['Fr', 'CHF'], ['TL', 'TRY'], ['S/', 'PEN'], ['S/.', 'PEN'], ['Kz', 'AOA'],
  ['KSh', 'KES'], ['Ksh', 'KES'], ['Dhs', 'AED'], ['DH', 'MAD'], ['Dh', 'MAD'],
  ['NIS', 'ILS'], ['RMB', 'CNY'], ['yen', 'JPY'], ['Yen', 'JPY'], ['YEN', 'JPY'], ['euro', 'EUR'],
  ['euros', 'EUR'], ['Euro', 'EUR'], ['EURO', 'EUR'],
];

const TOKENS = TOKEN_LIST.map(([text, currencies]) => ({
  text,
  currencies: Array.isArray(currencies) ? currencies : [currencies],
  alpha: /^\p{L}/u.test(text) && /\p{L}\.?$/u.test(text),
})).sort((a, b) => b.text.length - a.text.length);

// ISO codes that are also everyday English words. Only treated as a currency
// when they match the user's "prices in" currency.
const WORDLIKE_CODES = new Set(['ALL', 'AMD', 'BAM', 'BOB', 'CUP', 'GEL', 'MAD', 'MOP', 'PEN', 'SOS', 'TOP', 'TRY']);

const NUMBER_RUN = /\d(?:[\d.,'’]*\d)?/g;
const VALID_NUMBER = /^(?:\d{1,3}(?:([.,'’])\d{3})(?:\1\d{3})*(?:[.,]\d{1,3})?|\d+(?:[.,]\d{1,3})?)$/;
const UNIT_AFTER =
  /^\s?(?:%|‰|°|×|x|kg|g|mg|gr|grs|lb|lbs|oz|ml|cl|dl|l|lt|ltr|cm|mm|km|m|in|ft|pcs?|pz|st|stk|cal|kcal|kj|min|mins|h|hr|hrs|sec|gb|mb|tb|kb|mah|w|kw|kwh|v|hz|px|mp|yrs?|days?|nights?|months?|years?|pax|people|persons?|rd|st|nd|th|am|pm)(?!\p{L})/iu;
const LETTER = /\p{L}/u;

/**
 * Parse a number as printed on a price, guessing which separator is the decimal point.
 * "1,280.50" → 1280.5, "1.280,50" → 1280.5, "12,99" → 12.99, "1.280" → 1280.
 */
export function parseAmount(text, currencyDecimals = 2) {
  const s = String(text).replace(/['’\s]/g, '');
  const decPos = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  if (decPos === -1) return Number(s);
  const sep = s[decPos];
  const other = sep === '.' ? ',' : '.';
  if (s.includes(other)) return Number(s.split(other).join('').replace(sep, '.'));
  if (s.indexOf(sep) !== decPos) return Number(s.split(sep).join('')); // "1.280.000"
  const fraction = s.length - decPos - 1;
  const integer = s.slice(0, decPos);
  if (fraction === 3 && currencyDecimals !== 3 && integer !== '0') return Number(integer + s.slice(decPos + 1));
  return Number(`${integer || '0'}.${s.slice(decPos + 1)}`);
}

export function resolveCurrency(candidates, source) {
  return candidates.includes(source) ? source : candidates[0];
}

function matchPrefix(before, ctx) {
  const gap = /\s$/.test(before) ? 1 : 0;
  const s = gap ? before.slice(0, -1) : before;
  for (const tok of TOKENS) {
    if (!s.endsWith(tok.text)) continue;
    const prev = s[s.length - tok.text.length - 1];
    if (tok.alpha && prev && LETTER.test(prev)) continue;
    return { currencies: tok.currencies, length: tok.text.length + gap };
  }
  const code = s.match(/(?:^|[^A-Za-z])([A-Z]{3})$/);
  if (code && isCurrencyCode(code[1], ctx)) return { currencies: [code[1]], length: 3 + gap };
  // OCR often reads "$" as "S" when it touches the number ("S12.99").
  if (!gap && /(?:^|[^\p{L}])S$/u.test(s)) return { currencies: DOLLARS, length: 1, needsDecimals: true };
  return null;
}

function matchSuffix(after, ctx) {
  const gap = /^\s/.test(after) ? 1 : 0;
  const s = gap ? after.slice(1) : after;
  for (const tok of TOKENS) {
    if (!s.startsWith(tok.text)) continue;
    const next = s[tok.text.length];
    if (tok.alpha && next && LETTER.test(next)) continue;
    return { currencies: tok.currencies, length: tok.text.length + gap };
  }
  const code = s.match(/^([A-Z]{3})(?![A-Za-z])/);
  if (code && isCurrencyCode(code[1], ctx)) return { currencies: [code[1]], length: 3 + gap };
  return null;
}

function isCurrencyCode(code, ctx) {
  if (!ctx.knownCodes.has(code)) return false;
  return !WORDLIKE_CODES.has(code) || code === ctx.source;
}

/**
 * Find prices in a single line of text.
 * `candidates` lists the currencies a detected sign could mean ("$" → USD, CAD, …), so the
 * currency can be re-resolved later if the user changes their "prices in" currency.
 * @returns {{start:number,end:number,amount:number,currency:string,detected:boolean,candidates:string[]|null,confidence:'high'|'medium'|'low',text:string}[]}
 */
export function findPricesInText(text, options = {}) {
  const ctx = {
    source: options.source || 'USD',
    detectCurrency: options.detectCurrency !== false,
    knownCodes: options.knownCodes || new Set(),
    decimalsFor: options.decimalsFor || (() => 2),
  };
  const results = [];
  let consumedUntil = 0;

  for (const match of text.matchAll(NUMBER_RUN)) {
    if (match.index < consumedUntil) continue;
    let number = match[0];
    let start = match.index;
    let end = start + number.length;

    // A space used as a thousands separator: "1 280 ₽", "€ 12 500,00"
    if (/^\d{1,3}$/.test(number)) {
      const ext = text.slice(end).match(/^((?: \d{3})+)([.,]\d{1,2})?(?![\d.,'’])/);
      if (ext) {
        const extEnd = end + ext[0].length;
        if (ext[2] || matchPrefix(text.slice(0, start), ctx) || matchSuffix(text.slice(extEnd), ctx)) {
          number += ext[0].replace(/ /g, '');
          end = extEnd;
        }
      }
    }
    consumedUntil = end;
    if (!VALID_NUMBER.test(number)) continue; // dates like 12.05.2024, IP addresses, etc.

    const before = text.slice(0, start);
    let after = text.slice(end);

    // Times, dates, phone numbers and ranges: 12:30, 12/05, 555-1234
    if (/^[:/\-–]\d/.test(after) || /\d[:/\-–]$/.test(before)) continue;

    // "12.-" or "12,–" means a whole amount (common in Switzerland and Germany).
    const wholeMark = after.match(/^[.,][-–—]/);
    if (wholeMark) {
      end += wholeMark[0].length;
      after = after.slice(wholeMark[0].length);
    }

    const prefix = matchPrefix(before, ctx);
    const suffix = prefix ? null : matchSuffix(after, ctx);
    const token = prefix || suffix;
    const hasFraction = /[.,]\d{1,2}$/.test(number);

    if (!token) {
      if (LETTER.test(before.slice(-1)) || LETTER.test(after.charAt(0))) continue; // part of a word: A4, MP3, 4K
      if (UNIT_AFTER.test(after)) continue; // 500 g, 20%, 2x
    }
    if (token?.needsDecimals && !hasFraction) continue;

    const currency = token && ctx.detectCurrency ? resolveCurrency(token.currencies, ctx.source) : ctx.source;
    const amount = parseAmount(number, ctx.decimalsFor(currency));
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const confidence = token ? 'high' : hasFraction ? 'medium' : 'low';
    if (confidence === 'low') {
      const digits = number.replace(/\D/g, '');
      if (digits.length < 2 || digits.length > 7) continue; // list numbers, barcodes
      if (/^0\d/.test(number)) continue; // codes like 0123
      if (/\d\s$/.test(before) || /^\s\d/.test(after)) continue; // phone numbers: 01 45 67 89
      if (/^(19|20)\d\d$/.test(number) && ctx.decimalsFor(ctx.source) > 0) continue; // years
    }

    if (prefix) start -= prefix.length;
    if (suffix) end += suffix.length;
    results.push({
      start,
      end,
      amount,
      currency,
      detected: Boolean(token) && ctx.detectCurrency,
      candidates: token ? token.currencies : null,
      confidence,
      text: text.slice(start, end).trim(),
    });
  }
  return results;
}

function joinWords(words) {
  let text = '';
  const ranges = [];
  for (const word of words) {
    const t = word.text;
    if (!t) continue;
    // Keep "12" + ".99" together when OCR splits a price into two words.
    const glue = text && ((/\d$/.test(text) && /^[.,]\d/.test(t)) || (/\d[.,]$/.test(text) && /^\d/.test(t)));
    if (text && !glue) text += ' ';
    ranges.push({ start: text.length, end: text.length + t.length, bbox: word.bbox });
    text += t;
  }
  return { text, ranges };
}

/**
 * Find prices in OCR output.
 * @param {{words:{text:string,bbox:{x0:number,y0:number,x1:number,y1:number}}[]}[]} lines
 */
export function findPrices(lines, options = {}) {
  const prices = [];
  for (const line of lines) {
    const { text, ranges } = joinWords(line.words || []);
    for (const found of findPricesInText(text, options)) {
      const covered = ranges.filter((r) => r.start < found.end && r.end > found.start);
      if (!covered.length) continue;
      const bbox = covered.reduce(
        (box, r) => ({
          x0: Math.min(box.x0, r.bbox.x0),
          y0: Math.min(box.y0, r.bbox.y0),
          x1: Math.max(box.x1, r.bbox.x1),
          y1: Math.max(box.y1, r.bbox.y1),
        }),
        { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
      );
      prices.push({ ...found, bbox });
    }
  }
  return prices;
}
