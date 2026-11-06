// Exchange rates: fetched from free, key-less APIs and cached so the app works offline.

import { load, save } from './storage.js';

const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 10000;

const PROVIDERS = [
  {
    name: 'ExchangeRate-API',
    url: 'https://open.er-api.com/v6/latest/USD',
    parse(json) {
      if (json.result !== 'success') throw new Error('Rates service returned an error');
      return { rates: json.rates, updatedAt: json.time_last_update_unix * 1000 };
    },
  },
  {
    name: 'Currency API',
    url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
    parse: parseCurrencyApi,
  },
  {
    name: 'Currency API',
    url: 'https://latest.currency-api.pages.dev/v1/currencies/usd.json',
    parse: parseCurrencyApi,
  },
];

function parseCurrencyApi(json) {
  const rates = {};
  for (const [code, value] of Object.entries(json.usd || {})) rates[code.toUpperCase()] = value;
  return { rates, updatedAt: Date.parse(`${json.date}T00:00:00Z`) || Date.now() };
}

let current = load('rates', null);
let inflight = null;

/** Cached rates (USD based): { rates, updatedAt, fetchedAt, provider } or null. */
export function getRates() {
  return current;
}

export function ratesAreStale() {
  return !current || Date.now() - current.fetchedAt > STALE_AFTER_MS;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Download fresh rates, trying each provider in turn. Rejects if all fail. */
export function refreshRates() {
  if (!inflight) {
    inflight = (async () => {
      let lastError;
      for (const provider of PROVIDERS) {
        try {
          const { rates, updatedAt } = provider.parse(await fetchJson(provider.url));
          const valid = Object.values(rates).filter((r) => typeof r === 'number' && r > 0);
          if (rates.USD !== 1 || valid.length < 30) throw new Error('Unexpected rates data');
          current = { rates, updatedAt, fetchedAt: Date.now(), provider: provider.name };
          save('rates', current);
          return current;
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError;
    })().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

/** Convert between any two currencies using USD cross rates. Returns null if a rate is missing. */
export function convert(amount, from, to) {
  if (amount == null || !Number.isFinite(amount)) return null;
  if (from === to) return amount;
  const a = current?.rates[from];
  const b = current?.rates[to];
  if (!a || !b) return null;
  return (amount / a) * b;
}
