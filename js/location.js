// Works out which country the phone is in, to set the "prices in" currency.
// 1. GPS, when the user has allowed location: the position (rounded to about 1 km) is turned
//    into a country by BigDataCloud's free reverse-geocoding service for apps.
// 2. Otherwise the phone's time zone, which phones update automatically when you travel.
//    No permission, no network.

import { regionForTimeZone } from './timezones.js';

const GEOCODER = 'https://api.bigdatacloud.net/data/reverse-geocode-client';

export function regionFromTimeZone() {
  try {
    return regionForTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return null;
  }
}

/** "granted", "denied" or "prompt" (unknown counts as "prompt"). */
async function locationPermission() {
  if (!navigator.geolocation) return 'denied';
  try {
    return (await navigator.permissions.query({ name: 'geolocation' })).state;
  } catch {
    return 'prompt';
  }
}

function currentPosition() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false, // the country is all we need
      timeout: 10000,
      maximumAge: 30 * 60 * 1000,
    });
  });
}

async function regionFromCoordinates(latitude, longitude) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const url = `${GEOCODER}?latitude=${latitude.toFixed(2)}&longitude=${longitude.toFixed(2)}&localityLanguage=en`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const { countryCode } = await response.json();
    return /^[A-Z]{2}$/.test(countryCode || '') ? countryCode : null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Find the country the phone is in.
 * @param {{askPermission: boolean}} options  only show the browser's location prompt if true
 * @returns {Promise<{region: string, method: 'gps'|'timezone'} | null>}
 */
export async function detectRegion({ askPermission = false } = {}) {
  const permission = await locationPermission();
  if (permission === 'granted' || (permission === 'prompt' && askPermission)) {
    try {
      const { coords } = await currentPosition();
      const region = await regionFromCoordinates(coords.latitude, coords.longitude);
      if (region) return { region, method: 'gps' };
    } catch {
      /* denied, timed out or offline: fall back to the time zone */
    }
  }
  const region = regionFromTimeZone();
  return region ? { region, method: 'timezone' } : null;
}
