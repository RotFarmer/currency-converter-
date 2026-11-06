import { CURRENCIES, CURRENCY_CODES, getCurrency, fractionDigits, searchCurrencies, guessHomeCurrency } from './currencies.js';
import { getRates, ratesAreStale, refreshRates, convert } from './rates.js';
import { formatMoney, formatRate, formatInputNumber, parseUserNumber, timeAgo, formatDateTime } from './format.js';
import { findPrices, resolveCurrency } from './price-parser.js';
import { photoToCanvas, preloadOcr, readText } from './ocr.js';
import { load, save } from './storage.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/* ---------- Settings ---------- */

const settings = {
  home: null, // the default currency everything is converted to
  source: null, // the currency prices are in ("prices in")
  detectCurrency: true,
  recent: [],
  welcomed: false,
  ...load('settings', {}),
};
settings.home ||= guessHomeCurrency();
settings.source ||= settings.home === 'EUR' ? 'USD' : 'EUR';

function saveSettings() {
  save('settings', settings);
}

function rememberRecent(code) {
  settings.recent = [code, ...settings.recent.filter((c) => c !== code)].slice(0, 6);
}

function setCurrency(role, code) {
  settings[role] = code;
  if (role === 'home') settings.welcomed = true;
  rememberRecent(code);
  saveSettings();
  renderAll();
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
  let label;
  if (!rates) {
    state = ratesLoading ? 'loading' : 'error';
    label = ratesLoading ? 'Loading rates…' : 'No rates · tap to retry';
  } else if (ratesLoading) {
    state = 'loading';
    label = 'Updating…';
  } else {
    state = ratesFailed || ratesAreStale() ? 'old' : 'ok';
    label = `${ratesFailed ? 'Offline' : 'Updated'} ${timeAgo(rates.updatedAt)}`;
  }
  pill.dataset.state = state;
  $('.label', pill).textContent = label;
  $('#rates-detail').textContent = rates
    ? `${formatDateTime(rates.updatedAt)} · ${rates.provider}`
    : 'Not downloaded yet';
}

/* ---------- Tabs ---------- */

const TITLES = { convert: 'Convert', scan: 'Scan', settings: 'Settings' };
let currentTab = 'convert';

function showTab(tab) {
  if (tab !== currentTab) window.scrollTo(0, 0);
  currentTab = tab;
  for (const view of $$('.view')) view.hidden = view.dataset.view !== tab;
  for (const button of $$('.tabbar button')) {
    if (button.dataset.tab === tab) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  $('#view-title').textContent = TITLES[tab];
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

/* ---------- Currency picker ---------- */

const picker = $('#picker');
const pickerSearch = $('#picker-search');
const pickerList = $('#picker-list');
let pickerState = null;

function availableCurrencies() {
  const rates = getRates();
  return rates ? CURRENCIES.filter((c) => rates.rates[c.code]) : CURRENCIES;
}

function openPicker({ title, selected, onSelect }) {
  pickerState = { selected, onSelect };
  $('#picker-title').textContent = title;
  pickerSearch.value = '';
  renderPickerList();
  openSheet(picker);
  pickerList.scrollTop = 0;
  if (!matchMedia('(pointer: coarse)').matches) pickerSearch.focus();
}

function renderPickerList() {
  const query = pickerSearch.value.trim();
  const list = searchCurrencies(query, availableCurrencies());
  const { selected } = pickerState;
  const row = (c) => `
    <button type="button" class="picker-row" role="option" aria-selected="${c.code === selected}" data-code="${c.code}">
      <span class="flag" aria-hidden="true">${c.flag}</span>
      <span class="code">${c.code}</span>
      <span class="name">${escapeHtml(c.name)}</span>
      ${c.code === selected ? '<svg aria-hidden="true"><use href="#i-check"/></svg>' : ''}
    </button>`;
  let html = '';
  if (!query) {
    const recent = settings.recent.filter((code) => list.some((c) => c.code === code)).map(getCurrency);
    if (recent.length) html += `<div class="picker-section">Recent</div>${recent.map(row).join('')}`;
    html += '<div class="picker-section">All currencies</div>';
  }
  html += list.length
    ? list.map(row).join('')
    : `<div class="picker-empty">No currency matches “${escapeHtml(query)}”</div>`;
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
    selected: settings[role],
    onSelect: (code) => setCurrency(role, code),
  });
});

/* ---------- Converter ---------- */

const inputs = { source: $('#amount-source'), home: $('#amount-home') };
const converter = { side: 'source', value: null }; // the side the user last typed in

function otherSide(side) {
  return side === 'source' ? 'home' : 'source';
}

function fitInput(input) {
  const length = input.value.length;
  input.style.fontSize = length > 13 ? '22px' : length > 9 ? '27px' : '';
}

function renderConverterValues() {
  const { side, value } = converter;
  const other = otherSide(side);
  const result = value == null ? null : convert(value, settings[side], settings[other]);
  inputs[other].value = formatInputNumber(result, settings[other]);
  for (const [name, input] of Object.entries(inputs)) {
    fitInput(input);
    $('[data-clear]', input.parentElement).hidden = input.value === '';
    input.setAttribute('aria-label', `Amount in ${settings[name]}`);
  }
}

function renderRateLine() {
  const { source, home } = settings;
  const rate = convert(1, source, home);
  const el = $('#rate-line');
  if (rate == null) {
    el.textContent = 'Waiting for exchange rates…';
    return;
  }
  // Show "100 JPY = 0.65 USD" rather than "1 JPY = 0.0065 USD".
  const units = 10 ** Math.max(0, Math.round(-Math.log10(rate)));
  el.textContent = `${units.toLocaleString()} ${source} = ${formatRate(rate * units)} ${home}`;
}

function renderReference() {
  const el = $('#reference');
  const { source, home } = settings;
  const homeInSource = convert(1, home, source);
  if (homeInSource == null) {
    el.innerHTML = '<p class="empty-note">Exchange rates download automatically when you’re online.</p>';
    return;
  }
  if (source === home) {
    el.innerHTML = '<p class="empty-note">Pick a different “Price in” currency to see a conversion table.</p>';
    return;
  }
  const base = 10 ** Math.max(0, Math.floor(Math.log10(homeInSource)));
  const rows = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].map((step) => {
    const amount = step * base;
    return `<button type="button" class="ref-row" data-amount="${amount}">
      <span>${formatMoney(amount, source)}</span><span>${formatMoney(convert(amount, source, home), home)}</span>
    </button>`;
  });
  el.innerHTML = `<div class="ref-head"><span>${source}</span><span>${home}</span></div>${rows.join('')}`;
}

for (const input of Object.values(inputs)) {
  input.addEventListener('input', () => {
    converter.side = input.dataset.side;
    converter.value = parseUserNumber(input.value);
    renderConverterValues();
  });
}

$('#reference').addEventListener('click', (event) => {
  const row = event.target.closest('[data-amount]');
  if (!row) return;
  converter.side = 'source';
  converter.value = Number(row.dataset.amount);
  inputs.source.value = formatInputNumber(converter.value, settings.source);
  renderConverterValues();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

$('#welcome-ok').addEventListener('click', () => {
  settings.welcomed = true;
  saveSettings();
  $('#welcome').hidden = true;
});

/* ---------- Scan ---------- */

const photo = $('#photo');
const photoWrap = $('#photo-wrap');
const scan = { status: 'idle', items: [], mode: 'converted', run: 0, hasPhoto: false, error: null };
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
  status.textContent = 'Getting the text reader ready…';
  preloadOcr()
    .then(() => {
      status.textContent = '';
    })
    .catch(() => {
      ocrWarm = false;
      status.textContent = 'The text reader downloads the first time you scan (about 6 MB).';
    });
}

function setProgress(text, progress) {
  $('#scan-progress-text').textContent = text;
  $('#scan-progress-bar').style.width = `${Math.round((progress || 0) * 100)}%`;
}

function currencyOf(item) {
  if (item.fixedCurrency) return item.fixedCurrency;
  if (item.candidates && settings.detectCurrency) return resolveCurrency(item.candidates, settings.source);
  return settings.source;
}

async function handlePhoto(file) {
  if (!file) return;
  const run = ++scan.run;
  showTab('scan');
  Object.assign(scan, { status: 'reading', items: [], error: null, hasPhoto: true, mode: 'converted' });
  setProgress('Opening photo…', 0);
  renderScan();
  try {
    await photoToCanvas(file, photo);
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

function parsePrices(lines) {
  return findPrices(lines, {
    source: settings.source,
    detectCurrency: settings.detectCurrency,
    knownCodes: CURRENCY_CODES,
    decimalsFor: fractionDigits,
  });
}

async function recognise(run) {
  scan.status = 'reading';
  renderScan();
  try {
    let prices = parsePrices(
      await readText(photo, ({ status, progress }) => {
        if (run === scan.run) setProgress(OCR_STEPS[status] || 'Getting ready…', progress);
      })
    );
    if (run !== scan.run) return;
    if (!prices.length) {
      // Second attempt with a black-and-white version, which copes better with shadows and glare.
      prices = parsePrices(
        await readText(
          photo,
          ({ status, progress }) => {
            if (run === scan.run && status === 'recognizing text') setProgress('Looking more closely…', progress);
          },
          { mode: 'threshold' }
        )
      );
      if (run !== scan.run) return;
    }
    scan.items = prices.map((p, index) => ({
      id: index + 1,
      amount: p.amount,
      candidates: p.candidates,
      fixedCurrency: null,
      text: p.text,
      bbox: p.bbox,
      confidence: p.confidence,
    }));
    scan.status = 'done';
    ocrWarm = true;
    $('#ocr-status').textContent = '';
  } catch (error) {
    if (run !== scan.run) return;
    console.error(error);
    scan.status = 'error';
    scan.error = error;
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
  $('#scan-intro').hidden = scan.hasPhoto;
  $('#scan-result').hidden = !scan.hasPhoto;
  $('#scan-progress').hidden = scan.status !== 'reading';
  photoWrap.classList.toggle('show-original', scan.mode === 'original');
  for (const button of $$('[data-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mode === scan.mode));
  renderOverlays();
  renderSummary();
}

function renderOverlays() {
  const W = photo.width;
  const H = photo.height;
  const pct = (value, total) => `${((value / total) * 100).toFixed(3)}%`;
  const items = scan.status === 'done' ? scan.items : [];
  $('#overlays').innerHTML = items
    .map((item) => {
      const { x0, y0, x1, y1 } = item.bbox;
      const currency = currencyOf(item);
      const converted = formatMoney(convert(item.amount, currency, settings.home), settings.home);
      const original = formatMoney(item.amount, currency);
      return `
        <div class="price-box" style="left:${pct(x0, W)};top:${pct(y0, H)};width:${pct(x1 - x0, W)};height:${pct(y1 - y0, H)}"></div>
        <button type="button" class="price-tag${item.confidence === 'low' ? ' low' : ''}" data-id="${item.id}"
          style="left:${pct((x0 + x1) / 2, W)};top:${pct((y0 + y1) / 2, H)};--w:${x1 - x0};--h:${y1 - y0}"
          aria-label="${escapeHtml(original)} is ${escapeHtml(converted)}">${escapeHtml(converted)}</button>`;
    })
    .join('');
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
    el.innerHTML = '<p class="empty-note">Looking for prices…</p>';
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
    const guessed = !item.fixedCurrency && (!item.candidates || !settings.detectCurrency);
    return `<button type="button" class="price-row" data-id="${item.id}">
      <span class="orig">${escapeHtml(formatMoney(item.amount, currency))}${guessed ? `<small>No currency sign · read as ${currency}</small>` : ''}</span>
      <span class="conv">${escapeHtml(formatMoney(convert(item.amount, currency, settings.home), settings.home))}</span>
      <svg aria-hidden="true"><use href="#i-chevron"/></svg>
    </button>`;
  });
  el.innerHTML = `<div class="summary-head"><h2>${count} price${count === 1 ? '' : 's'} found</h2><span>Tap one to fix it</span></div>${rows.join('')}`;
}

for (const input of $$('[data-photo-input]')) {
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = ''; // allow choosing the same photo again
    handlePhoto(file);
  });
}

$('.segmented').addEventListener('click', (event) => {
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

/* ---------- Edit a scanned price ---------- */

const priceSheet = $('#price-sheet');
const priceAmount = $('#price-amount');
let editing = null;

function openPriceSheet(id) {
  editing = scan.items.find((item) => item.id === id);
  if (!editing) return;
  priceAmount.value = formatInputNumber(editing.amount, currencyOf(editing));
  $('#price-note').textContent = `Read from the photo as “${editing.text}”`;
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
  renderPriceSheet();
  renderOverlays();
  renderSummary();
});

$('#price-currency').addEventListener('click', () => {
  const item = editing;
  openPicker({
    title: 'Currency of this price',
    selected: currencyOf(item),
    onSelect: (code) => {
      item.fixedCurrency = code;
      rememberRecent(code);
      saveSettings();
      renderPriceSheet();
      renderScan();
    },
  });
});

$('#price-remove').addEventListener('click', () => {
  scan.items = scan.items.filter((item) => item !== editing);
  closeSheet(priceSheet);
  renderScan();
});

$('#price-open').addEventListener('click', () => {
  const currency = currencyOf(editing);
  converter.side = 'source';
  converter.value = editing.amount;
  closeSheet(priceSheet);
  setCurrency('source', currency);
  inputs.source.value = formatInputNumber(editing.amount, currency);
  renderConverterValues();
  showTab('convert');
});

/* ---------- Settings ---------- */

$('#detect-toggle').addEventListener('change', (event) => {
  settings.detectCurrency = event.target.checked;
  saveSettings();
  renderScan();
});

$('#refresh-rates').addEventListener('click', () => updateRates({ manual: true }));
$('#rates-pill').addEventListener('click', () => updateRates({ manual: true }));

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  renderInstall();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  renderInstall();
});
$('#install-btn').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => {});
  installPrompt = null;
  renderInstall();
});

function renderInstall() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  $('#install-card').hidden = standalone || (!installPrompt && !ios);
  $('#install-btn').hidden = !installPrompt;
  $('#install-hint').textContent = installPrompt
    ? 'Add it to your home screen for one-tap access and offline use.'
    : 'In Safari, tap the Share button, then “Add to Home Screen”.';
}

/* ---------- Shared rendering ---------- */

function renderChip(el, code, withChevron) {
  const currency = getCurrency(code);
  el.innerHTML = `<span class="flag" aria-hidden="true">${currency.flag}</span>${code}${withChevron ? '<svg aria-hidden="true"><use href="#i-down"/></svg>' : ''}`;
  el.setAttribute('aria-label', `${currency.name}. Change currency`);
}

function renderAll() {
  for (const el of $$('[data-chip]')) renderChip(el, settings[el.dataset.chip], el.classList.contains('currency-chip'));
  for (const el of $$('[data-chip-text]')) el.textContent = settings[el.dataset.chipText];
  for (const el of $$('[data-name]')) el.textContent = getCurrency(settings[el.dataset.name]).name;
  $('#welcome').hidden = settings.welcomed;
  $('#detect-toggle').checked = settings.detectCurrency;
  renderConverterValues();
  renderRateLine();
  renderReference();
  renderRatesStatus();
  renderScan();
  renderPriceSheet();
  renderInstall();
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
    closeSheet(event.target.closest('.sheet-backdrop'));
    return;
  }
  if (event.target.classList.contains('sheet-backdrop')) closeSheet(event.target);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && openSheets.length) closeSheet(openSheets.at(-1));
  if (event.key === 'Enter' && event.target.matches('.amount-input')) event.target.blur();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && ratesAreStale() && !ratesLoading) updateRates();
});
window.addEventListener('online', () => {
  if (ratesFailed || ratesAreStale()) updateRates();
});

/* ---------- Start ---------- */

saveSettings();
renderAll();
if (ratesAreStale()) updateRates();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
