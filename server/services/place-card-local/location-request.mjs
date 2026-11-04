/**
 * One-time consented location requests.
 *
 * A phone number can turn into a real position without a cell id — but only
 * with the owner's consent. This store runs that flow:
 *
 *   create → { id, secret, token, link }   (requester keeps secret)
 *   target opens link, consents, browser posts { lat, lon, accuracyM }
 *   requester polls get( id, secret ) until status 'collected'
 *
 * Everything is one-time: a collected fix can never be re-read, an expired
 * request dies, and only the holder of the secret sees the coordinate. The
 * store is a local JSON file under `.gev-cache` (gitignored) — coordinates of
 * a person are never committed and never leave the machine.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

/** Default lifetime of a pending request. */
export const LOCATION_REQUEST_TTL_MS = 30 * 60_000;
/** Hard cap on concurrent open requests, to keep the store small. */
export const LOCATION_REQUEST_MAX_OPEN = 50;

export function defaultLocationRequestFile() {
  return (
    process.env.GODSEYE_LOCATION_REQUESTS ||
    path.join(ROOT, '.gev-cache/location-requests.json')
  );
}

/**
 * A display-safe form of a number: the first four and last three digits stay,
 * the middle is stars. 081340934688 → 0813*****688.
 */
export function maskNumber(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length <= 7) return digits || '—';
  const keepStart = 4;
  const keepEnd = 3;
  const start = digits.slice(0, keepStart);
  const end = digits.slice(-keepEnd);
  const middle = digits.slice(keepStart, -keepEnd).replace(/\d/g, '*');
  return `${start}${middle}${end}`;
}

/** Normalize a user-supplied number; null when it is not plausibly a number. */
export function normalizeNumber(raw) {
  const cleaned = String(raw || '').replace(/[\s\-().]/g, '');
  if (!/^\+?\d{8,15}$/.test(cleaned)) return null;
  return cleaned;
}

/** Shared write chain so two concurrent writes never race on the same file. */
function createStore(file) {
  const state = { records: null };
  let writeChain = Promise.resolve();

  function load() {
    if (state.records !== null) return state.records;
    try {
      state.records = JSON.parse(readFileSync(file, 'utf8')) || {};
    } catch {
      state.records = {};
    }
    return state.records;
  }

  function save() {
    const snapshot = JSON.stringify(state.records, null, 0);
    writeChain = writeChain.then(() => {
      mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      writeFileSync(tmp, snapshot, 'utf8');
      writeFileSync(file, snapshot, 'utf8');
    });
    return writeChain;
  }

  function clear() {
    load();
    state.records = {};
    return save();
  }

  return { load, save, clear };
}

/**
 * Create a one-time location request for a number.
 *
 * @param {object} options
 * @param {string} options.number - the E.164 or national number
 * @param {string} options.legalBasis - why this person-directed query is allowed
 * @param {string} [options.file] - store file (tests inject one)
 * @param {number} [options.now] - clock injection for tests
 * @param {number} [options.ttlMs]
 * @param {string} [options.origin] - base URL for the consent link
 */
export async function createLocationRequest(options) {
  const {
    number,
    legalBasis,
    file = defaultLocationRequestFile(),
    now = Date.now(),
    ttlMs = LOCATION_REQUEST_TTL_MS,
    origin = 'http://localhost:4173',
  } = options;
  const e164 = normalizeNumber(number);
  if (!e164) {
    return {
      ok: false,
      error: 'invalid_number',
      hint: 'E.164 or national digits',
    };
  }
  if (!legalBasis || !String(legalBasis).trim()) {
    return { ok: false, error: 'legal_basis_required' };
  }
  const store = createStore(file);
  const open = Object.values(store.load()).filter(
    (r) => r.status === 'pending' && r.expiresAt > now,
  ).length;
  if (open >= LOCATION_REQUEST_MAX_OPEN) {
    return { ok: false, error: 'too_many_open' };
  }
  const id = randomBytes(4).toString('hex');
  const token = randomBytes(16).toString('hex');
  const secret = randomBytes(16).toString('hex');
  const expiresAt = now + ttlMs;
  store.load()[id] = {
    id,
    token,
    secret,
    number: e164,
    numberMasked: maskNumber(e164),
    legalBasis: String(legalBasis).trim(),
    status: 'pending',
    createdAt: now,
    expiresAt,
  };
  await store.save();
  return {
    ok: true,
    id,
    secret,
    token,
    expiresAt,
    link: `${origin}/api/godseye/locate-consent/${token}`,
  };
}

/**
 * The requester's view of a request. Wrong or missing secret reads as null —
 * the coordinate belongs to the request, not to whoever can guess an id.
 */
export async function getLocationRequest(id, secret, options = {}) {
  const store = createStore(options.file || defaultLocationRequestFile());
  const record = store.load()[id];
  if (!record || record.secret !== secret) return null;
  const now = options.now ?? Date.now();
  if (record.status === 'pending' && record.expiresAt <= now) {
    record.status = 'expired';
    await store.save();
  }
  const out = {
    id: record.id,
    status: record.status,
    numberMasked: record.numberMasked,
    legalBasis: record.legalBasis,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
  if (record.status === 'collected') {
    out.fix = {
      lat: record.fix.lat,
      lon: record.fix.lon,
      accuracyM: record.fix.accuracyM,
      collectedAt: record.fix.collectedAt,
    };
  }
  return out;
}

/**
 * Accept the fix the target's browser posted. One-time: a second submit
 * answers 'already_collected' and returns nothing new.
 */
export async function collectLocationFix(id, token, fix, options = {}) {
  const { file = defaultLocationRequestFile(), now = Date.now() } = options;
  const store = createStore(file);
  const record = store.load()[id];
  if (!record || record.token !== token) {
    return { ok: false, error: 'invalid_token' };
  }
  if (record.status === 'collected') {
    return { ok: false, error: 'already_collected' };
  }
  if (record.expiresAt <= now) {
    record.status = 'expired';
    await store.save();
    return { ok: false, error: 'expired' };
  }
  const lat = Number(fix?.lat);
  const lon = Number(fix?.lon);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    return { ok: false, error: 'invalid_fix' };
  }
  record.status = 'collected';
  record.fix = {
    lat: Math.round(lat * 1e6) / 1e6,
    lon: Math.round(lon * 1e6) / 1e6,
    accuracyM: Number.isFinite(Number(fix?.accuracyM))
      ? Math.max(0, Math.round(Number(fix.accuracyM)))
      : null,
    collectedAt: now,
  };
  await store.save();
  return { ok: true };
}

/** Count of open (pending, not yet expired) requests. */
export function openRequestCount(options = {}) {
  const store = createStore(options.file || defaultLocationRequestFile());
  const now = options.now ?? Date.now();
  return Object.values(store.load()).filter(
    (r) => r.status === 'pending' && r.expiresAt > now,
  ).length;
}

/**
 * The consent routes look a record up by the token that lives in the link
 * URL. The token alone only grants the holder the right to open or submit
 * the request — never to read the fix.
 */
export function locationRecordByToken(token, options = {}) {
  const store = createStore(options.file || defaultLocationRequestFile());
  return Object.values(store.load()).find((r) => r.token === token) || null;
}

/** Forget every record (tests and manual cleanup). */
export async function clearLocationRequests(options = {}) {
  const store = createStore(options.file || defaultLocationRequestFile());
  await store.clear();
}
