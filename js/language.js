// Languages: which OCR model reads them, how to recognise them and which currency they suggest.
// Pure functions with no DOM access, so they can be unit tested in Node.

// OCR models for non-Latin scripts (Tesseract codes) and the characters each one should produce.
const SCRIPT_CHARS = {
  jpn: /[぀-ヿ一-鿿]/u,
  chi_sim: /[一-鿿]/u,
  chi_tra: /[一-鿿]/u,
  kor: /[가-힯ᄀ-ᇿ㄰-㆏]/u,
  tha: /[฀-๿]/u,
  heb: /[֐-׿]/u,
  ara: /[؀-ۿݐ-ݿ]/u,
  rus: /[Ѐ-ӿ]/u,
  ell: /[Ͱ-Ͽ]/u,
  hin: /[ऀ-ॿ]/u,
};
export const SCRIPT_MODELS = Object.keys(SCRIPT_CHARS);

// Thai's model is "greedy" (it scores well on other scripts too), so it is tried last.
const DEFAULT_ORDER = ['jpn', 'chi_sim', 'kor', 'rus', 'ara', 'heb', 'hin', 'ell', 'tha'];

const CURRENCY_SCRIPT = {
  JPY: 'jpn', CNY: 'chi_sim', TWD: 'chi_tra', HKD: 'chi_tra', MOP: 'chi_tra', KRW: 'kor', THB: 'tha',
  ILS: 'heb', RUB: 'rus', UAH: 'rus', BYN: 'rus', KZT: 'rus', KGS: 'rus', RSD: 'rus', MKD: 'rus',
  INR: 'hin', NPR: 'hin', AED: 'ara', SAR: 'ara', EGP: 'ara', QAR: 'ara', KWD: 'ara', BHD: 'ara',
  OMR: 'ara', JOD: 'ara', MAD: 'ara', TND: 'ara', DZD: 'ara', LBP: 'ara', IQD: 'ara', IRR: 'ara', PKR: 'ara',
};

/** Order in which to try script models: hints from currencies first, then the usual order. */
export function scriptCandidates(hintCurrencies = []) {
  const ordered = [];
  for (const code of hintCurrencies) {
    const model = CURRENCY_SCRIPT[code];
    if (model && !ordered.includes(model)) ordered.push(model);
  }
  for (const model of DEFAULT_ORDER) if (!ordered.includes(model)) ordered.push(model);
  return ordered;
}

/**
 * How well a model read the text: average word confidence × share of letters in its script.
 * The right model typically scores 80–95; wrong ones mostly stay well below.
 */
export function scriptScore(lines, model) {
  const test = SCRIPT_CHARS[model];
  let letters = 0;
  let inScript = 0;
  let weighted = 0;
  for (const line of lines) {
    for (const word of line.words) {
      const chars = [...word.text].filter((c) => /\p{L}/u.test(c));
      const hits = chars.filter((c) => test.test(c)).length;
      letters += chars.length;
      inScript += hits;
      weighted += word.confidence * hits;
    }
  }
  if (!inScript) return 0;
  return (weighted / inScript) * (inScript / letters);
}

/**
 * Do the English-model results look like a script it can't read? Japanese, Thai, Hebrew etc.
 * come out as short, low-confidence nonsense words.
 */
export function looksLikeOtherScript(lines) {
  let total = 0;
  let low = 0;
  for (const line of lines) {
    for (const word of line.words) {
      if (!/\p{L}/u.test(word.text)) continue;
      total++;
      if (word.confidence < 60) low++;
    }
  }
  return low >= 3 && low / total >= 0.5;
}

/** Language code for text read by a script model. */
export function languageFromScript(model, text) {
  switch (model) {
    case 'jpn':
      return /[぀-ヿ]/u.test(text) ? 'ja' : 'zh'; // kana means Japanese; kanji alone is Chinese
    case 'chi_sim':
      return 'zh';
    case 'chi_tra':
      return 'zh-TW';
    case 'kor':
      return 'ko';
    case 'tha':
      return 'th';
    case 'heb':
      return 'he';
    case 'ara':
      if (/[پچژگ]/u.test(text)) return 'fa';
      if (/[ٹڈڑںے]/u.test(text)) return 'ur';
      return 'ar';
    case 'rus':
      if (/[іїєґ]/iu.test(text)) return 'uk';
      if (/[ђћџљњј]/iu.test(text)) return 'sr';
      if (/[әғқңөұүһ]/iu.test(text)) return 'kk';
      return 'ru';
    case 'ell':
      return 'el';
    case 'hin':
      return 'hi';
    default:
      return null;
  }
}

/**
 * The OCR model that reads a language best. Latin-alphabet languages have their own models too:
 * they know the accents (à, ñ, ő, ă…) and common words, which the English model mangles.
 */
export function modelForLanguage(lang) {
  const map = {
    ja: 'jpn', zh: 'chi_sim', 'zh-TW': 'chi_tra', ko: 'kor', th: 'tha', he: 'heb', ar: 'ara', fa: 'ara', ur: 'ara',
    ru: 'rus', uk: 'rus', sr: 'rus', kk: 'rus', el: 'ell', hi: 'hin',
    fr: 'fra', es: 'spa', de: 'deu', it: 'ita', pt: 'por', nl: 'nld', sv: 'swe', nb: 'nor', da: 'dan', fi: 'fin',
    pl: 'pol', cs: 'ces', sk: 'slk', sl: 'slv', hu: 'hun', ro: 'ron', hr: 'hrv', tr: 'tur', vi: 'vie', id: 'ind',
    ms: 'msa', tl: 'tgl', is: 'isl',
  };
  return map[lang] || 'eng';
}

export function isRtl(lang) {
  return ['he', 'ar', 'fa', 'ur'].includes(lang);
}

/* ---------- Latin-alphabet language detection ---------- */

// Everyday and menu words for each language. Matching is done with and without accents,
// because OCR often drops them.
const PROFILES = {
  en: 'the and of with to in for on or fresh chicken beef pork fish cheese salad soup coffee tea water beer wine price each open daily special served with our homemade',
  fr: 'le la les de des du au aux et avec à sans pour sur jour poulet bœuf boeuf porc poisson fromage soupe salade café thé eau bière vin frites prix chaque ouvert tous crème tarte maison gâteau pommes oignon jambon',
  es: 'el la los las de del con y sin para al en por día pollo carne cerdo pescado queso sopa ensalada café té agua cerveza vino precio cada abierto todos leche patatas papas tortilla jamón postre',
  de: 'der die das und mit ohne für von zum zur im am auf ein eine tag huhn rind schwein fisch käse suppe salat kaffee tee wasser bier wein preis stück geöffnet kuchen brot wurst',
  it: 'il lo la i gli le di del della con e senza per al alla in giorno pollo manzo maiale pesce formaggio zuppa insalata caffè tè acqua birra vino prezzo aperto pizza pasta gelato dolci',
  pt: 'o a os as de do da dos das com e sem para no na em dia frango carne porco peixe queijo sopa salada café chá água cerveja vinho preço aberto pão bolo',
  nl: 'de het een en met zonder voor van op in dag kip rund varken vis kaas soep salade koffie thee water bier wijn prijs open brood taart',
  sv: 'och med utan för av på i en ett dag kyckling nöt fläsk fisk ost soppa sallad kaffe te vatten öl vin pris öppet bröd',
  nb: 'og med uten for av på i en et dag kylling storfe svin fisk ost suppe salat kaffe te vann øl vin pris åpent brød',
  da: 'og med uden for af på i en et dag kylling okse svin fisk ost suppe salat kaffe te vand øl vin pris åbent brød',
  fi: 'ja kanssa ilman päivä kana nauta sika kala juusto keitto salaatti kahvi tee vesi olut viini hinta auki',
  pl: 'i z bez dla na w do dzień kurczak wołowina wieprzowina ryba ser zupa sałatka kawa herbata woda piwo wino cena otwarte',
  cs: 'a s bez pro na v do den kuře hovězí vepřové ryba sýr polévka salát káva čaj voda pivo víno cena otevřeno',
  hu: 'és a az egy val vel nélkül nap csirke marha sertés hal sajt leves saláta kávé tea víz sör bor ár nyitva',
  ro: 'și cu fără pentru de la în zi pui vită porc pește brânză supă salată cafea ceai apă bere vin preț deschis',
  tr: 've ile için bir gün tavuk dana et balık peynir çorba salata kahve çay su bira şarap fiyat açık',
  hr: 'i s sa bez za na u dan piletina govedina svinjetina riba sir juha salata kava čaj voda pivo vino cijena otvoreno',
  id: 'dan dengan tanpa untuk di ke hari ayam sapi babi ikan keju sup kopi teh air bir harga buka goreng nasi mie',
  ms: 'dan dengan tanpa untuk di ke hari ayam lembu ikan keju sup kopi teh air harga buka goreng nasi mee',
  vi: 'và với không cho của ngày gà bò heo cá súp cà phê trà nước bia rượu giá mở phở cơm bánh',
  tl: 'at ng sa ang mga may wala para araw manok baka baboy isda keso sopas kape tsaa tubig presyo bukas',
};

const stripAccents = (word) => word.normalize('NFD').replace(/[̀-ͯ]/g, '');
const PROFILE_SETS = Object.entries(PROFILES).map(([lang, words]) => {
  const set = new Set();
  for (const w of words.split(' ')) {
    set.add(w);
    set.add(stripAccents(w));
  }
  return [lang, set];
});

// Letters that point strongly at particular languages.
const LETTER_HINTS = [
  [/[ñ¿¡]/gu, { es: 3 }],
  [/[ãõ]/gu, { pt: 3 }],
  [/ç/gu, { fr: 1, pt: 1, tr: 1 }],
  [/ß/gu, { de: 3 }],
  [/[äöü]/gu, { de: 1, sv: 0.5, fi: 0.5, tr: 0.5, hu: 0.5 }],
  [/[øæ]/gu, { nb: 2, da: 2 }],
  [/å/gu, { sv: 1.5, nb: 1, da: 1 }],
  [/[łąężźśćń]/gu, { pl: 3 }],
  [/[řěů]/gu, { cs: 3 }],
  [/[őű]/gu, { hu: 3 }],
  [/[șță]/gu, { ro: 3 }],
  [/[ğış]/gu, { tr: 3 }],
  [/[ơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹđ]/gu, { vi: 4 }],
  [/[èêàù]/gu, { fr: 1 }],
  [/[čšž]/gu, { hr: 1, cs: 1 }],
];

/** Guess the language of Latin-alphabet text, or null if there isn't enough evidence. */
export function detectLatinLanguage(text) {
  const lower = text.toLowerCase().normalize('NFC');
  const words = lower.match(/\p{L}+/gu) || [];
  if (words.length < 2) return null;
  const scores = {};
  for (const [lang, set] of PROFILE_SETS) {
    let score = 0;
    for (const word of words) if (set.has(word) || set.has(stripAccents(word))) score++;
    scores[lang] = score;
  }
  for (const [pattern, weights] of LETTER_HINTS) {
    const count = (lower.match(pattern) || []).length;
    if (!count) continue;
    for (const [lang, weight] of Object.entries(weights)) scores[lang] += weight * Math.min(count, 3);
  }
  const [[best, top], [, second]] = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (top < 2 || top - second < 1) return null;
  return best;
}

/* ---------- Language → currency ---------- */

// Most likely currency first. English is left out on purpose: it's used everywhere.
const LANGUAGE_CURRENCIES = {
  ja: ['JPY'],
  zh: ['CNY', 'HKD', 'TWD', 'SGD', 'MOP'],
  'zh-TW': ['TWD', 'HKD', 'MOP'],
  ko: ['KRW'],
  th: ['THB'],
  he: ['ILS'],
  ar: ['AED', 'SAR', 'EGP', 'MAD', 'QAR', 'JOD', 'KWD', 'BHD', 'OMR', 'TND', 'DZD', 'LBP', 'IQD'],
  fa: ['IRR'],
  ur: ['PKR'],
  ru: ['RUB', 'BYN', 'KZT', 'KGS'],
  uk: ['UAH'],
  sr: ['RSD'],
  kk: ['KZT'],
  el: ['EUR'],
  hi: ['INR', 'NPR'],
  fr: ['EUR', 'CHF', 'CAD', 'XOF', 'XAF', 'MAD', 'TND', 'XPF'],
  es: ['EUR', 'MXN', 'ARS', 'COP', 'CLP', 'PEN', 'UYU', 'DOP', 'CRC', 'GTQ', 'BOB', 'PYG', 'HNL', 'NIO', 'PAB', 'CUP'],
  de: ['EUR', 'CHF'],
  it: ['EUR', 'CHF'],
  pt: ['EUR', 'BRL', 'AOA', 'MZN', 'CVE'],
  nl: ['EUR', 'SRD', 'AWG', 'XCG'],
  sv: ['SEK'],
  nb: ['NOK'],
  da: ['DKK'],
  fi: ['EUR'],
  is: ['ISK'],
  pl: ['PLN'],
  cs: ['CZK'],
  sk: ['EUR'],
  hu: ['HUF'],
  ro: ['RON', 'MDL'],
  hr: ['EUR'],
  sl: ['EUR'],
  tr: ['TRY'],
  vi: ['VND'],
  id: ['IDR'],
  ms: ['MYR', 'BND', 'SGD'],
  tl: ['PHP'],
};

/**
 * The currency a language suggests. If the user's "prices in" currency is one of the
 * possibilities (Spanish text while in Mexico), that one is kept.
 */
export function currencyForLanguage(lang, preferred) {
  const list = LANGUAGE_CURRENCIES[lang];
  if (!list) return null;
  return list.includes(preferred) ? preferred : list[0];
}

/* ---------- Names ---------- */

let displayNames = null;
try {
  displayNames = new Intl.DisplayNames(['en'], { type: 'language' });
} catch {
  /* very old browsers: show codes */
}

export function languageName(code) {
  if (!code) return '';
  try {
    return displayNames?.of(code) || code;
  } catch {
    return code;
  }
}

/** Languages offered for the manual "text language" choice on a scan. */
export const SCAN_LANGUAGES = [
  'en', 'fr', 'es', 'de', 'it', 'pt', 'nl', 'sv', 'nb', 'da', 'fi', 'pl', 'cs', 'hu', 'ro', 'hr', 'tr', 'vi', 'id', 'ms', 'tl',
  'ja', 'zh', 'zh-TW', 'ko', 'th', 'he', 'ar', 'fa', 'ru', 'uk', 'el', 'hi',
];

/** Languages offered as translation targets. */
export const TARGET_LANGUAGES = [
  'en', 'he', 'ar', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'ru', 'uk', 'pl', 'tr', 'sv', 'el', 'hi', 'ja', 'zh', 'ko', 'th', 'vi', 'id',
];
