/**
 * scan-indonesia-cameras.mjs — build a VERIFIED camera catalog for Indonesia
 * and Papua from public, legal sources only.
 *
 * Sources (all verified live on 2026-11-15):
 *  1. ATCS Dishub portals — real traffic CCTV with HLS manifests. The list is
 *     the committed snapshot produced by `scripts/fetch-atcs.mjs`, which swept
 *     188 `atcs.<city>.go.id` domains INCLUDING every Papua regency/city. Only
 *     two portals answered; both are on Java/Kalimantan. No Papua ATCS feed.
 *  2. Mapillary Graph API — street imagery, CC BY-SA 4.0. Needs
 *     MAPILLARY_CLIENT_TOKEN; skipped when unset. Bounding boxes stay below
 *     the API's 0.01 deg^2 limit.
 *
 * KartaView (OpenStreetCam) is NOT used. Its metadata API still answers, but
 * every image it advertises is dead: `cdn.kartaview.org/pr:sharp/<b64>` returns
 * HTTP 500 and the decoded `storage1.openstreetcam.org` object returns 404. A
 * pin whose frame cannot load is worse than no pin, so the pack omits it.
 *
 * Deliberately NOT used:
 *  - Insecure/private camera directories or default-password streams.
 *  - `server/services/place-card-local/cctv-enhanced.mjs`'s 40 `cctv-NNN`
 *    entries: those are hardcoded sample coordinates with no feed URL, not
 *    real cameras. They must never be presented as open CCTV.
 *  - Overpass/OSM `man_made=surveillance`: the reachable global Overpass
 *    mirrors fail from this host, and a raw OSM API sample of Jayapura
 *    (9.3 MB) contained zero surveillance tags.
 *
 * The anchors are approximate town centres used ONLY to sample public imagery;
 * every emitted camera coordinate comes from the source API itself.
 *
 * Run: PATH="/c/Program Files/nodejs:$PATH" node scripts/scan-indonesia-cameras.mjs
 * Out: config/cctv_sources.indonesia.json
 *      config/cctv_indonesia_coverage.json
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { PAPUA_PROVINCES, provinceOf } from '../server/services/place-card-local/papua-provinces.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'config/cctv_sources.indonesia.json');
const COVERAGE_OUT = path.join(ROOT, 'config/cctv_indonesia_coverage.json');
const ATCS_SNAPSHOT = path.join(
  ROOT,
  'server/services/place-card-local/cctv-atcs-catalog.json',
);

const TIMEOUT_MS = 35_000;
const CONCURRENCY = 3;
const PER_ANCHOR = 6;
const MLY_BBOX_DEG = 0.04; // 0.08 x 0.08 = 0.0064 deg^2, under the 0.01 limit

/** Approximate town-centre anchors. Papua covers all six provinces plus their
 * regency seats; the rest are Indonesia's largest camera-dense metros. */
const ANCHORS = [
  // Papua — province capitals (exact values reused from papua-provinces.mjs)
  ...PAPUA_PROVINCES.map((province) => ({
    name: province.capital,
    province: province.name,
    lat: province.capitalLat,
    lon: province.capitalLon,
    papua: true,
  })),
  // Papua — additional regency seats / towns
  { name: 'Sentani', province: 'Papua', lat: -2.5667, lon: 140.5167, papua: true },
  { name: 'Biak', province: 'Papua', lat: -1.1758, lon: 136.0833, papua: true },
  { name: 'Serui', province: 'Papua', lat: -1.8833, lon: 136.2333, papua: true },
  { name: 'Sarmi', province: 'Papua', lat: -1.8667, lon: 138.75, papua: true },
  { name: 'Timika', province: 'Papua Tengah', lat: -4.55, lon: 136.8833, papua: true },
  { name: 'Enarotali', province: 'Papua Tengah', lat: -3.55, lon: 136.35, papua: true },
  { name: 'Nabire', province: 'Papua Tengah', lat: -3.3667, lon: 135.4833, papua: true },
  { name: 'Wamena', province: 'Papua Pegunungan', lat: -4.1, lon: 138.95, papua: true },
  { name: 'Tolikara', province: 'Papua Pegunungan', lat: -3.6833, lon: 138.4833, papua: true },
  { name: 'Yahukimo', province: 'Papua Pegunungan', lat: -4.4833, lon: 139.5333, papua: true },
  { name: 'Puncak Jaya', province: 'Papua Tengah', lat: -3.6167, lon: 137.4833, papua: true },
  { name: 'Merauke', province: 'Papua Selatan', lat: -8.4667, lon: 140.3333, papua: true },
  { name: 'Tanah Merah', province: 'Papua Selatan', lat: -6.1, lon: 140.3, papua: true },
  { name: 'Agats', province: 'Papua Selatan', lat: -5.55, lon: 138.13, papua: true },
  { name: 'Kepi', province: 'Papua Selatan', lat: -6.53, lon: 139.33, papua: true },
  { name: 'Fakfak', province: 'Papua Barat', lat: -2.9167, lon: 132.3, papua: true },
  { name: 'Kaimana', province: 'Papua Barat', lat: -3.65, lon: 133.75, papua: true },
  { name: 'Bintuni', province: 'Papua Barat', lat: -2.1167, lon: 133.5167, papua: true },
  { name: 'Manokwari', province: 'Papua Barat', lat: -0.8667, lon: 134.0833, papua: true },
  { name: 'Waisai', province: 'Papua Barat Daya', lat: -0.2167, lon: 130.8167, papua: true },
  { name: 'Teminabuan', province: 'Papua Barat Daya', lat: -1.4667, lon: 132.0, papua: true },
  { name: 'Sorong', province: 'Papua Barat Daya', lat: -0.8763, lon: 131.2558, papua: true },
  // Indonesia — major metros outside Papua
  { name: 'Jakarta', province: 'DKI Jakarta', lat: -6.2, lon: 106.8167 },
  { name: 'Bandung', province: 'Jawa Barat', lat: -6.9175, lon: 107.6191 },
  { name: 'Surabaya', province: 'Jawa Timur', lat: -7.2478, lon: 112.7644 },
  { name: 'Yogyakarta', province: 'DI Yogyakarta', lat: -7.7953, lon: 110.3678 },
  { name: 'Semarang', province: 'Jawa Tengah', lat: -6.9667, lon: 110.4167 },
  { name: 'Denpasar', province: 'Bali', lat: -8.6507, lon: 115.2175 },
  { name: 'Medan', province: 'Sumatra Utara', lat: 3.5833, lon: 98.6667 },
  { name: 'Makassar', province: 'Sulawesi Selatan', lat: -5.1621, lon: 119.4341 },
  { name: 'Banjarmasin', province: 'Kalimantan Selatan', lat: -3.3167, lon: 114.59 },
  { name: 'Banjar', province: 'Jawa Barat', lat: -7.366, lon: 108.544 },
  { name: 'Balikpapan', province: 'Kalimantan Timur', lat: -1.2379, lon: 116.8529 },
  { name: 'Manado', province: 'Sulawesi Utara', lat: 1.4748, lon: 124.8421 },
];

/** Deterministic pseudo-heading so cameras are not all drawn facing north. */
function fallbackHeading(id) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 360;
}

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function plausibleIndonesia(lat, lon) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -11 &&
    lat <= 6 &&
    lon >= 95 &&
    lon <= 141
  );
}

function https(value) {
  return typeof value === 'string' && value.startsWith('https://')
    ? value
    : '';
}

/** Dense-metro queries occasionally answer 500 under parallel load. One
 * paced retry is enough; a permanently failing anchor is recorded, not fatal. */
async function fetchJson(url, headers = {}) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
  throw lastError;
}

/** One Mapillary anchor -> up to PER_ANCHOR street images inside a small bbox. */
async function mapillaryAt(anchor, token) {
  // Mapillary answers HTTP 500 ("reduce the amount of data") when a box holds
  // more images than it will return, and a dense metro exceeds it even at the
  // documented 0.01 deg^2 ceiling. Measured on 2026-11-15: central Jakarta
  // needs d<=0.004 to answer at all, and d=0.001 comes back in under 2 s.
  // The ladder therefore starts small for metros and grows when a box is empty,
  // so a sparse town is not reported as "no imagery" just because its first
  // box was too tight.
  const widths = anchor.papua
    ? [MLY_BBOX_DEG, MLY_BBOX_DEG / 2]
    : [0.002, 0.004, 0.008, 0.02];
  let lastError = null;
  let sawSuccess = false;
  let best = [];
  for (const d of widths) {
    const bbox = [
      anchor.lon - d,
      anchor.lat - d,
      anchor.lon + d,
      anchor.lat + d,
    ].join(',');
    const url = new URL('https://graph.mapillary.com/images');
    url.searchParams.set('access_token', token);
    url.searchParams.set(
      'fields',
      'id,geometry,captured_at,thumb_256_url,compass_angle',
    );
    url.searchParams.set('limit', String(PER_ANCHOR));
    url.searchParams.set('bbox', bbox);
    try {
      const body = await fetchJson(url);
      sawSuccess = true;
      const rows = Array.isArray(body?.data) ? body.data : [];
      if (rows.length) {
        best = rows;
        break;
      }
    } catch (error) {
      lastError = error;
      if (!/HTTP 5\d\d/.test(String(error?.message))) throw error;
    }
  }
  // Only a total wipeout is an upstream error; "200 with no rows" is a real
  // answer for a town nobody has driven through.
  if (!sawSuccess && lastError) throw lastError;
  return best.map((image) => {
    const coords = image?.geometry?.coordinates;
    const lon = finite(coords?.[0]);
    const lat = finite(coords?.[1]);
    const imageUrl = https(image.thumb_256_url);
    if (!plausibleIndonesia(lat, lon) || !imageUrl) return null;
    const id = `mly-${image.id}`;
    const compass = finite(image.compass_angle);
    return {
      id,
      name: `${anchor.name} · Mapillary image ${image.id}`,
      city: `${anchor.name}, ${anchor.province}`,
      cityId: `id-${anchor.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      provider: 'Mapillary',
      lat,
      lon,
      headingDeg: compass ?? fallbackHeading(id),
      headingConfidence: compass === null ? 'low' : 'high',
      pitchDeg: -8,
      fovDeg: 70,
      rangeM: 90,
      mountHeightM: 1.8,
      feedType: 'image',
      url: imageUrl,
      snapshotUrl: imageUrl,
      license: 'CC BY-SA 4.0 — © Mapillary Contributors',
      credit: '© Mapillary Contributors',
      sourceKind: 'mapillary-street-image',
      code: `MLY-${String(image.id).slice(-4)}`,
      anchor: anchor.name,
      capturedAt: Number.isFinite(image.captured_at)
        ? new Date(image.captured_at).toISOString()
        : null,
      sweptAt: new Date().toISOString(),
    };
  }).filter(Boolean);
}

/** Real ATCS traffic cameras from the committed sweep snapshot. */
async function atcsCameras() {
  const raw = JSON.parse(await fs.readFile(ATCS_SNAPSHOT, 'utf8'));
  const labels = {
    banjarkota: 'Banjar, Jawa Barat',
    banjarmasinkota: 'Banjarmasin, Kalimantan Selatan',
  };
  const cameras = [];
  for (const city of Array.isArray(raw?.cities) ? raw.cities : []) {
    for (const cam of Array.isArray(city.camerasList) ? city.camerasList : []) {
      const lat = finite(cam.lat);
      const lon = finite(cam.lon);
      const streamUrl = https(cam.streamUrl);
      if (!plausibleIndonesia(lat, lon) || !streamUrl) continue;
      const id = `atcs-${cam.id}`;
      cameras.push({
        id,
        name: `${cam.name || 'ATCS'} · ${city.domain}`,
        city: labels[city.domain] || city.domain,
        cityId: `id-${city.domain}`,
        provider: `Dishub ${city.domain} ATCS`,
        lat,
        lon,
        headingDeg: fallbackHeading(id),
        headingConfidence: 'low',
        pitchDeg: -14,
        fovDeg: 62,
        rangeM: 180,
        mountHeightM: 8,
        feedType: 'hls',
        url: streamUrl,
        snapshotUrl: '',
        license: 'Public Dishub ATCS portal — live stream, no redistribution',
        credit: cam.live
          ? `Live HLS at sweep ${raw.sweptAt || '2026-11-03'}`
          : `Offline at sweep ${raw.sweptAt || '2026-11-03'}`,
        // Explicit flag so the loader never has to parse the note above.
        online: Boolean(cam.live),
        sourceKind: 'atcs-id',
        code: `ATCS-${String(cam.id).slice(-4)}`,
        anchor: city.domain,
        sweptAt: raw.sweptAt || '2026-11-03T13:54:39.977Z',
      });
    }
  }
  return cameras;
}

/** Bounded worker pool so the public APIs are not hammered. */
async function pooled(items, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await worker(items[index]);
      } catch (error) {
        results[index] = { error: error?.message || String(error), anchor: items[index].name };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

async function main() {
  let token = String(process.env.MAPILLARY_CLIENT_TOKEN || '').trim();
  if (!token) {
    // The dev server loads .env itself; a standalone scan does not. Read only
    // the one variable we need, and never print it.
    try {
      token = String(
        parseEnv(await fs.readFile(path.join(ROOT, '.env'), 'utf8'))
          .MAPILLARY_CLIENT_TOKEN || '',
      ).trim();
    } catch {
      // No .env: Mapillary is simply skipped.
    }
  }
  const cameras = new Map();
  const add = (row) => {
    if (row && !cameras.has(row.id)) cameras.set(row.id, row);
  };

  const atcs = await atcsCameras();
  atcs.forEach(add);

  const mlyResults = token
    ? await pooled(ANCHORS, (anchor) => mapillaryAt(anchor, token))
    : [];
  for (const result of mlyResults) {
    if (Array.isArray(result)) result.forEach(add);
  }

  const rows = [...cameras.values()].sort((a, b) => a.id.localeCompare(b.id));
  const counts = {};
  const provinces = {};
  const papuaAnchorsWithImagery = new Set();
  for (const row of rows) {
    counts[row.sourceKind] = (counts[row.sourceKind] || 0) + 1;
    const province = provinceOf(row.lat, row.lon);
    if (province) {
      provinces[province.name] = (provinces[province.name] || 0) + 1;
      if (row.sourceKind !== 'atcs-id') papuaAnchorsWithImagery.add(row.anchor);
    }
  }
  const errors = mlyResults
    .filter((r) => r && !Array.isArray(r))
    .map((r) => ({ ...r, source: 'mapillary' }));

  const coverage = {
    sweptAt: new Date().toISOString(),
    anchorsSampled: ANCHORS.length,
    papuaAnchorsSampled: ANCHORS.filter((a) => a.papua).length,
    papuaAnchorsWithStreetImagery: [...papuaAnchorsWithImagery].sort(),
    liveCctvInPapua: 0,
    liveCctvInIndonesia: atcs.filter((c) => c.credit.startsWith('Live')).length,
    totalCameras: rows.length,
    bySource: counts,
    byPapuaProvince: provinces,
    upstreamErrors: errors,
    sources: [
      {
        name: 'ATCS Dishub portals',
        url: 'https://atcs.banjarkota.go.id / https://atcs.banjarmasinkota.go.id',
        kind: 'live HLS traffic CCTV',
        sweptDomains: 188,
        portalsUp: 2,
        license: 'Public government portal',
      },
      {
        name: 'Mapillary Graph API',
        url: 'https://graph.mapillary.com/images',
        kind: 'geotagged street imagery, not live video',
        license: 'CC BY-SA 4.0 — © Mapillary Contributors',
        enabled: Boolean(token),
      },
    ],
    excluded: [
      'Insecure/private camera directories',
      'cctv-enhanced.mjs synthetic cctv-NNN sample entries (no feed URL)',
      'OSM man_made=surveillance (zero tags in sampled Indonesia/Papua bboxes)',
      'KartaView (OpenStreetCam): image CDN answers HTTP 500 and every decoded storage object 404, so its pins would show no frame',
    ],
    note: 'There is no public source of live CCTV covering all of Papua. These are real camera/imagery positions from legal open sources; zero live CCTV feeds were found in Papua. Offline ATCS streams are excluded at load time.',
  };

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
  await fs.writeFile(COVERAGE_OUT, `${JSON.stringify(coverage, null, 2)}\n`, 'utf8');
  console.log(
    JSON.stringify(
      {
        total: rows.length,
        bySource: counts,
        papuaAnchorsWithImagery: coverage.papuaAnchorsWithStreetImagery,
        liveCctvInPapua: coverage.liveCctvInPapua,
        upstreamErrors: errors.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('[scan-indonesia-cameras] failed:', error?.message || error);
  process.exitCode = 1;
});
