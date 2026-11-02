/**
 * Target Tracker — a local sample catalogue, not a tracking service.
 *
 * The catalogue answers "which sample entry did you mean", never "where is
 * this person". A phone number is an identifier, not a position: only the
 * network that serves the handset knows where it is, and it says so only to a
 * lawful request. Every answer therefore carries `synthetic: true` and
 * `source: 'local-catalog'`, and the panel shows it as CATALOG.
 *
 * The real path is one field away: when a device reports its cell
 * (`mcc-mnc-lac-cellid`), `/api/godseye/locate` places it against the BTS
 * registry — that is measured, not sampled.
 */

import { fetchCctvEnhanced } from './cctv-enhanced.mjs';
import { describePhone } from './phone-prefix.mjs';

const TARGET_CATALOG = [
  // Indonesia - Papua
  {
    id: 't-001',
    name: 'Target Papua 1',
    username: '@koteka.watch',
    phone: '+62-812-3456-7890',
    lat: -4.5326,
    lon: 140.5066,
    city: 'Papua',
    status: 'active',
  },
  {
    id: 't-002',
    name: 'Target Papua 2',
    username: '@jayapura.now',
    phone: '+62-813-2345-6789',
    lat: -2.5337,
    lon: 140.7175,
    city: 'Jayapura',
    status: 'active',
  },
  {
    id: 't-003',
    name: 'Target Papua 3',
    username: '@sorong.eye',
    phone: '+62-814-3456-7890',
    lat: -0.8763,
    lon: 131.2558,
    city: 'Sorong',
    status: 'active',
  },
  {
    id: 't-004',
    name: 'Target Papua 4',
    username: '@puncak.watch',
    phone: '+62-815-4567-8901',
    lat: -3.9833,
    lon: 137.7833,
    city: 'Puncak',
    status: 'active',
  },
  {
    id: 't-005',
    name: 'Target Papua 5',
    username: '@puncakjaya.ops',
    phone: '+62-816-5678-9012',
    lat: -3.6167,
    lon: 137.4833,
    city: 'Puncak Jaya',
    status: 'active',
  },
  {
    id: 't-006',
    name: 'Target Papua 6',
    username: '@yahukimo.net',
    phone: '+62-817-6789-0123',
    lat: -4.4833,
    lon: 139.5333,
    city: 'Yahukimo',
    status: 'active',
  },
  {
    id: 't-007',
    name: 'Target Papua 7',
    username: '@tolikara.desk',
    phone: '+62-818-7890-1234',
    lat: -3.6833,
    lon: 138.4833,
    city: 'Tolikara',
    status: 'active',
  },
  {
    id: 't-008',
    name: 'Target Papua 8',
    username: '@wamena.watch',
    phone: '+62-819-8901-2345',
    lat: -4.1,
    lon: 138.95,
    city: 'Wamena',
    status: 'active',
  },
  // Indonesia - Jawa
  {
    id: 't-009',
    name: 'Target Jakarta 1',
    username: '@jakarta.desk',
    phone: '+62-821-1234-5678',
    lat: -6.2,
    lon: 106.8167,
    city: 'Jakarta',
    status: 'active',
  },
  {
    id: 't-010',
    name: 'Target Surabaya 1',
    username: '@surabaya.watch',
    phone: '+62-822-2345-6789',
    lat: -7.2478,
    lon: 112.7644,
    city: 'Surabaya',
    status: 'active',
  },
  {
    id: 't-011',
    name: 'Target Bandung 1',
    username: '@bandung.eye',
    phone: '+62-823-3456-7890',
    lat: -6.9175,
    lon: 107.6191,
    city: 'Bandung',
    status: 'active',
  },
  {
    id: 't-012',
    name: 'Target Bali 1',
    username: '@bali.watch',
    phone: '+62-824-4567-8901',
    lat: -8.3405,
    lon: 115.092,
    city: 'Bali',
    status: 'active',
  },
];

/**
 * What every catalogue answer says about itself.
 *
 * `capability` names the honest one: a phone number resolves to a sample
 * entry, not to a position, and the UI has to be able to say so.
 */
export const CATALOG_MARK = Object.freeze({
  source: 'local-catalog',
  synthetic: true,
  capability: 'catalog-sample',
});

export const CATALOG_NOTICE =
  'Sample catalogue: these coordinates are not a live position. A phone number ' +
  'cannot be geolocated by itself — send the cell id the handset reports ' +
  '(mcc-mnc-lac-cellid) for a measured fix.';

/** A handle typed with or without the leading @, in any case. */
function normalizeHandle(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '');
}

/**
 * Resolve target by name, phone number or account handle.
 *
 * The catalog is local and curated, so a match is exact for the catalog — it
 * is not a lookup of where that account really is. Without a provider that
 * reports a position, a handle alone cannot be geolocated.
 *
 * @param {string} query - nama, no HP, atau username (@handle)
 * @returns {Promise<{found:boolean, target?:object, reason?:string}>}
 */
export async function resolveTarget(query) {
  const normalized = String(query).toLowerCase().trim();
  const phoneNormalized = normalized.replace(/[\s\-()]/g, '');
  const handle = normalizeHandle(query);

  // Match by name
  const byName = TARGET_CATALOG.find((t) =>
    t.name.toLowerCase().includes(normalized),
  );
  if (byName)
    return { found: true, target: byName, matchType: 'name', ...CATALOG_MARK };

  // Match by phone
  const byPhone = TARGET_CATALOG.find((t) =>
    t.phone.replace(/[\s\-()]/g, '').includes(phoneNormalized),
  );
  if (byPhone)
    return {
      found: true,
      target: byPhone,
      matchType: 'phone',
      phoneIntel: describePhone(query),
      ...CATALOG_MARK,
    };

  // Match by handle, with or without the @
  if (handle) {
    const byHandle = TARGET_CATALOG.find(
      (t) => normalizeHandle(t.username) === handle,
    );
    if (byHandle)
      return {
        found: true,
        target: byHandle,
        matchType: 'username',
        ...CATALOG_MARK,
      };
  }

  // Match by city
  const byCity = TARGET_CATALOG.find((t) =>
    t.city.toLowerCase().includes(normalized),
  );
  if (byCity)
    return { found: true, target: byCity, matchType: 'city', ...CATALOG_MARK };

  // A number that is not in the sample catalogue still resolves to something
  // real: the allocation block decides the operator. It never resolves to a
  // position, and the answer says which of the two it is.
  const phone = describePhone(query);
  if (phone.kind === 'mobile-number') {
    return {
      found: false,
      phoneIntel: phone,
      reason: phone.operator
        ? `No sample entry for this number. It is a ${phone.operator} number (${phone.prefix}), and a number carries no position — send the cell id the handset reports instead.`
        : 'No sample entry for this number, and its prefix is not a mobile block.',
    };
  }

  return {
    found: false,
    reason: `Target "${query}" tidak ditemukan di catalog lokal`,
  };
}

/**
 * Get all targets in a region.
 *
 * @param {string} region - 'papua', 'indonesia', etc.
 * @returns {Promise<{targets:any[], count:number}>}
 */
export async function getTargetsByRegion(region) {
  const normalized = String(region).toLowerCase().trim();
  let filtered = TARGET_CATALOG;
  if (normalized === 'papua') {
    filtered = TARGET_CATALOG.filter(
      (t) =>
        t.city.toLowerCase().includes('papua') ||
        t.city.toLowerCase().includes('jayapura') ||
        t.city.toLowerCase().includes('sorong') ||
        t.city.toLowerCase().includes('manokwari') ||
        t.city.toLowerCase().includes('merauke') ||
        t.city.toLowerCase().includes('wamena') ||
        t.city.toLowerCase().includes('nabire') ||
        t.city.toLowerCase().includes('biak') ||
        t.city.toLowerCase().includes('timika') ||
        t.city.toLowerCase().includes('tolikara') ||
        t.city.toLowerCase().includes('yahukimo') ||
        t.city.toLowerCase().includes('puncak'),
    );
  } else if (normalized === 'indonesia') {
    // all
  } else {
    filtered = TARGET_CATALOG.filter((t) =>
      t.city.toLowerCase().includes(normalized),
    );
  }
  return { targets: filtered, count: filtered.length };
}

/**
 * Build target profile (lokasi + CCTV + street photo).
 *
 * @param {string} query - nama atau no HP
 * @param {object} [options]
 */
export async function buildTargetProfile(query, options = {}) {
  const result = await resolveTarget(query);
  if (!result.found) return result;

  const target = result.target;
  const bbox = {
    south: target.lat - 0.05,
    north: target.lat + 0.05,
    west: target.lon - 0.05,
    east: target.lon + 0.05,
  };

  // Cameras come from the real catalogue within 50 km — previously this was a
  // single fabricated camera sitting exactly on the target.
  const nearby = await fetchCctvEnhanced(target.lat, target.lon, 50);

  return {
    query,
    matchType: result.matchType,
    ...CATALOG_MARK,
    notice: CATALOG_NOTICE,
    // What the number itself proves: the operator. Never a position.
    phoneIntel: result.phoneIntel || describePhone(target.phone),
    target: {
      id: target.id,
      name: target.name,
      username: target.username,
      phone: target.phone,
      lat: target.lat,
      lon: target.lon,
      city: target.city,
      status: target.status,
    },
    position: { lat: target.lat, lon: target.lon },
    bbox,
    location: {
      lat: target.lat,
      lon: target.lon,
      altitude_m: 500,
    },
    cctv: {
      available: nearby.count > 0,
      count: nearby.count,
      radiusKm: 50,
      cameras: nearby.inside.slice(0, 5),
    },
    intent: {
      tool: 'show_in_gods_eye_view',
      camera: { lat: target.lat, lon: target.lon, altitude_m: 500 },
      layers: ['streetLevel', 'cctv', 'target'],
    },
    generatedAt: Date.now(),
  };
}
