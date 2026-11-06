// Number and money formatting for display and for the amount input boxes.

import { fractionDigits } from './currencies.js';

const LOCALE = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
const BIDI_MARKS = /[‎‏؜]/g;
const formatters = new Map();

function formatter(key, options) {
  if (!formatters.has(key)) {
    let nf;
    try {
      nf = new Intl.NumberFormat(LOCALE, options);
    } catch {
      nf = new Intl.NumberFormat('en-US', { ...options, style: 'decimal', currency: undefined });
    }
    formatters.set(key, nf);
  }
  return formatters.get(key);
}

/** "$8.37", "¥1,280", "€0.0065" — tiny amounts keep two significant digits. */
export function formatMoney(amount, code) {
  if (amount == null || !Number.isFinite(amount)) return '—';
  const digits = fractionDigits(code);
  const tiny = amount !== 0 && Math.abs(amount) < 10 ** (1 - digits);
  const key = `${code}|${tiny}`;
  const options = tiny
    ? { style: 'currency', currency: code, maximumSignificantDigits: 2 }
    : { style: 'currency', currency: code, minimumFractionDigits: digits, maximumFractionDigits: digits };
  return formatter(key, options).format(amount).replace(BIDI_MARKS, '');
}

/** Exchange rates: "0.006537", "152.98". */
export function formatRate(rate) {
  if (rate == null || !Number.isFinite(rate)) return '—';
  const options = rate >= 100 ? { maximumFractionDigits: 2 } : { maximumSignificantDigits: 4 };
  return formatter(`rate|${rate >= 100}`, options).format(rate);
}

/** Plain number for an input box: no grouping, so editing it stays natural ("1280.5"). */
export function formatInputNumber(amount, code) {
  if (amount == null || !Number.isFinite(amount)) return '';
  const digits = fractionDigits(code);
  const tiny = amount !== 0 && Math.abs(amount) < 10 ** (1 - digits);
  const options = tiny
    ? { useGrouping: false, maximumSignificantDigits: 2 }
    : { useGrouping: false, maximumFractionDigits: digits };
  return formatter(`input|${digits}|${tiny}`, options).format(amount).replace(BIDI_MARKS, '');
}

/**
 * Parse what the user typed. A single "." or "," is a decimal point; if both appear,
 * the last one is. Returns null for empty or invalid input.
 */
export function parseUserNumber(text) {
  const s = String(text).replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return null;
  const decPos = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  if (decPos === -1) return Number(s);
  const sep = s[decPos];
  const other = sep === '.' ? ',' : '.';
  // The same separator used more than once ("1.280.000") is a thousands separator.
  if (s.indexOf(sep) !== decPos && !s.includes(other)) return Number(s.replace(/[.,]/g, ''));
  const value = Number(`${s.slice(0, decPos).replace(/[.,]/g, '') || '0'}.${s.slice(decPos + 1)}`);
  return Number.isFinite(value) ? value : null;
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function timeAgo(timestamp, now = Date.now()) {
  const seconds = Math.round((timestamp - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return 'just now';
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return relative.format(Math.round(seconds / 3600), 'hour');
  return relative.format(Math.round(seconds / 86400), 'day');
}

export function formatDateTime(timestamp) {
  return new Date(timestamp).toLocaleString(LOCALE, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
