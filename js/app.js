import {
  CURRENCIES,
  CURRENCY_CODES,
  getCurrency,
  fractionDigits,
  searchCurrencies,
  guessHomeCurrency,
  normalize,
  currencyForRegion,
  regionName,
} from './currencies.js';
import { detectRegion } from './location.js';
import { regionForTimeZone } from './timezones.js';
import { ACCENT_PRESETS, SKINS, accentPalette, skinById, toCssText } from './theme.js';
import { getRates, ratesAreStale, refreshRates, convert } from './rates.js';
import { formatMoney, formatRate, formatInputNumber, parseUserNumber, parseAmountEntry, timeAgo, formatDateTime } from './format.js';
import { findPrices, resolveCurrency } from './price-parser.js';
import { photoToCanvas, preloadOcr, readText } from './ocr.js';
import { cameraSupported, startCamera, stopCamera, torchSupported, setTorch, grabFrame } from './camera.js';
import { readPrices, identifyLanguage, readInLanguage, mergePrices } from './scan.js';
import { textLines, labelFor } from './layout.js';
import { currencyForLanguage, languageName, isRtl, SCAN_LANGUAGES, TARGET_LANGUAGES } from './language.js';
import { translateLines, googleTranslateUrl } from './translate.js';
import { load, save } from './storage.js';

const APP_VERSION = 'v19'; // keep in step with VERSION in sw.js

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const baseLanguage = (code) => String(code || '').split('-')[0];

/* ---------- Settings ---------- */

function defaultTargetLanguage() {
  const lang = baseLanguage(navigator.language).toLowerCase();
  return TARGET_LANGUAGES.includes(lang) ? lang : 'en';
}

const settings = {
  home: null, // the default currency everything is converted to
  source: null, // the currency prices are in ("prices in")
  detectCurrency: true,
  guessCurrency: true, // use the language of a photo's text to pick its currency
  translate: true,
  translateTo: defaultTargetLanguage(),
  recent: [],
  extra: [], // up to 10 more currencies, kept in the ☰ drawer under the home currency
  refAmounts: {}, // quick reference amounts the user chose, per currency (otherwise suggested ones)
  extraOpen: false,
  homeChosen: false, // the user picked their home currency themselves
  autoSource: true, // keep "prices in" set to the currency where the phone is
  sourceRegion: null, // country detected for "prices in"
  skin: 'hud', // whole-app theme, see SKINS in theme.js
  theme: 'system', // "system" follows the phone; or "light" / "dark"
  accent: 'default', // a preset id or a custom "#rrggbb"
  font: 'hud',
  fx: { scanlines: true, grid: true, glow: true },
  ...load('settings', {}),
};
settings.home ||= guessHomeCurrency();
settings.source ||= settings.home === 'EUR' ? 'USD' : 'EUR';

function saveSettings() {
  save('settings', settings);
  syncWidget();
}

/* ---------- Android app: home-screen widgets ---------- */
// Inside the Android app (Capacitor) there are two widgets: a keypad converter and the quick reference table,
// both for the currency of the country you're in. They get your currencies, quick reference amounts, the
// rates, how each currency is written and the theme's colours, and redraw themselves from these. They also
// refresh the rates on their own, and follow the phone's time zone to a new country when you travel.

const isNativeApp = Boolean(window.Capacitor?.isNativePlatform?.());
let widgetTimer = 0;
let lastWidgetData = '';

function syncWidget() {
  if (!isNativeApp) return;
  clearTimeout(widgetTimer);
  widgetTimer = setTimeout(sendWidgetData, 400);
}

/** Any CSS colour as #rrggbb (transparency dropped), for Android. */
function hexColor(value, fallback) {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.fillStyle = fallback;
  ctx.fillStyle = value || fallback;
  const out = ctx.fillStyle;
  if (out.startsWith('#')) return out;
  const [r, g, b] = (out.match(/[\d.]+/g) || []).map(Number);
  return `#${[r, g, b].map((n) => Math.round(n || 0).toString(16).padStart(2, '0')).join('')}`;
}

/** What goes around the number when this currency is written, e.g. "¥" and "", or "CHF " and "". */
function moneyParts(code) {
  const sample = formatMoney(1234.5, code);
  const match = /^(.*?)(\d(?:[\d.,\s\u00a0\u202f]*\d)?)(.*)$/.exec(sample);
  return match ? { prefix: match[1], suffix: match[3] } : { prefix: '', suffix: ` ${code}` };
}

/** Time zone → country and country → currency, so the widgets can tell where you are after travelling. */
let zoneTables = null;
function getZoneTables() {
  if (zoneTables) return zoneTables;
  const tzRegions = {};
  const regionCurrencies = {};
  for (const zone of Intl.supportedValuesOf?.('timeZone') || []) {
    const region = regionForTimeZone(zone);
    const code = region && currencyForRegion(region);
    if (!code) continue;
    tzRegions[zone] = region;
    regionCurrencies[region] = code;
  }
  zoneTables = { tzRegions, regionCurrencies };
  return zoneTables;
}

/** The prices from the last scan (photo or live camera), listed by the Scan widget. */
let lastScan = load('lastScan', null);

function rememberScan(items, currencyFor, labelFor, at) {
  const list = items
    .map((item) => ({ amount: item.amount, code: currencyFor(item), label: labelFor(item) || null }))
    .filter((item) => item.amount > 0 && item.code)
    .slice(0, 6);
  if (!list.length) return;
  const next = { at, items: list };
  if (JSON.stringify(next) === JSON.stringify(lastScan)) return;
  lastScan = next;
  save('lastScan', lastScan);
  syncWidget();
}

function sendWidgetData() {
  const rates = getRates();
  const { home } = settings;
  const css = getComputedStyle(document.documentElement);
  const color = (name, fallback) => hexColor(css.getPropertyValue(name).trim(), fallback);
  const money = {};
  for (const { code } of CURRENCIES) {
    if (rates && !rates.rates[code]) continue;
    const { prefix, suffix } = moneyParts(code);
    money[code] = [prefix, suffix, fractionDigits(code)];
  }
  const data = {
    home,
    source: settings.source,
    autoSource: settings.autoSource,
    sourceRegion: settings.autoSource ? settings.sourceRegion : null,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    extra: settings.extra,
    refAmounts: settings.refAmounts || {},
    lastScan,
    money,
    rates: rates ? rates.rates : {},
    ratesUpdatedAt: rates?.updatedAt || 0,
    ratesFetchedAt: rates?.fetchedAt || 0,
    ...(settings.autoSource ? getZoneTables() : {}),
    colors: {
      bg: color('--panel', '#040605'),
      text: color('--text', '#cfe3d3'),
      dim: color('--text-faint', '#6f8a76'),
      accent: color('--accent', '#7dff72'),
      line: color('--line-strong', '#2a5636'),
    },
  };
  const json = JSON.stringify(data);
  if (json === lastWidgetData) return;
  lastWidgetData = json;
  window.Capacitor.nativePromise('Widgets', 'update', data).catch(() => {
    lastWidgetData = '';
  });
}

function rememberRecent(code) {
  settings.recent = [code, ...settings.recent.filter((c) => c !== code)].slice(0, 6);
}

function setCurrency(role, code) {
  const firstHome = role === 'home' && !settings.homeChosen;
  settings[role] = code;
  if (role === 'home') settings.homeChosen = true;
  if (role === 'source') settings.autoSource = false; // the user chose it, so stop following location
  rememberRecent(code);
  saveSettings();
  renderAll();
  if (firstHome) detectSource({ askPermission: true });
}

/* ---------- Theme ---------- */

const darkQuery = matchMedia('(prefers-color-scheme: dark)');

const DEFAULT_LOOK = { skin: 'hud', accent: 'default', font: 'hud', fx: { scanlines: true, grid: true, glow: true } };

/** The custom accent colour, or null for the default green (which uses the stylesheet's colours). */
function accentColor() {
  if (/^#[0-9a-f]{6}$/i.test(settings.accent)) return settings.accent;
  const preset = ACCENT_PRESETS.find((p) => p.id === settings.accent);
  return preset && preset.id !== 'default' ? preset.color : null;
}

function setAttr(name, on, value) {
  if (on) document.documentElement.dataset[name] = value;
  else delete document.documentElement.dataset[name];
}

function applyTheme() {
  const { theme, fx } = settings;
  const root = document.documentElement;
  const skin = skinById(settings.skin);
  const hud = skin.id === 'hud';
  setAttr('theme', theme === 'light' || theme === 'dark', theme);
  // Some themes only come in light or only in dark.
  const dark = skin.mode ? skin.mode === 'dark' : theme === 'dark' || (theme !== 'light' && darkQuery.matches);
  setAttr('skin', !hud, skin.id);
  setAttr('mode', !hud, dark ? 'dark' : 'light');

  // Accent colour: the whole colour set is built from it, for both modes.
  const color = accentColor();
  const palettes = { dark: color ? accentPalette(color, true) : {}, light: color ? accentPalette(color, false) : {} };
  if (!fx.glow && color) palettes.dark['--glow'] = palettes.light['--glow'] = 'transparent';
  // Accent colour and effects belong to the HUD theme; the other themes bring their own.
  root.style.cssText = hud ? toCssText(dark ? palettes.dark : palettes.light) : '';
  // The camera and scanning overlay always use the dark colours.
  for (const el of [$('#camera'), $('#scan-progress')]) el.style.cssText = toCssText(palettes.dark);
  // Remembered so the next launch can apply it before the page draws.
  save('themeCache', { dark: toCssText(palettes.dark), light: toCssText(palettes.light) });

  setAttr('scanlines', hud && !fx.scanlines, 'off');
  setAttr('grid', hud && !fx.grid, 'off');
  setAttr('glow', hud && !fx.glow, 'off');
  setAttr('font', hud && settings.font === 'clean', 'clean');

  // Colours the phone's status bar / browser bar to match.
  const css = getComputedStyle(root);
  const barColor = css.getPropertyValue('--theme-color').trim() || css.getPropertyValue('--bg').trim();
  $('meta[name="theme-color"]').setAttribute('content', barColor || '#040605');
  renderAppearanceControls();
  syncWidget();
}

function renderAppearanceControls() {
  const press = (selector, attr, value) => {
    for (const button of $$(selector)) button.setAttribute('aria-pressed', String(button.dataset[attr] === value));
  };
  const skin = skinById(settings.skin);
  press('[data-skin-option]', 'skinOption', skin.id);
  press('[data-theme-option]', 'themeOption', settings.theme || 'system');
  $('#hud-options').hidden = skin.id !== 'hud';
  const note = $('#skin-mode-note');
  note.hidden = !skin.mode;
  note.textContent = skin.mode ? `${skin.name} only comes in ${skin.mode}, so this switch applies to the other themes.` : '';
  $('#theme-options').classList.toggle('muted', Boolean(skin.mode));
  press('[data-font-option]', 'fontOption', settings.font);
  const custom = /^#[0-9a-f]{6}$/i.test(settings.accent);
  press('[data-accent]', 'accent', custom ? null : settings.accent);
  const customSwatch = $('#accent-custom-swatch');
  customSwatch.setAttribute('aria-pressed', String(custom));
  customSwatch.style.setProperty('--swatch', custom ? settings.accent : '');
  if (custom) $('#accent-custom').value = settings.accent;
  for (const toggle of $$('[data-fx]')) toggle.checked = settings.fx[toggle.dataset.fx];
}

function saveLook() {
  saveSettings();
  applyTheme();
}

$('#skin-options').addEventListener('click', (event) => {
  const card = event.target.closest('[data-skin-option]');
  if (!card || !SKINS.some((skin) => skin.id === card.dataset.skinOption)) return;
  settings.skin = card.dataset.skinOption;
  saveLook();
});
$('#accent-options').addEventListener('click', (event) => {
  const swatch = event.target.closest('[data-accent]');
  if (!swatch) return;
  settings.accent = swatch.dataset.accent;
  saveLook();
});
// Updates live while the colour picker is open.
$('#accent-custom').addEventListener('input', (event) => {
  settings.accent = event.target.value;
  saveLook();
});
$('#font-options').addEventListener('click', (event) => {
  const button = event.target.closest('[data-font-option]');
  if (!button) return;
  settings.font = button.dataset.fontOption;
  saveLook();
});
for (const toggle of $$('[data-fx]')) {
  toggle.addEventListener('change', () => {
    settings.fx = { ...settings.fx, [toggle.dataset.fx]: toggle.checked };
    saveLook();
  });
}
$('#reset-look').addEventListener('click', () => {
  Object.assign(settings, structuredClone(DEFAULT_LOOK));
  saveLook();
  toast('Default look restored');
});

darkQuery.addEventListener('change', applyTheme);
$('#theme-options').addEventListener('click', (event) => {
  const button = event.target.closest('[data-theme-option]');
  if (!button) return;
  settings.theme = button.dataset.themeOption;
  saveLook();
});

/* ---------- Home currency and location ---------- */

let lastDetect = 0;

/** Set "prices in" to the currency of the country the phone is in. */
async function detectSource({ askPermission = false } = {}) {
  if (!settings.autoSource) return;
  lastDetect = Date.now();
  const found = await detectRegion({ askPermission });
  const code = currencyForRegion(found?.region);
  if (!code || !CURRENCY_CODES.has(code) || !settings.autoSource) return;
  const changed = code !== settings.source;
  settings.source = code;
  settings.sourceRegion = found.region;
  saveSettings();
  renderAll();
  if (changed) toast(`Prices in ${code} · ${regionName(found.region)}`);
}

function openHomeChooser() {
  openPicker({
    title: 'Your home currency',
    items: currencyItems(),
    selected: settings.homeChosen ? settings.home : null,
    suggested: [guessHomeCurrency()],
    recent: settings.recent,
    placeholder: 'Search currency or country',
    onSelect: (code) => setCurrency('home', code),
  });
}

/* ---------- Rates ---------- */

let ratesLoading = false;
let ratesFailed = false;

async function updateRates({ manual = false } = {}) {
  ratesLoading = true;
  renderRatesStatus();
  try {
    await refreshRates();
    ratesFailed = false;
    if (manual) toast('Exchange rates updated');
  } catch {
    ratesFailed = true;
    if (manual || !getRates()) {
      toast(getRates() ? 'Couldn’t update rates. Using your saved rates.' : 'Couldn’t download rates. Check your connection.');
    }
  } finally {
    ratesLoading = false;
    renderAll();
  }
}

function renderRatesStatus() {
  const pill = $('#rates-pill');
  const rates = getRates();
  let state;
  let label; // kept short so the header fits on a phone
  let description;
  if (!rates) {
    state = ratesLoading ? 'loading' : 'error';
    label = ratesLoading ? 'Rates…' : 'No rates';
    description = ratesLoading ? 'Loading exchange rates' : 'No exchange rates yet. Tap to retry.';
  } else if (ratesLoading) {
    state = 'loading';
    label = 'Rates…';
    description = 'Updating exchange rates';
  } else {
    state = ratesFailed || ratesAreStale() ? 'old' : 'ok';
    const age = Math.max(0, Date.now() - rates.updatedAt);
    const short = age < 3600e3 ? `${Math.max(1, Math.round(age / 60e3))}m` : age < 48 * 3600e3 ? `${Math.round(age / 3600e3)}h` : `${Math.round(age / 86400e3)}d`;
    label = `${ratesFailed ? 'Offline' : 'Rates'} ${short}`;
    description = `${ratesFailed ? 'Offline. ' : ''}Exchange rates updated ${timeAgo(rates.updatedAt)}. Tap to refresh.`;
  }
  pill.dataset.state = state;
  $('.label', pill).textContent = label;
  pill.setAttribute('aria-label', description);
  pill.title = description;
  $('#rates-detail').textContent = rates ? `${formatDateTime(rates.updatedAt)} · ${rates.provider}` : 'Not downloaded yet';
}

/* ---------- Tabs ---------- */

const TABS = { convert: ['Convert', '01'], scan: ['Scan', '02'], settings: ['Settings', '03'] };
let currentTab = 'convert';

function showTab(tab) {
  if (tab !== currentTab) window.scrollTo(0, 0);
  currentTab = tab;
  for (const view of $$('.view[data-view]')) view.hidden = view.dataset.view !== tab;
  for (const button of $$('.tabbar button')) {
    if (button.dataset.tab === tab) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  $('#view-title').textContent = TABS[tab][0];
  $('#view-code').textContent = TABS[tab][1];
  if (tab === 'scan') warmUpOcr();
}

/* ---------- Sheets (picker, price editor) ---------- */
// Each open sheet adds a history entry so the Android back button closes it.

const openSheets = [];
let ignoredPops = 0;

function openSheet(sheet) {
  sheet.hidden = false;
  openSheets.push(sheet);
  history.pushState({ sheet: sheet.id }, '');
  document.body.style.overflow = 'hidden';
}

function closeSheet(sheet, { fromHistory = false } = {}) {
  if (sheet.hidden) return;
  sheet.hidden = true;
  openSheets.splice(openSheets.indexOf(sheet), 1);
  if (!openSheets.length) document.body.style.overflow = '';
  sheet.dispatchEvent(new Event('sheetclose'));
  if (!fromHistory && history.state?.sheet === sheet.id) {
    ignoredPops++;
    history.back();
  }
}

window.addEventListener('popstate', () => {
  if (ignoredPops > 0) {
    ignoredPops--;
    return;
  }
  const top = openSheets.at(-1);
  if (top) closeSheet(top, { fromHistory: true });
});

/* ---------- Picker (currencies and languages) ---------- */

const picker = $('#picker');
const pickerSearch = $('#picker-search');
const pickerList = $('#picker-list');
let pickerState = null;

function symbolGlyph(currency) {
  // Codes without a short symbol (CHF, AED) get the generic currency sign.
  return currency.symbol === currency.code || currency.symbol.length > 3 ? '¤' : currency.symbol;
}

function currencyItems() {
  const rates = getRates();
  return CURRENCIES.filter((c) => !rates || rates.rates[c.code]).map((c) => ({
    code: c.code,
    glyph: symbolGlyph(c),
    title: c.code,
    sub: c.name,
    search: c.search,
  }));
}

function nativeLanguageName(code) {
  try {
    return new Intl.DisplayNames([code], { type: 'language' }).of(code) || '';
  } catch {
    return '';
  }
}

function languageItems(codes) {
  return codes.map((code) => {
    const name = code === 'auto' ? 'Auto-detect' : languageName(code);
    const native = code === 'auto' ? 'From the photo' : nativeLanguageName(code);
    return {
      code,
      glyph: code === 'auto' ? '◎' : code.slice(0, 2).toUpperCase(),
      title: name,
      sub: native !== name ? native : '',
      search: normalize(`${code} ${name} ${native}`),
    };
  });
}

function openPicker({ title, items, selected, onSelect, recent = [], suggested = [], placeholder = 'Search' }) {
  pickerState = { items, selected, onSelect, recent, suggested };
  $('#picker-title').textContent = title;
  pickerSearch.value = '';
  pickerSearch.placeholder = placeholder;
  renderPickerList();
  openSheet(picker);
  pickerList.scrollTop = 0;
  if (!matchMedia('(pointer: coarse)').matches) pickerSearch.focus();
}

function renderPickerList() {
  const query = pickerSearch.value.trim();
  const { items, selected, recent, suggested } = pickerState;
  const isSelected = (code) => code === selected;
  const list = searchCurrencies(query, items);
  const row = (item) => `
    <button type="button" class="picker-row" role="option" aria-selected="${isSelected(item.code)}" data-code="${escapeHtml(item.code)}">
      <span class="sym${item.glyph.length > 2 ? ' long' : ''}" aria-hidden="true">${escapeHtml(item.glyph)}</span>
      <span class="title">${escapeHtml(item.title)}</span>
      <span class="sub">${escapeHtml(item.sub)}</span>
      ${isSelected(item.code) ? '<svg aria-hidden="true"><use href="#i-check"/></svg>' : ''}
    </button>`;
  let html = '';
  if (!query && (recent.length || suggested.length)) {
    const pick = (codes) => codes.map((code) => items.find((i) => i.code === code)).filter(Boolean);
    const suggestedItems = pick(suggested);
    const recentItems = pick(recent.filter((code) => !suggested.includes(code)));
    if (suggestedItems.length) html += `<div class="picker-section">Suggested</div>${suggestedItems.map(row).join('')}`;
    if (recentItems.length) html += `<div class="picker-section">Recent</div>${recentItems.map(row).join('')}`;
    html += '<div class="picker-section">All</div>';
  }
  html += list.length ? list.map(row).join('') : `<div class="picker-empty">No match for “${escapeHtml(query)}”</div>`;
  pickerList.innerHTML = html;
}

pickerSearch.addEventListener('input', renderPickerList);
pickerList.addEventListener('click', (event) => {
  const row = event.target.closest('[data-code]');
  if (!row || !pickerState) return;
  const { onSelect } = pickerState;
  closeSheet(picker);
  onSelect(row.dataset.code);
});

document.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-pick]');
  if (!trigger) return;
  const role = trigger.dataset.pick;
  openPicker({
    title: role === 'home' ? 'Default currency' : 'Prices are in',
    items: currencyItems(),
    selected: settings[role],
    recent: settings.recent,
    placeholder: 'Search currency or country',
    onSelect: (code) => setCurrency(role, code),
  });
});

/* ---------- Converter ---------- */

const inputs = { source: $('#amount-source'), home: $('#amount-home') };
// One amount drives every field. `field` is the one last typed in: "source", "home" or
// "extra:GBP" for a row in the ☰ drawer. Every other field shows the amount converted.
const converter = { field: 'source', value: null };

function fieldCurrency(field) {
  return field === 'source' || field === 'home' ? settings[field] : field.slice(6);
}

/** The current amount in a currency, or null if nothing has been typed. */
function amountIn(code) {
  if (converter.value == null) return null;
  return convert(converter.value, fieldCurrency(converter.field), code);
}

/** Start from an amount in a given field, e.g. after tapping a quick-reference row. */
function setAmount(field, value) {
  converter.field = field;
  converter.value = value;
  const input = field === 'source' || field === 'home' ? inputs[field] : $(`.extra-input[data-extra="${field.slice(6)}"]`);
  if (input) input.value = formatInputNumber(value, fieldCurrency(field));
  renderConverterValues();
}

function fitInput(input) {
  const length = input.value.length;
  input.style.fontSize = length > 13 ? '22px' : length > 9 ? '28px' : '';
}

function renderConverterValues() {
  for (const [name, input] of Object.entries(inputs)) {
    // Leave the field being typed in alone, so the cursor and what was typed stay put.
    if (converter.field !== name) input.value = formatInputNumber(amountIn(settings[name]), settings[name]);
    fitInput(input);
    $('[data-clear]', input.parentElement).hidden = input.value === '';
    input.setAttribute('aria-label', `Amount in ${settings[name]}`);
  }
  updateExtraValues();
}

const MAX_EXTRA = 10;
let renderedExtraKey = '';

function renderExtraCurrencies() {
  const count = settings.extra.length;
  $('#extra-count').textContent = String(count);
  $('#extra-menu').setAttribute('aria-expanded', String(settings.extraOpen));
  $('#extra-menu').setAttribute('aria-label', `Other currencies, ${count} added. ${settings.extraOpen ? 'Hide' : 'Show'}`);
  $('#extra').hidden = !settings.extraOpen;
  $('#extra-limit').textContent = `${count}/${MAX_EXTRA}`;
  $('#extra-add').hidden = count >= MAX_EXTRA;
  // Only rebuild the rows when the list changes, so typing in one isn't interrupted.
  const key = `${settings.extraOpen}|${settings.extra.join(',')}`;
  if (key !== renderedExtraKey) {
    renderedExtraKey = key;
    $('#extra-list').innerHTML = count
      ? settings.extra
          .map((code) => {
            const currency = getCurrency(code);
            const glyph = symbolGlyph(currency);
            return `<div class="extra-row">
              <span class="sym${glyph.length > 2 ? ' long' : ''}" aria-hidden="true">${escapeHtml(glyph)}</span>
              <span class="code">${code}</span>
              <span class="name">${escapeHtml(currency.name)}</span>
              <input class="extra-input" data-extra="${code}" inputmode="decimal" autocomplete="off" enterkeyhint="done"
                     placeholder="0" aria-label="Amount in ${code}">
              <button type="button" class="row-remove" data-remove="${code}" aria-label="Remove ${code}"><svg><use href="#i-close"/></svg></button>
            </div>`;
          })
          .join('')
      : '<p class="empty-note">Tap + to add up to 10 currencies.</p>';
  }
  updateExtraValues();
}

function updateExtraValues() {
  for (const input of $$('.extra-input')) {
    const code = input.dataset.extra;
    if (converter.field === `extra:${code}` && document.activeElement === input) continue;
    input.value = formatInputNumber(amountIn(code), code);
  }
}

$('#extra-list').addEventListener('input', (event) => {
  const input = event.target.closest('.extra-input');
  if (!input) return;
  converter.field = `extra:${input.dataset.extra}`;
  converter.value = parseUserNumber(input.value);
  renderConverterValues();
});

function saveExtra() {
  saveSettings();
  renderExtraCurrencies();
  renderReference();
}

$('#extra-menu').addEventListener('click', () => {
  settings.extraOpen = !settings.extraOpen;
  saveExtra();
  if (settings.extraOpen) requestAnimationFrame(revealExtra);
});

/** The drawer opens downwards near the bottom of the screen: scroll so it can be seen, keeping its button in view. */
function revealExtra() {
  const panelBottom = $('.converter').getBoundingClientRect().bottom;
  const button = $('#extra-menu').getBoundingClientRect();
  const visibleBottom = $('.tabbar').getBoundingClientRect().top - 8;
  const visibleTop = $('.topbar').getBoundingClientRect().bottom + 12;
  const overflow = panelBottom - visibleBottom;
  if (overflow <= 0) return;
  window.scrollBy({ top: Math.min(overflow, button.top - visibleTop), behavior: 'smooth' });
}

$('#extra-add').addEventListener('click', () => {
  openPicker({
    title: 'Add currency',
    items: currencyItems().filter((item) => !settings.extra.includes(item.code)),
    recent: settings.recent.filter((code) => !settings.extra.includes(code)),
    placeholder: 'Search currency or country',
    onSelect: (code) => {
      if (settings.extra.length >= MAX_EXTRA || settings.extra.includes(code)) return;
      settings.extra = [...settings.extra, code];
      saveExtra();
    },
  });
});

$('#extra-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-remove]');
  if (!button) return;
  const code = button.dataset.remove;
  if (converter.field === `extra:${code}`) {
    // The amount was typed in this row: keep it, now held in the "price in" field.
    converter.value = amountIn(settings.source);
    converter.field = 'source';
  }
  settings.extra = settings.extra.filter((c) => c !== code);
  saveExtra();
  renderConverterValues();
});

function renderRateLine() {
  const { source, home } = settings;
  const rate = convert(1, source, home);
  const el = $('#rate-line');
  if (rate == null) {
    el.textContent = 'Awaiting rates';
    return;
  }
  // Show "100 JPY = 0.6557 USD" rather than "1 JPY = 0.0065 USD".
  const units = 10 ** Math.max(0, Math.round(-Math.log10(rate)));
  el.textContent = `${units.toLocaleString()} ${source} = ${formatRate(rate * units)} ${home}`;
}

// Quick reference: every table is in your home currency. One swipeable page per other
// currency: "price in" first, then the ☰ extras.
const refTrack = $('#reference');
const refTabs = $('#ref-tabs');
let refActive = null; // currency of the page on screen

function referenceTargets() {
  return [settings.source, ...settings.extra].filter((code, i, all) => code !== settings.home && all.indexOf(code) === i);
}

const MAX_REF_AMOUNTS = 20;

/** Round amounts in a currency: 1, 2, 5, 10 … scaled to what one unit of your home currency is worth in it. */
function suggestedAmounts(code) {
  const homeInCode = convert(1, settings.home, code);
  const base = 10 ** Math.max(0, Math.floor(Math.log10(homeInCode)));
  return [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].map((step) => step * base);
}

/** The amounts shown for a currency: the user's own list if they edited it, else the suggested ones. */
function referenceAmounts(code) {
  const custom = settings.refAmounts?.[code];
  return Array.isArray(custom) ? custom : suggestedAmounts(code);
}

/** Amounts in a currency and what each is at home. */
function referenceTable(code) {
  const { home } = settings;
  const amounts = referenceAmounts(code);
  if (!amounts.length) return `<p class="empty-note">No amounts for ${code}. Tap Edit to add some.</p>`;
  const rows = amounts.map((amount) => {
    return `<button type="button" class="ref-row" data-amount="${amount}" data-currency="${code}">
      <span>${formatMoney(amount, code)}</span><span>${formatMoney(convert(amount, code, home), home)}</span>
    </button>`;
  });
  return `<div class="ref-head"><span>${code}</span><span>${home}</span></div>${rows.join('')}`;
}

function renderReference() {
  const { source, home } = settings;
  const targets = referenceTargets();
  const ready = convert(1, home, source) != null;
  refTabs.hidden = !ready || targets.length < 2;
  $('#ref-edit').hidden = !ready || !targets.length;
  $('#ref-hint').textContent = ready && targets.length > 1 ? 'Swipe ← →' : '';
  $('#ref-dots').innerHTML = '';
  if (!ready) {
    refTrack.innerHTML = '<p class="empty-note">Exchange rates download automatically when you’re online.</p>';
    return;
  }
  if (!targets.length) {
    refTabs.hidden = true;
    refTrack.innerHTML = '<p class="empty-note">Set “Price in” to another currency, or add some with ☰, to see a table.</p>';
    return;
  }
  if (!targets.includes(refActive)) refActive = targets[0];
  refTabs.innerHTML = targets
    .map((code) => {
      const glyph = symbolGlyph(getCurrency(code));
      return `<button type="button" class="ref-tab" role="tab" data-ref-tab="${code}" aria-selected="${code === refActive}">
        <span class="glyph" aria-hidden="true">${escapeHtml(glyph)}</span>${code}</button>`;
    })
    .join('');
  refTrack.innerHTML = targets
    .map((code) => `<div class="ref-page" role="tabpanel" data-ref-page="${code}" aria-label="${code} to ${home}">${referenceTable(code)}</div>`)
    .join('');
  if (targets.length > 1) $('#ref-dots').innerHTML = targets.map((code) => `<span class="ref-dot${code === refActive ? ' active' : ''}"></span>`).join('');
  // Keep showing the same currency after a re-render.
  refTrack.scrollLeft = targets.indexOf(refActive) * refTrack.clientWidth;
}

function markReferenceTab(code) {
  if (code === refActive) return;
  refActive = code;
  const targets = referenceTargets();
  for (const tab of refTabs.querySelectorAll('[data-ref-tab]')) {
    const active = tab.dataset.refTab === code;
    tab.setAttribute('aria-selected', String(active));
    if (active) tab.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }
  $$('.ref-dot').forEach((dot, i) => dot.classList.toggle('active', targets[i] === code));
}

// Swiping the table switches currency; the tabs follow.
let refScrollFrame = 0;
refTrack.addEventListener('scroll', () => {
  cancelAnimationFrame(refScrollFrame);
  refScrollFrame = requestAnimationFrame(() => {
    const index = Math.round(refTrack.scrollLeft / Math.max(1, refTrack.clientWidth));
    const code = referenceTargets()[index];
    if (code) markReferenceTab(code);
  });
});

refTabs.addEventListener('click', (event) => {
  const tab = event.target.closest('[data-ref-tab]');
  if (!tab) return;
  const index = referenceTargets().indexOf(tab.dataset.refTab);
  markReferenceTab(tab.dataset.refTab);
  refTrack.scrollTo({ left: index * refTrack.clientWidth, behavior: 'smooth' });
});

for (const input of Object.values(inputs)) {
  input.addEventListener('input', () => {
    converter.field = input.dataset.side;
    converter.value = parseUserNumber(input.value);
    renderConverterValues();
  });
}

$('#reference').addEventListener('click', (event) => {
  const row = event.target.closest('[data-amount]');
  if (!row) return;
  // Put the amount in the field for that currency: "price in", or its row in the ☰ drawer.
  const code = row.dataset.currency;
  setAmount(code === settings.source ? 'source' : `extra:${code}`, Number(row.dataset.amount));
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// Editing the quick reference: the amounts for the currency on screen.
const refSheet = $('#ref-sheet');
let refEditing = null;

function openRefEditor() {
  if (!refActive) return;
  refEditing = refActive;
  $('#ref-add-input').value = '';
  renderRefEditor();
  openSheet(refSheet);
}

function renderRefEditor() {
  const code = refEditing;
  if (!code) return;
  const { home } = settings;
  const currency = getCurrency(code);
  const amounts = referenceAmounts(code);
  const chip = (amount, add) => {
    const label = formatMoney(amount, code);
    return `<button type="button" class="ref-chip${add ? ' suggest' : ''}" data-ref-${add ? 'add' : 'remove'}="${amount}" aria-label="${add ? 'Add' : 'Remove'} ${label}">
      <span>${label}</span><span class="home">${formatMoney(convert(amount, code, home), home)}</span>
      <svg aria-hidden="true"><use href="#i-${add ? 'plus' : 'close'}"/></svg></button>`;
  };
  $('#ref-sheet-title').textContent = `Quick reference: ${code}`;
  $('#ref-sheet-note').textContent = `Amounts in ${currency ? currency.name : code}, shown in ${home}. Tap one to remove it. Each currency keeps its own list.`;
  $('#ref-chips').innerHTML = amounts.length ? amounts.map((amount) => chip(amount, false)).join('') : '<p class="empty-note">No amounts yet. Add some below.</p>';
  const suggestions = suggestedAmounts(code).filter((amount) => !amounts.includes(amount));
  $('#ref-suggest-label').hidden = $('#ref-suggest').hidden = !suggestions.length;
  $('#ref-suggest').innerHTML = suggestions.map((amount) => chip(amount, true)).join('');
  $('#ref-add-sym').textContent = symbolGlyph(currency);
  $('#ref-reset').disabled = !Array.isArray(settings.refAmounts?.[code]);
}

function setRefAmounts(code, amounts) {
  const list = [...new Set(amounts.map((amount) => Math.round(amount * 100) / 100))].filter((amount) => amount > 0).sort((x, y) => x - y);
  const suggested = suggestedAmounts(code);
  const isSuggested = list.length === suggested.length && list.every((amount, i) => amount === suggested[i]);
  const refAmounts = { ...settings.refAmounts };
  if (isSuggested) delete refAmounts[code];
  else refAmounts[code] = list;
  settings.refAmounts = refAmounts;
  saveSettings();
  renderReference();
  renderRefEditor();
}

function addRefAmount(amount) {
  if (!(amount > 0)) return false;
  const amounts = referenceAmounts(refEditing);
  if (amounts.includes(Math.round(amount * 100) / 100)) return true;
  if (amounts.length >= MAX_REF_AMOUNTS) {
    toast(`Up to ${MAX_REF_AMOUNTS} amounts per currency`);
    return false;
  }
  setRefAmounts(refEditing, [...amounts, amount]);
  return true;
}

$('#ref-edit').addEventListener('click', openRefEditor);
refSheet.addEventListener('click', (event) => {
  const remove = event.target.closest('[data-ref-remove]');
  const add = event.target.closest('[data-ref-add]');
  if (remove) setRefAmounts(refEditing, referenceAmounts(refEditing).filter((amount) => amount !== Number(remove.dataset.refRemove)));
  else if (add) addRefAmount(Number(add.dataset.refAdd));
});
$('#ref-add').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = $('#ref-add-input');
  if (addRefAmount(parseAmountEntry(input.value, fractionDigits(refEditing)))) input.value = '';
  else input.focus();
});
$('#ref-reset').addEventListener('click', () => {
  setRefAmounts(refEditing, suggestedAmounts(refEditing));
  toast('Suggested amounts restored');
});

$('#welcome-choose').addEventListener('click', openHomeChooser);

/* ---------- Scan ---------- */

const photo = $('#photo');
const photoWrap = $('#photo-wrap');
const scan = {
  status: 'idle', // idle | reading | done | error
  run: 0,
  hasPhoto: false,
  error: null,
  mode: 'converted', // converted | text | original
  englishLines: [],
  englishPrices: [],
  items: [],
  edited: false, // the user changed a price, so later passes must not replace the list
  lines: [], // text lines (prices removed) used for item names
  groups: [], // pieces of text to translate (multi-line item names kept together)
  language: null,
  langRun: 0,
  langStatus: 'idle', // idle | detecting | done | none | failed
  langProgress: '',
  translations: null, // Map of line text → translation
  translateStatus: 'idle', // idle | busy | done | same | off | failed
  translateError: '',
};
let ocrWarm = false;

const OCR_STEPS = {
  'loading tesseract core': 'Downloading text reader (first time only)…',
  'initializing tesseract': 'Starting text reader…',
  'loading language traineddata': 'Downloading text model (first time only)…',
  'initializing api': 'Starting text reader…',
  'recognizing text': 'Reading prices…',
};

function warmUpOcr() {
  if (ocrWarm) return;
  ocrWarm = true;
  const status = $('#ocr-status');
  const ready = $('#ocr-ready');
  ready.textContent = 'Loading';
  status.textContent = 'Getting the text reader ready…';
  preloadOcr()
    .then(() => {
      ready.textContent = 'Ready';
      status.textContent = '';
    })
    .catch(() => {
      ocrWarm = false;
      ready.textContent = 'Offline';
      status.textContent = 'The text reader downloads the first time you scan (about 6 MB).';
    });
}

function setProgress(text, progress) {
  $('#scan-progress-text').textContent = text;
  $('#scan-progress-bar').style.width = `${Math.round((progress || 0) * 100)}%`;
}

function parseOptions() {
  return {
    source: settings.source,
    detectCurrency: settings.detectCurrency,
    knownCodes: CURRENCY_CODES,
    decimalsFor: fractionDigits,
  };
}

/** The currency suggested by the language of the photo's text, if any. */
function languageCurrency() {
  return settings.guessCurrency && scan.language ? currencyForLanguage(scan.language, settings.source) : null;
}

/**
 * The currency a detected sign stands for. Ambiguous signs ($, ¥, kr) follow the language's
 * currency, else the user's setting.
 */
function resolveSign(candidates, langCurrency) {
  const base = langCurrency || settings.source;
  // ₩ and ¥ look alike; on a Korean menu a "¥" is almost certainly a misread won sign.
  if (base === 'KRW' && candidates.includes('JPY')) return 'KRW';
  return resolveCurrency(candidates, base);
}

/**
 * The currency for prices without a sign, and why: the currency most signed prices in the
 * same picture use ("signs"), else the text's language ("language"), else the setting.
 */
function photoCurrency(items = scan.items, langCurrency = languageCurrency()) {
  if (settings.detectCurrency) {
    const counts = new Map();
    for (const item of items) {
      if (!item.candidates || item.fixedCurrency) continue;
      const code = resolveSign(item.candidates, langCurrency);
      counts.set(code, (counts.get(code) || 0) + 1);
    }
    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
    for (const [code, n] of counts) if (n / total >= 0.6) return { code, reason: 'signs' };
  }
  return langCurrency ? { code: langCurrency, reason: 'language' } : { code: settings.source, reason: 'setting' };
}

function currencyOf(item, items = scan.items, langCurrency = languageCurrency()) {
  if (item.fixedCurrency) return item.fixedCurrency;
  if (item.candidates && settings.detectCurrency) return resolveSign(item.candidates, langCurrency);
  return photoCurrency(items, langCurrency).code;
}

function setItems(prices) {
  scan.items = prices.map((p, index) => ({
    id: index + 1,
    amount: p.amount,
    candidates: p.candidates,
    fixedCurrency: null,
    text: p.text,
    bbox: p.bbox,
    confidence: p.confidence,
    label: null,
    labelLines: [],
  }));
}

function assignLabels() {
  const rtl = isRtl(scan.language);
  for (const item of scan.items) {
    const lines = labelFor(item.bbox, scan.lines, { rtl });
    item.labelLines = lines.map((line) => line.text);
    item.label = item.labelLines.join(' ') || null;
    item.labelBox = lines.length ? unionBox(lines.map((line) => line.bbox)) : null;
  }
  scan.groups = textGroups();
}

function unionBox(boxes) {
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

/**
 * The pieces of text to translate. An item name printed over two lines ("Croissant" /
 * "au beurre") is translated as one phrase, which reads far better than two fragments.
 */
function textGroups() {
  const groups = [];
  const inLabel = new Set();
  for (const item of scan.items) {
    if (item.labelLines.length < 2 || groups.some((g) => g.text === item.label)) continue;
    item.labelLines.forEach((text) => inLabel.add(text));
    groups.push({ text: item.label, bbox: item.labelBox, lineCount: item.labelLines.length });
  }
  for (const line of scan.lines) {
    if (!inLabel.has(line.text)) groups.push({ text: line.text, bbox: line.bbox, lineCount: 1 });
  }
  return groups.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
}

/** An item's name in the translation language, or null if there is no translation. */
function translatedLabel(item) {
  if (!scan.translations || !item.label) return null;
  return scan.translations.get(item.label) || item.labelLines.map((text) => scan.translations.get(text) || text).join(' ');
}

async function handlePhoto(file) {
  if (file) await startScan((canvas) => photoToCanvas(file, canvas));
}

/** Put a picture on the scan screen (via `draw`) and read it. */
async function startScan(draw) {
  const run = ++scan.run;
  showTab('scan');
  Object.assign(scan, { status: 'reading', items: [], error: null, hasPhoto: true, mode: 'converted' });
  setProgress('Opening photo…', 0);
  renderScan();
  try {
    await draw(photo);
    updatePhotoScale();
  } catch (error) {
    if (run !== scan.run) return;
    Object.assign(scan, { status: 'error', error, hasPhoto: false });
    renderScan();
    toast(error.message || 'That photo couldn’t be opened.');
    return;
  }
  await recognise(run);
}

async function recognise(run) {
  Object.assign(scan, {
    status: 'reading',
    items: [],
    englishLines: [],
    englishPrices: [],
    lines: [],
    groups: [],
    edited: false,
    language: null,
    langStatus: 'idle',
    translations: null,
    translateStatus: 'idle',
  });
  renderScan();
  try {
    const { lines, prices } = await readPrices(photo, parseOptions(), ({ status, progress }, retry) => {
      if (run !== scan.run) return;
      if (!retry) setProgress(OCR_STEPS[status] || 'Getting ready…', progress);
      else if (status === 'recognizing text') setProgress('Looking more closely…', progress);
    });
    if (run !== scan.run) return;
    scan.englishLines = lines;
    scan.englishPrices = prices;
    setItems(prices);
    scan.lines = textLines(lines, prices.map((p) => p.bbox));
    assignLabels();
    scan.status = 'done';
    scan.finishedAt = Date.now();
    ocrWarm = true;
    $('#ocr-status').textContent = '';
  } catch (error) {
    if (run !== scan.run) return;
    console.error(error);
    scan.status = 'error';
    scan.error = error;
    renderScan();
    return;
  }
  renderScan();
  analyseLanguage(run);
}

/**
 * Work out the language (re-reading the text in its own script if needed), then translate.
 * Runs after the prices are already on screen. `forcedLang` comes from the user's own choice.
 */
async function analyseLanguage(run, forcedLang = null) {
  const langRun = ++scan.langRun;
  const live = () => run === scan.run && langRun === scan.langRun;
  Object.assign(scan, {
    langStatus: 'detecting',
    langProgress: forcedLang ? `Reading ${languageName(forcedLang)}…` : 'Identifying language…',
    translations: null,
    translateStatus: 'idle',
  });
  renderScan();
  try {
    let result;
    if (forcedLang) {
      result = await readInLanguage(photo, forcedLang, scan.englishLines);
    } else {
      result = await identifyLanguage(photo, scan.englishLines, {
        hintCurrencies: [...scan.englishPrices.flatMap((p) => p.candidates || []), settings.source],
        isCancelled: () => !live(),
        onProbe: (index, total) => {
          if (!live()) return;
          scan.langProgress = `Identifying script ${index + 1}/${total}…`;
          renderLanguageBar();
        },
      });
    }
    if (!result || !live()) return;
    scan.language = result.lang;
    if (!scan.edited) {
      const scriptPrices = result.model === 'eng' ? [] : findPrices(result.lines, parseOptions());
      setItems(mergePrices(scan.englishPrices, scriptPrices));
    }
    scan.lines = textLines(result.lines, scan.items.map((item) => item.bbox));
    assignLabels();
    scan.langStatus = result.lang ? 'done' : 'none';
    renderScan();
    await translateScan(live);
  } catch (error) {
    if (!live()) return;
    console.error(error);
    scan.langStatus = 'failed';
    renderScan();
  }
}

async function translateScan(live = () => true) {
  const from = scan.language;
  const to = settings.translateTo;
  scan.translations = null;
  if (!settings.translate) scan.translateStatus = 'off';
  else if (!from || !scan.groups.length) scan.translateStatus = 'idle';
  else if (baseLanguage(from) === baseLanguage(to)) scan.translateStatus = 'same';
  else scan.translateStatus = 'busy';
  renderScan();
  if (scan.translateStatus !== 'busy') return;
  try {
    const texts = scan.groups.map((group) => group.text);
    const translated = await translateLines(texts, from, to);
    if (!live()) return;
    scan.translations = new Map(texts.map((text, i) => [text, translated[i]]));
    scan.translateStatus = 'done';
    if (scan.mode === 'converted' && scan.translations.size) scan.mode = 'text';
  } catch (error) {
    if (!live()) return;
    scan.translateStatus = 'failed';
    const message = String(error?.message || '');
    if (!navigator.onLine) scan.translateError = 'you’re offline';
    else if (/fetch|network|abort|timeout/i.test(message)) scan.translateError = 'couldn’t reach the translator';
    else scan.translateError = message || 'unknown error';
  }
  renderScan();
}

function updatePhotoScale() {
  if (!photo.width) return;
  photoWrap.style.setProperty('--scale', String(photoWrap.clientWidth / photo.width));
  keepTagsInside();
}
new ResizeObserver(updatePhotoScale).observe(photoWrap);

function renderScan() {
  if (scan.status === 'done' && scan.finishedAt) rememberScan(scan.items, (item) => currencyOf(item), (item) => translatedLabel(item) || item.label, scan.finishedAt);
  $('#scan-intro').hidden = scan.hasPhoto;
  $('#scan-result').hidden = !scan.hasPhoto;
  $('#scan-progress').hidden = scan.status !== 'reading';
  const hasTranslation = Boolean(scan.translations?.size);
  if (scan.mode === 'text' && !hasTranslation) scan.mode = 'converted';
  $('[data-mode="text"]').hidden = !hasTranslation;
  photoWrap.classList.toggle('mode-original', scan.mode === 'original');
  photoWrap.classList.toggle('mode-text', scan.mode === 'text');
  for (const button of $$('[data-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mode === scan.mode));
  renderLanguageBar();
  renderOverlays();
  renderSummary();
  renderTranslationCard();
}

function renderLanguageBar() {
  const bar = $('#lang-bar');
  bar.hidden = scan.status !== 'done';
  if (bar.hidden) return;
  const button = $('#lang-button');
  const status = $('#lang-status');
  const { code, reason } = photoCurrency();

  button.textContent = scan.langStatus === 'detecting' ? 'Detecting…' : `${scan.language ? languageName(scan.language) : 'Unknown'} ▾`;
  const why = { signs: 'from signs', language: 'from language', setting: 'your setting' }[reason];
  $('#lang-currency').innerHTML = `${escapeHtml(code)} <span class="note">${why}</span>`;
  $('#lang-set-local').hidden = reason === 'setting' || code === settings.source;

  let text = '';
  let state = '';
  if (scan.langStatus === 'detecting') [text, state] = [scan.langProgress, 'busy'];
  else if (scan.langStatus === 'failed') [text, state] = ['Couldn’t identify the language. Tap LANG to choose.', 'error'];
  else if (scan.langStatus === 'none') text = 'Language not recognised. Tap LANG to choose.';
  else if (scan.translateStatus === 'busy') [text, state] = [`Translating to ${languageName(settings.translateTo)}…`, 'busy'];
  else if (scan.translateStatus === 'done') text = `Translated to ${languageName(settings.translateTo)}`;
  else if (scan.translateStatus === 'same') text = `Already in ${languageName(settings.translateTo)}`;
  else if (scan.translateStatus === 'off') text = 'Translation is off (Settings)';
  else if (scan.translateStatus === 'failed') [text, state] = [`Translation failed: ${scan.translateError}`, 'error'];
  status.textContent = text;
  status.className = `lang-status${state ? ` ${state}` : ''}`;
  const offerGoogle = ['failed', 'off'].includes(scan.translateStatus) && scan.language && scan.groups.length;
  $('#lang-google').hidden = !offerGoogle;
  if (offerGoogle) $('#lang-google').href = googleLink();
}

function renderOverlays() {
  const W = photo.width;
  const H = photo.height;
  const pct = (value, total) => `${((value / total) * 100).toFixed(3)}%`;
  if (scan.status !== 'done') {
    $('#overlays').innerHTML = '';
    return;
  }
  const rtl = isRtl(scan.language);
  const obstacles = [...scan.groups.map((g) => g.bbox), ...scan.items.map((i) => i.bbox)];
  // Translations are usually longer than the original (English vs Japanese), so each one may
  // grow into the empty space beside its line, up to the next text or price on the same row.
  const room = (box) => {
    const h = box.y1 - box.y0;
    let limit = rtl ? 0 : W;
    for (const other of obstacles) {
      if (other === box || Math.min(other.y1, box.y1) - Math.max(other.y0, box.y0) < h * 0.4) continue;
      if (!rtl && other.x0 >= box.x1 - 1) limit = Math.min(limit, other.x0 - h * 0.3);
      if (rtl && other.x1 <= box.x0 + 1) limit = Math.max(limit, other.x1 + h * 0.3);
    }
    return Math.max(box.x1 - box.x0, rtl ? box.x1 - limit : limit - box.x0);
  };
  const textTags = !scan.translations
    ? []
    : scan.groups.map((group) => {
        const translated = scan.translations.get(group.text);
        if (!translated) return '';
        const { x0, y0, x1, y1 } = group.bbox;
        const h = y1 - y0;
        const lineH = h / group.lineCount;
        const pad = lineH * 0.12;
        const avail = room(group.bbox);
        // Font size in photo pixels; the monospace font is ~0.6em per character, plus padding.
        // A name spread over several lines may wrap over the same number of lines.
        const fs = Math.min(lineH * 0.85, (avail * group.lineCount) / ((translated.length + 1) * 0.6));
        const side = rtl ? `right:${pct(W - x1, W)}` : `left:${pct(x0, W)}`;
        const cls = `text-tag${rtl ? ' rtl' : ''}${group.lineCount > 1 ? ' multi' : ''}`;
        return `<div class="${cls}" dir="auto" style="${side};top:${pct(y0 - pad, H)};height:${pct(h + pad * 2, H)};min-width:${pct(x1 - x0, W)};max-width:${pct(avail, W)};--fs:${fs.toFixed(1)}">${escapeHtml(translated)}</div>`;
      });
  const priceTags = scan.items.map((item) => {
    const { x0, y0, x1, y1 } = item.bbox;
    const currency = currencyOf(item);
    const converted = formatMoney(convert(item.amount, currency, settings.home), settings.home);
    const original = formatMoney(item.amount, currency);
    return `
      <div class="price-box" style="left:${pct(x0, W)};top:${pct(y0, H)};width:${pct(x1 - x0, W)};height:${pct(y1 - y0, H)}"></div>
      <button type="button" class="price-tag${item.confidence === 'low' ? ' low' : ''}" data-id="${item.id}"
        style="left:${pct((x0 + x1) / 2, W)};top:${pct((y0 + y1) / 2, H)};--w:${x1 - x0};--h:${y1 - y0}"
        aria-label="${escapeHtml(original)} is ${escapeHtml(converted)}">${escapeHtml(converted)}</button>`;
  });
  $('#overlays').innerHTML = textTags.join('') + priceTags.join('');
  keepTagsInside();
}

// Nudge labels that would stick out past the edge of the photo back inside it.
function keepTagsInside() {
  const width = photoWrap.clientWidth;
  const height = photoWrap.clientHeight;
  if (!width) return; // not visible yet; the resize observer calls this again
  const margin = 4;
  for (const tag of $$('.price-tag', photoWrap)) {
    const halfW = tag.offsetWidth / 2;
    const halfH = tag.offsetHeight / 2;
    const x = tag.offsetLeft;
    const y = tag.offsetTop;
    const dx = Math.max(margin - (x - halfW), Math.min(0, width - margin - (x + halfW)));
    const dy = Math.max(margin - (y - halfH), Math.min(0, height - margin - (y + halfH)));
    tag.style.translate = dx || dy ? `${dx}px ${dy}px` : '';
  }
}

function friendlyError(error) {
  const message = String(error?.message || error || '');
  if (/fetch|network|load|import|script/i.test(message) || !navigator.onLine) {
    return 'The text reader needs to download once (about 6 MB). Check your internet connection and try again.';
  }
  return message || 'Something went wrong while reading the photo.';
}

function renderSummary() {
  const el = $('#scan-summary');
  if (scan.status === 'reading') {
    el.innerHTML = '<p class="empty-note">Scanning for prices…</p>';
    return;
  }
  if (scan.status === 'error') {
    el.innerHTML = `<div class="message"><h2>Couldn’t read this photo</h2><p>${escapeHtml(friendlyError(scan.error))}</p>
      <button type="button" class="btn btn-primary" data-action="retry">Try again</button></div>`;
    return;
  }
  if (!scan.items.length) {
    el.innerHTML = `<div class="message"><h2>No prices found</h2>
      <p>Move closer so the prices fill more of the photo, hold the phone steady and make sure there’s enough light.</p></div>`;
    return;
  }
  const count = scan.items.length;
  const rows = scan.items.map((item) => {
    const currency = currencyOf(item);
    const original = formatMoney(item.amount, currency);
    const translated = translatedLabel(item);
    const name = translated || item.label;
    const details = [];
    if (translated && translated !== item.label) details.push(item.label);
    if (name) details.push(original);
    if (!item.fixedCurrency && (!item.candidates || !settings.detectCurrency)) details.push(`no sign → ${currency}`);
    return `<button type="button" class="price-row" data-id="${item.id}">
      <span class="item">
        <span class="name" dir="auto">${escapeHtml(name || original)}</span>
        ${details.length ? `<span class="sub" dir="auto">${escapeHtml(details.join(' · '))}</span>` : ''}
      </span>
      <span class="conv">${escapeHtml(formatMoney(convert(item.amount, currency, settings.home), settings.home))}</span>
      <svg aria-hidden="true"><use href="#i-chevron"/></svg>
    </button>`;
  });
  el.innerHTML = `<div class="panel-head"><span>${count} price${count === 1 ? '' : 's'} found</span><span>Tap to fix</span></div>${rows.join('')}`;
}

/** All the photo's text, for opening in Google Translate. */
function googleLink() {
  return googleTranslateUrl(scan.groups.map((g) => g.text).join('\n'), scan.language, settings.translateTo);
}

function renderTranslationCard() {
  const card = $('#translation-card');
  const entries = scan.translations ? scan.groups.filter((group) => scan.translations.get(group.text)) : [];
  card.hidden = !entries.length;
  if (card.hidden) {
    $('#translation-list').innerHTML = '';
    return;
  }
  $('#translation-pair').textContent = `${scan.language.toUpperCase()} → ${settings.translateTo.toUpperCase()}`;
  $('#google-translate').href = googleLink();
  $('#translation-list').innerHTML = entries
    .map(
      (group) => `<div class="translation-row">
        <span class="orig" dir="auto">${escapeHtml(group.text)}</span>
        <span class="tr" dir="auto">${escapeHtml(scan.translations.get(group.text))}</span>
      </div>`
    )
    .join('');
}

for (const input of $$('[data-photo-input]')) {
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = ''; // allow choosing the same photo again
    handlePhoto(file);
  });
}

$('#scan-modes').addEventListener('click', (event) => {
  const button = event.target.closest('[data-mode]');
  if (!button) return;
  scan.mode = button.dataset.mode;
  renderScan();
});

$('#scan-summary').addEventListener('click', (event) => {
  if (event.target.closest('[data-action="retry"]')) {
    recognise(++scan.run);
    return;
  }
  const row = event.target.closest('[data-id]');
  if (row) openPriceSheet(Number(row.dataset.id));
});

$('#overlays').addEventListener('click', (event) => {
  const tag = event.target.closest('[data-id]');
  if (tag) openPriceSheet(Number(tag.dataset.id));
});

$('#lang-button').addEventListener('click', () => {
  if (scan.status !== 'done') return;
  openPicker({
    title: 'Text language',
    items: languageItems(['auto', ...SCAN_LANGUAGES]),
    selected: scan.language || 'auto',
    placeholder: 'Search language',
    onSelect: (code) => analyseLanguage(scan.run, code === 'auto' ? null : code),
  });
});

$('#lang-set-local').addEventListener('click', () => setCurrency('source', photoCurrency().code));

/* ---------- Live camera ---------- */
// Reads prices from the camera feed a frame at a time and pins converted amounts on screen.
// The shutter hands the current frame to the full scan (language, translation, editing).

const cameraEl = $('#camera');
const video = $('#camera-video');
const live = { session: 0, items: [], frameW: 1, frameH: 1, torch: false };
const LIVE_SIDE = 1000; // frame size for live reading: smaller is faster

function setCameraStatus(text) {
  $('#camera-status').textContent = text;
}

async function openCamera() {
  if (!cameraSupported()) {
    toast('Live camera isn’t available here. Use Camera app or Photos instead.');
    return;
  }
  const session = ++live.session;
  Object.assign(live, { items: [], torch: false });
  renderLiveTags();
  setCameraStatus('Starting camera…');
  $('#camera-torch').hidden = true;
  openSheet(cameraEl);
  try {
    await startCamera(video);
  } catch (error) {
    if (session !== live.session) return;
    closeSheet(cameraEl);
    toast(
      error?.name === 'NotAllowedError'
        ? 'Camera access is blocked. Allow it for this site in your browser settings.'
        : 'Couldn’t start the camera. Use Camera app or Photos instead.'
    );
    return;
  }
  if (session !== live.session) return;
  $('#camera-torch').hidden = !torchSupported();
  $('#camera-torch').setAttribute('aria-pressed', 'false');
  liveLoop(session);
}

async function liveLoop(session) {
  const frame = document.createElement('canvas');
  let first = true;
  setCameraStatus(ocrWarm ? 'Point at prices' : 'Loading text reader…');
  while (session === live.session) {
    if (video.readyState < 2 || !video.videoWidth || document.hidden) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }
    grabFrame(video, frame, LIVE_SIDE);
    cameraEl.classList.add('reading');
    try {
      const lines = await readText(frame, first ? ({ status }) => {
        if (session === live.session && status !== 'recognizing text') setCameraStatus('Loading text reader (first time only)…');
      } : null);
      if (session !== live.session) return;
      first = false;
      ocrWarm = true;
      live.items = findPrices(lines, parseOptions());
      live.frameW = frame.width;
      live.frameH = frame.height;
      const count = live.items.length;
      if (count) live.lastSeen = { at: Date.now(), items: live.items };
      setCameraStatus(count ? `${count} price${count === 1 ? '' : 's'}` : 'Point at prices');
      renderLiveTags();
    } catch {
      if (session !== live.session) return;
      setCameraStatus('Text reader unavailable offline. You can still capture.');
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } finally {
      cameraEl.classList.remove('reading');
    }
  }
}

function renderLiveTags() {
  // The video fills the screen with object-fit: cover, so map frame pixels the same way.
  const cw = cameraEl.clientWidth;
  const ch = cameraEl.clientHeight;
  const scale = Math.max(cw / live.frameW, ch / live.frameH);
  const ox = (cw - live.frameW * scale) / 2;
  const oy = (ch - live.frameH * scale) / 2;
  $('#camera-tags').innerHTML = live.items
    .map((item) => {
      const { x0, y0, x1, y1 } = item.bbox;
      const h = (y1 - y0) * scale;
      const converted = formatMoney(convert(item.amount, currencyOf(item, live.items, null), settings.home), settings.home);
      const style = [
        `left:${ox + ((x0 + x1) / 2) * scale}px`,
        `top:${oy + ((y0 + y1) / 2) * scale}px`,
        `min-width:${(x1 - x0) * scale * 1.08 + 8}px`,
        `min-height:${h * 1.12 + 4}px`,
        `font-size:${Math.max(13, Math.min(32, h * 0.75))}px`,
      ].join(';');
      return `<div class="live-tag${item.confidence === 'low' ? ' low' : ''}" style="${style}">${escapeHtml(converted)}</div>`;
    })
    .join('');
}

cameraEl.addEventListener('sheetclose', () => {
  // The prices the live camera saw last go to the Scan widget.
  const seen = live.lastSeen;
  if (seen && seen.at > (lastScan?.at || 0)) rememberScan(seen.items, (item) => currencyOf(item, seen.items, null), () => null, seen.at);
  live.lastSeen = null;
  live.session++;
  live.items = [];
  stopCamera(video);
});

$('#camera-torch').addEventListener('click', async () => {
  live.torch = !live.torch;
  try {
    await setTorch(live.torch);
  } catch {
    live.torch = false;
  }
  $('#camera-torch').setAttribute('aria-pressed', String(live.torch));
});

$('#camera-shutter').addEventListener('click', () => {
  if (!video.videoWidth) return;
  const shot = grabFrame(video, document.createElement('canvas'), 2000);
  closeSheet(cameraEl);
  startScan(async (canvas) => {
    canvas.width = shot.width;
    canvas.height = shot.height;
    canvas.getContext('2d').drawImage(shot, 0, 0);
  });
});

for (const button of $$('[data-live-camera]')) {
  button.hidden = !cameraSupported();
  button.addEventListener('click', openCamera);
}

window.addEventListener('resize', () => {
  if (!cameraEl.hidden) renderLiveTags();
});

// Phones pause the camera in the background; restart it when the app comes back.
document.addEventListener('visibilitychange', () => {
  if (cameraEl.hidden) return;
  if (document.hidden) stopCamera(video);
  else startCamera(video).catch(() => closeSheet(cameraEl));
});

/* ---------- Edit a scanned price ---------- */

const priceSheet = $('#price-sheet');
const priceAmount = $('#price-amount');
let editing = null;

function openPriceSheet(id) {
  editing = scan.items.find((item) => item.id === id);
  if (!editing) return;
  priceAmount.value = formatInputNumber(editing.amount, currencyOf(editing));
  const name = editing.label ? `${editing.label}: ` : '';
  $('#price-note').textContent = `${name}read as “${editing.text}”`;
  renderPriceSheet();
  openSheet(priceSheet);
}

function renderPriceSheet() {
  if (!editing) return;
  const currency = currencyOf(editing);
  renderChip($('#price-currency'), currency, true);
  $('#price-result').textContent = `= ${formatMoney(convert(editing.amount, currency, settings.home), settings.home)}`;
}

priceAmount.addEventListener('input', () => {
  editing.amount = parseUserNumber(priceAmount.value);
  scan.edited = true;
  renderPriceSheet();
  renderOverlays();
  renderSummary();
});

$('#price-currency').addEventListener('click', () => {
  const item = editing;
  openPicker({
    title: 'Currency of this price',
    items: currencyItems(),
    selected: currencyOf(item),
    recent: settings.recent,
    placeholder: 'Search currency or country',
    onSelect: (code) => {
      item.fixedCurrency = code;
      scan.edited = true;
      rememberRecent(code);
      saveSettings();
      renderPriceSheet();
      renderScan();
    },
  });
});

$('#price-remove').addEventListener('click', () => {
  scan.items = scan.items.filter((item) => item !== editing);
  scan.edited = true;
  closeSheet(priceSheet);
  renderScan();
});

$('#price-open').addEventListener('click', () => {
  const currency = currencyOf(editing);
  const amount = editing.amount;
  closeSheet(priceSheet);
  setCurrency('source', currency);
  setAmount('source', amount);
  showTab('convert');
});

/* ---------- Settings ---------- */

const toggles = { '#detect-toggle': 'detectCurrency', '#guess-toggle': 'guessCurrency', '#translate-toggle': 'translate' };
for (const [selector, key] of Object.entries(toggles)) {
  $(selector).addEventListener('change', (event) => {
    settings[key] = event.target.checked;
    saveSettings();
    if (key === 'translate' && scan.language) translateScan(liveCheck());
    renderAll();
  });
}

// A check that goes stale as soon as a new photo or language choice comes in.
function liveCheck() {
  const { run, langRun } = scan;
  return () => run === scan.run && langRun === scan.langRun;
}

$('#translate-to').addEventListener('click', () => {
  openPicker({
    title: 'Translate to',
    items: languageItems(TARGET_LANGUAGES),
    selected: settings.translateTo,
    placeholder: 'Search language',
    onSelect: (code) => {
      settings.translateTo = code;
      saveSettings();
      renderAll();
      if (scan.language) translateScan(liveCheck());
    },
  });
});

$('#auto-source-toggle').addEventListener('change', (event) => {
  settings.autoSource = event.target.checked;
  saveSettings();
  renderAll();
  if (settings.autoSource) detectSource({ askPermission: true });
});

$('#refresh-rates').addEventListener('click', () => updateRates({ manual: true }));
$('#rates-pill').addEventListener('click', () => updateRates({ manual: true }));

/* ---------- Install prompt ---------- */
// Chrome and Edge offer a real install dialog (beforeinstallprompt), but Chrome only allows it
// once you've used the page for a little while. Until then (and on browsers without it) the
// prompt shows where to find "Install app" in the menu; it switches to an Install button as
// soon as Chrome allows. iPhones never let websites install themselves, so there it shows the
// Add to Home Screen steps.

const installSheet = $('#install-sheet');
const ua = navigator.userAgent;
const isIos = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(ua);
// The Android app is already installed, so it never offers to install the web app.
const isStandalone = () => isNativeApp || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let installPrompt = null;

function installKind() {
  if (isStandalone()) return null;
  if (installPrompt) return 'native';
  if (isIos) return 'ios';
  if (isAndroid) return 'menu';
  return null;
}

function fillInstallSheet() {
  const kind = installKind();
  $('#install-steps-ios').hidden = kind !== 'ios';
  $('#install-note-ios').hidden = kind !== 'ios';
  $('#install-steps-menu').hidden = kind !== 'menu';
  $('#install-now').hidden = kind !== 'native';
  $('#install-later').textContent = kind === 'native' ? 'Not now' : 'Got it';
  $('#install-later').className = `btn ${kind === 'native' ? 'btn-ghost' : 'btn-primary'}`;
}

function openInstallSheet() {
  if (!installKind()) return;
  fillInstallSheet();
  save('installPromptShown', Date.now());
  if (installSheet.hidden) openSheet(installSheet);
}

/** Show the prompt on its own, unless it was shown recently or the app is installed. */
function maybePromptInstall() {
  const kind = installKind();
  if (!kind || load('installed', false) || openSheets.length) return;
  // Wait a few days before asking again (a week where we can only show instructions).
  const wait = (kind === 'native' ? 3 : 7) * 24 * 60 * 60 * 1000;
  if (Date.now() - load('installPromptShown', 0) < wait) return;
  openInstallSheet();
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  renderInstall();
  if (!installSheet.hidden) fillInstallSheet(); // already showing the menu steps: offer the button
  else setTimeout(maybePromptInstall, 1000);
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  save('installed', true);
  closeSheet(installSheet);
  renderInstall();
  toast('Installed. Find Converter on your home screen.');
});
$('#install-now').addEventListener('click', async () => {
  const prompt = installPrompt;
  if (!prompt) return;
  prompt.prompt();
  const choice = await prompt.userChoice.catch(() => null);
  installPrompt = null;
  closeSheet(installSheet);
  if (choice?.outcome === 'accepted') save('installed', true);
  renderInstall();
});
$('#install-btn').addEventListener('click', openInstallSheet);
$('#install-top').addEventListener('click', openInstallSheet);

function renderInstall() {
  const kind = installKind();
  $('#install-card').hidden = !kind;
  $('#install-btn-label').textContent = kind === 'native' ? 'Install app' : 'Show me how';
  $('#install-top').hidden = !kind || load('installed', false);
}

/* ---------- Shared rendering ---------- */

function renderChip(el, code, withChevron) {
  const currency = getCurrency(code);
  const glyph = symbolGlyph(currency);
  el.innerHTML = `<span class="sym${glyph.length > 2 ? ' long' : ''}" aria-hidden="true">${escapeHtml(glyph)}</span>${code}${
    withChevron ? '<svg aria-hidden="true"><use href="#i-down"/></svg>' : ''
  }`;
  el.setAttribute('aria-label', `${currency.name}. Change currency`);
}

function renderAll() {
  for (const el of $$('[data-chip]')) renderChip(el, settings[el.dataset.chip], el.classList.contains('currency-chip'));
  for (const el of $$('[data-chip-text]')) el.textContent = settings[el.dataset.chipText];
  for (const el of $$('[data-name]')) el.textContent = getCurrency(settings[el.dataset.name]).name;
  $('#welcome').hidden = settings.homeChosen;
  $('#auto-source-toggle').checked = settings.autoSource;
  $('#source-badge').hidden = !(settings.autoSource && settings.sourceRegion);
  $('#source-hint').textContent = !settings.autoSource
    ? 'Set by you'
    : settings.sourceRegion
      ? `From your location: ${regionName(settings.sourceRegion)}`
      : 'Detecting where you are…';
  for (const [selector, key] of Object.entries(toggles)) $(selector).checked = settings[key];
  $('#translate-to-value').textContent = languageName(settings.translateTo);
  renderExtraCurrencies();
  renderConverterValues();
  renderRateLine();
  renderReference();
  renderRatesStatus();
  renderScan();
  renderPriceSheet();
  renderInstall();
  syncWidget();
}

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 3200);
}

/* ---------- Global events ---------- */

$('.tabbar').addEventListener('click', (event) => {
  const button = event.target.closest('[data-tab]');
  if (button) showTab(button.dataset.tab);
});

document.addEventListener('click', (event) => {
  const clear = event.target.closest('[data-clear]');
  if (clear) {
    const input = $('input', clear.parentElement);
    input.value = '';
    input.dispatchEvent(new Event('input'));
    input.focus();
    return;
  }
  if (event.target.closest('[data-close]')) {
    closeSheet(event.target.closest('.sheet-backdrop, .camera'));
    return;
  }
  if (event.target.classList.contains('sheet-backdrop')) closeSheet(event.target);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && openSheets.length) closeSheet(openSheets.at(-1));
  if (event.key === 'Enter' && event.target.matches('.amount-input, .extra-input')) event.target.blur();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (ratesAreStale() && !ratesLoading) updateRates();
  if (settings.homeChosen && Date.now() - lastDetect > 30 * 60 * 1000) detectSource();
});
window.addEventListener('online', () => {
  if (ratesFailed || ratesAreStale()) updateRates();
});

/* ---------- Start ---------- */

saveSettings();
applyTheme();
renderAll();
if (ratesAreStale()) updateRates();

// Opened from the Scan widget, or "Live camera" on the app icon's long-press menu: go straight to the camera.
async function handleLaunchAction() {
  if (!isNativeApp) return;
  try {
    const { action } = await window.Capacitor.nativePromise('Widgets', 'takeLaunchAction', {});
    if (action === 'camera' && cameraEl.hidden) {
      showTab('scan');
      openCamera();
    }
  } catch {
    // An older app version without this: nothing to do.
  }
}
window.addEventListener('converterlaunch', handleLaunchAction);
handleLaunchAction();

// First launch: ask for the home currency (then "prices in" follows the location).
if (!settings.homeChosen) setTimeout(openHomeChooser, 300);
else detectSource();

$('#app-version').textContent = APP_VERSION;
if (isStandalone()) save('installed', true);
else if (isIos) setTimeout(maybePromptInstall, 1500);
else if (isAndroid) setTimeout(maybePromptInstall, 3000); // gives Chrome a moment to allow its real dialog

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  // Check for a new version on every launch; sw.js reloads the page when one takes over.
  navigator.serviceWorker
    .register('sw.js')
    .then((registration) => registration.update())
    .catch(() => {});
}
