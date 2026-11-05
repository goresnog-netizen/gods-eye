/**
 * API: /api/cctv — the camera catalog.
 *
 * Static data only: no upstream call, no key, no file system dependency beyond
 * the optional source packs in config/. A serverless invocation answers in
 * milliseconds and the CDN can cache it.
 *
 * Every entry carries a real coordinate. `streamUrl` is present only where a
 * public stream actually exists; without it the panel shows the camera on the
 * globe and offers the nearest street-level photo instead of a dead player.
 *
 * Query params
 *   catalog=1              → the catalog plus its facets
 *   city=<name>            → one city
 *   provider=<name>        → one provider
 *   type=fixed|atcs|mobile → one kind
 *   papua=1                → Papua provinces only
 *   near=<lat>,<lon>[,km]  → within a radius (default 50 km)
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.resolve(HERE, '../../config');

/** Papua provinces' cities — used by `?papua=1`. */
const PAPUA_CITIES = new Set([
  'Jayapura',
  'Sentani',
  'Abepura',
  'Sorong',
  'Manokwari',
  'Merauke',
  'Timika',
  'Wamena',
  'Biak',
  'Nabire',
  'Fakfak',
  'Kaimana',
  'Tembagapura',
  'Serui',
  'Tual',
  'Saumlaki',
  'Raja Ampat',
  'Mimika',
]);

/** Indonesia — national and provincial capitals. */
const INDONESIA = [
  ['Jakarta', -6.1751, 106.8272, 'Monas'],
  ['Jakarta', -6.2088, 106.8456, 'Sudirman'],
  ['Jakarta', -6.1944, 106.8229, 'Thamrin'],
  ['Jakarta', -6.1934, 106.823, 'Bundaran HI'],
  ['Jakarta', -6.2297, 106.806, 'Senayan'],
  ['Jakarta', -6.2439, 106.7827, 'Blok M'],
  ['Jakarta', -6.1389, 106.8236, 'Mangga Dua'],
  ['Jakarta', -6.2191, 106.8164, 'Kemang'],
  ['Surabaya', -7.2456, 112.738, 'Tugu Pahlawan'],
  ['Surabaya', -7.2573, 112.7509, 'Jl. Pemuda'],
  ['Bandung', -6.9175, 107.6065, 'Braga'],
  ['Bandung', -6.8901, 107.6106, 'Dago'],
  ['Yogyakarta', -7.7929, 110.3632, 'Malioboro'],
  ['Semarang', -6.9666, 110.4204, 'Simpang Lima'],
  ['Medan', 3.5881, 98.6734, 'Lapangan Merdeka'],
  ['Makassar', -5.1415, 119.4108, 'Pantai Losari'],
  ['Denpasar', -8.6793, 115.2167, 'Renon'],
  ['Palembang', -2.9902, 104.7562, 'Jembatan Ampera'],
  ['Balikpapan', -1.2682, 116.8286, 'Masjid Sultan'],
  ['Samarinda', -0.4928, 117.1494, 'GOR Samarinda'],
  ['Banjarmasin', -3.3186, 114.5944, 'Pasar Terapung'],
  ['Pontianak', -0.0263, 109.3425, 'Tugu Khatulistiwa'],
  ['Manado', 1.4748, 124.8421, 'Boulevard'],
  ['Padang', -0.9471, 100.4172, 'Pantai Padang'],
  ['Banda Aceh', 5.5483, 95.3238, 'Masjid Raya'],
];

/** Papua — the region this build is built around. */
const PAPUA = [
  ['Jayapura', -2.5337, 140.7181, 'Kota Jayapura'],
  ['Abepura', -2.5837, 140.6681, 'Abepura'],
  ['Sentani', -2.5769, 140.5144, 'Bandar Udara Sentani'],
  ['Sorong', -0.8799, 131.2491, 'Kota Sorong'],
  ['Manokwari', -0.8538, 134.0625, 'Pasar Manokwari'],
  ['Merauke', -8.4982, 140.4019, 'Kota Merauke'],
  ['Timika', -4.5448, 136.8852, 'Kota Timika'],
  ['Tembagapura', -4.1426, 137.0906, 'Tembagapura'],
  ['Wamena', -3.9833, 138.95, 'Pasar Wamena'],
  ['Biak', -1.1906, 136.1083, 'Bandar Udara Biak'],
  ['Nabire', -3.3532, 135.4861, 'Pantai Nabire'],
  ['Fakfak', -3.8611, 133.6855, 'Pelabuhan Fakfak'],
  ['Kaimana', -3.6439, 133.7456, 'Kota Kaimana'],
  ['Serui', -1.8772, 136.2407, 'Kota Serui'],
  ['Raja Ampat', -0.5897, 130.1015, 'Waisai'],
];

function buildCatalog() {
  const cameras = [];
  let n = 0;

  for (const [city, lat, lon, name] of INDONESIA) {
    n += 1;
    cameras.push({
      id: `id-${String(n).padStart(3, '0')}`,
      name: `${city} — ${name}`,
      city,
      region: 'indonesia',
      lat,
      lon,
      provider: 'local',
      type: 'fixed',
    });
  }

  for (const [city, lat, lon, name] of PAPUA) {
    n += 1;
    cameras.push({
      id: `pa-${String(n).padStart(3, '0')}`,
      name: `${city} — ${name}`,
      city,
      region: 'papua',
      lat,
      lon,
      provider: 'local',
      type: 'fixed',
    });
  }

  return cameras;
}

/**
 * Source packs under config/. Each file is a JSON array of camera rows. A pack
 * that fails to parse is skipped rather than failing the whole catalog.
 */
function loadSourcePacks() {
  const cameras = [];
  let files;
  try {
    files = readdirSync(CONFIG_DIR).filter((f) => /^cctv_sources\..*\.json$/.test(f));
  } catch {
    return cameras;
  }

  for (const file of files) {
    try {
      const rows = JSON.parse(readFileSync(path.join(CONFIG_DIR, file), 'utf8'));
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        const lat = Number(row.lat ?? row.latitude);
        const lon = Number(row.lon ?? row.longitude ?? row.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        cameras.push({
          id: String(row.id ?? `${file}:${cameras.length}`),
          name: String(row.name ?? row.title ?? 'camera'),
          city: row.city ? String(row.city) : null,
          region: 'pack',
          lat,
          lon,
          provider: String(row.provider ?? 'atcs'),
          type: String(row.type ?? 'atcs'),
          streamUrl: row.streamUrl ?? row.url ?? null,
          posterUrl: row.posterUrl ?? null,
        });
      }
    } catch {
      // An unreadable pack is not fatal — the base catalog still answers.
    }
  }
  return cameras;
}

function haversineKm(aLat, aLon, bLat, bLon) {
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLon = (bLon - aLon) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

let cachedCatalog = null;
function catalog() {
  if (!cachedCatalog) cachedCatalog = [...buildCatalog(), ...loadSourcePacks()];
  return cachedCatalog;
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).send('');
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const q = req.query || {};
  const all = catalog();
  const cities = [...new Set(all.map((c) => c.city).filter(Boolean))].sort();

  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');

  // ── Catalog counts — the shape the panel's CCTV tab reads ─────────────────
  if (q.catalog === '1') {
    const byType = {};
    const byProvider = {};
    for (const camera of all) {
      byType[camera.type] = (byType[camera.type] || 0) + 1;
      byProvider[camera.provider] = (byProvider[camera.provider] || 0) + 1;
    }
    return res.status(200).json({
      ok: true,
      counts: {
        total: all.length,
        byType,
        byProvider,
        papua: all.filter((c) => c.region === 'papua' || PAPUA_CITIES.has(c.city))
          .length,
      },
      cities,
      providers: [...new Set(all.map((c) => c.provider).filter(Boolean))].sort(),
      streams: all.filter((c) => c.streamUrl).length,
    });
  }

  // ── Cameras near a point — the shape the map layer reads ──────────────────
  let lat = Number(q.lat);
  let lon = Number(q.lon);
  if (q.near && (!Number.isFinite(lat) || !Number.isFinite(lon))) {
    const [latRaw, lonRaw] = String(q.near).split(',');
    lat = Number(latRaw);
    lon = Number(lonRaw);
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({
      ok: false,
      error: 'point_required',
      hint: 'Pass ?lat=-4.53&lon=140.5 or ?catalog=1',
    });
  }

  const radiusKm = Math.min(Math.max(Number(q.radiusKm) || 50, 1), 500);
  const type = q.type || null;
  const city = q.city || null;
  const provider = q.provider || null;

  let filtered = all;
  if (type) filtered = filtered.filter((c) => c.type === type);
  if (city) filtered = filtered.filter((c) => c.city === city);
  if (provider) filtered = filtered.filter((c) => c.provider === provider);

  const inside = filtered
    .map((camera) => ({
      ...camera,
      distance: Math.round(haversineKm(lat, lon, camera.lat, camera.lon) * 100) / 100,
    }))
    .filter((camera) => camera.distance <= radiusKm)
    .sort((a, b) => a.distance - b.distance);

  return res.status(200).json({
    ok: true,
    origin: { lat, lon },
    radiusKm,
    filters: { type, city, provider },
    source: 'local-catalog',
    available: true,
    count: inside.length,
    total: filtered.length,
    inside,
  });
}
