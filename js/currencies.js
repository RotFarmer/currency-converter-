// Currency metadata: names, flags, decimals and a sensible default for the user's region.

const DATA = `
AED United Arab Emirates Dirham
AFN Afghan Afghani
ALL Albanian Lek
AMD Armenian Dram
ANG Netherlands Antillean Guilder|CW
AOA Angolan Kwanza
ARS Argentine Peso
AUD Australian Dollar
AWG Aruban Florin
AZN Azerbaijani Manat
BAM Bosnia-Herzegovina Mark
BBD Barbadian Dollar
BDT Bangladeshi Taka
BGN Bulgarian Lev
BHD Bahraini Dinar
BIF Burundian Franc
BMD Bermudian Dollar
BND Brunei Dollar
BOB Bolivian Boliviano
BRL Brazilian Real
BSD Bahamian Dollar
BTN Bhutanese Ngultrum
BWP Botswana Pula
BYN Belarusian Ruble
BZD Belize Dollar
CAD Canadian Dollar
CDF Congolese Franc
CHF Swiss Franc|CH|switzerland liechtenstein
CLP Chilean Peso
CNY Chinese Yuan|CN|renminbi rmb
COP Colombian Peso
CRC Costa Rican Colón
CUP Cuban Peso
CVE Cape Verdean Escudo
CZK Czech Koruna
DJF Djiboutian Franc
DKK Danish Krone|DK|greenland faroe
DOP Dominican Peso
DZD Algerian Dinar
EGP Egyptian Pound
ERN Eritrean Nakfa
ETB Ethiopian Birr
EUR Euro|EU|eurozone germany france italy spain portugal netherlands belgium austria ireland greece finland croatia slovakia slovenia estonia latvia lithuania luxembourg malta cyprus bulgaria montenegro kosovo monaco
FJD Fijian Dollar
FKP Falkland Islands Pound
GBP British Pound|GB|united kingdom england scotland wales sterling
GEL Georgian Lari
GHS Ghanaian Cedi
GIP Gibraltar Pound
GMD Gambian Dalasi
GNF Guinean Franc
GTQ Guatemalan Quetzal
GYD Guyanese Dollar
HKD Hong Kong Dollar
HNL Honduran Lempira
HTG Haitian Gourde
HUF Hungarian Forint
IDR Indonesian Rupiah|ID|bali
ILS Israeli New Shekel|IL|nis shekel israel
INR Indian Rupee
IQD Iraqi Dinar
IRR Iranian Rial
ISK Icelandic Króna
JMD Jamaican Dollar
JOD Jordanian Dinar
JPY Japanese Yen
KES Kenyan Shilling
KGS Kyrgyzstani Som
KHR Cambodian Riel
KMF Comorian Franc
KPW North Korean Won
KRW South Korean Won|KR|korea
KWD Kuwaiti Dinar
KYD Cayman Islands Dollar
KZT Kazakhstani Tenge
LAK Lao Kip
LBP Lebanese Pound
LKR Sri Lankan Rupee
LRD Liberian Dollar
LSL Lesotho Loti
LYD Libyan Dinar
MAD Moroccan Dirham
MDL Moldovan Leu
MGA Malagasy Ariary
MKD Macedonian Denar
MMK Myanmar Kyat
MNT Mongolian Tögrög
MOP Macanese Pataca
MRU Mauritanian Ouguiya
MUR Mauritian Rupee
MVR Maldivian Rufiyaa
MWK Malawian Kwacha
MXN Mexican Peso
MYR Malaysian Ringgit
MZN Mozambican Metical
NAD Namibian Dollar
NGN Nigerian Naira
NIO Nicaraguan Córdoba
NOK Norwegian Krone
NPR Nepalese Rupee
NZD New Zealand Dollar
OMR Omani Rial
PAB Panamanian Balboa
PEN Peruvian Sol
PGK Papua New Guinean Kina
PHP Philippine Peso
PKR Pakistani Rupee
PLN Polish Złoty
PYG Paraguayan Guaraní
QAR Qatari Riyal
RON Romanian Leu
RSD Serbian Dinar
RUB Russian Ruble
RWF Rwandan Franc
SAR Saudi Riyal
SBD Solomon Islands Dollar
SCR Seychellois Rupee
SDG Sudanese Pound
SEK Swedish Krona
SGD Singapore Dollar
SHP St Helena Pound
SLE Sierra Leonean Leone
SOS Somali Shilling
SRD Surinamese Dollar
SSP South Sudanese Pound
STN São Tomé & Príncipe Dobra
SYP Syrian Pound
SZL Swazi Lilangeni
THB Thai Baht
TJS Tajikistani Somoni
TMT Turkmenistani Manat
TND Tunisian Dinar
TOP Tongan Paʻanga
TRY Turkish Lira
TTD Trinidad & Tobago Dollar
TWD New Taiwan Dollar
TZS Tanzanian Shilling
UAH Ukrainian Hryvnia
UGX Ugandan Shilling
USD US Dollar|US|united states america usa ecuador panama el salvador
UYU Uruguayan Peso
UZS Uzbekistani Som
VES Venezuelan Bolívar
VND Vietnamese Đồng
VUV Vanuatu Vatu
WST Samoan Tālā
XAF Central African CFA Franc|-|cameroon gabon chad congo
XCD East Caribbean Dollar|-|antigua dominica grenada st lucia st kitts st vincent
XCG Caribbean Guilder|CW|curacao sint maarten
XOF West African CFA Franc|-|senegal ivory coast mali burkina faso niger togo benin
XPF CFP Franc|-|french polynesia new caledonia tahiti
YER Yemeni Rial
ZAR South African Rand
ZMW Zambian Kwacha
ZWG Zimbabwe Gold
`;

const EUROZONE = new Set(
  'AD AT BE BG CY DE EE ES FI FR GR HR IE IT LT LU LV MC ME MT NL PT SI SK SM VA XK'.split(' ')
);
const REGION_OVERRIDES = { EC: 'USD', SV: 'USD', PR: 'USD', PA: 'USD', LI: 'CHF', TL: 'USD', ZW: 'USD' };

let regionNames = null;
try {
  regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
} catch {
  /* older browsers: search falls back to names and codes */
}

function flagFor(region) {
  if (!region || region === '-') return '🌐';
  return String.fromCodePoint(...[...region].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

function normalize(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export const CURRENCIES = DATA.trim()
  .split('\n')
  .map((line) => {
    const code = line.slice(0, 3);
    const [name, regionField, keywords = ''] = line.slice(4).split('|');
    const region = regionField || code.slice(0, 2);
    let country = '';
    if (regionNames && region !== '-') {
      try {
        country = regionNames.of(region) || '';
      } catch {
        /* unknown region code */
      }
    }
    return {
      code,
      name,
      flag: flagFor(region),
      search: normalize(`${code} ${name} ${country} ${keywords}`),
    };
  });

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));
export const CURRENCY_CODES = new Set(BY_CODE.keys());

export function getCurrency(code) {
  return BY_CODE.get(code) || { code, name: code, flag: '🌐', search: normalize(code) };
}

const digitsCache = new Map();
/** Number of decimal places normally used for a currency (JPY → 0, USD → 2, KWD → 3). */
export function fractionDigits(code) {
  if (!digitsCache.has(code)) {
    let digits = 2;
    try {
      digits = new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions()
        .maximumFractionDigits;
    } catch {
      /* unknown to Intl: keep 2 */
    }
    digitsCache.set(code, digits);
  }
  return digitsCache.get(code);
}

export function searchCurrencies(query, list = CURRENCIES) {
  const q = normalize(query.trim());
  if (!q) return list;
  const words = q.split(/\s+/);
  const matches = list.filter((c) => words.every((w) => c.search.includes(w)));
  // Exact code matches first, then codes starting with the query.
  const rank = (c) => (c.code.toLowerCase() === q ? 0 : c.code.toLowerCase().startsWith(q) ? 1 : 2);
  return matches.sort((a, b) => rank(a) - rank(b));
}

/** Guess the user's home currency from the phone's language/region settings. */
export function guessHomeCurrency() {
  const langs = (typeof navigator !== 'undefined' && navigator.languages) || ['en-US'];
  for (const lang of langs) {
    let region = '';
    try {
      region = new Intl.Locale(lang).maximize().region || '';
    } catch {
      region = (lang.split('-')[1] || '').toUpperCase();
    }
    if (!region) continue;
    if (EUROZONE.has(region)) return 'EUR';
    if (REGION_OVERRIDES[region]) return REGION_OVERRIDES[region];
    const match = CURRENCIES.find((c) => c.code.startsWith(region));
    if (match) return match.code;
  }
  return 'USD';
}
