/**
 * fetch-atcs.mjs — collect real public traffic CCTV from Indonesian ATCS portals.
 *
 * Many Indonesian cities/regencies publish their Dishub traffic cameras on
 * `atcs.<slug>.go.id` portals. Two known templates:
 *   - "Banjar" template: PHP backend with `modul/get_data_map.php` (camera list)
 *     and `modul/get_data_live.php?id=N` (per-camera HLS url_link_1).
 *   - SPA template (Vue + NestJS `/api`): probed for common public routes.
 *
 * Output: .gev-cache/atcs-catalog.json with per-city camera lists, coordinates
 * and live/dead status after a real HLS manifest check. Read-only, rate
 * limited, no credentials, no POST.
 *
 * Run: node scripts/fetch-atcs.mjs [--papua-only] [--live-timeout-ms 8000]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(__dirname, '../.gev-cache');
const OUT = path.join(CACHE_DIR, 'atcs-catalog.json');

const TIMEOUT_MS = 6000;
const LIVE_TIMEOUT_MS = 8000;
const CONCURRENCY = 6;
const PAPUA_ONLY = process.argv.includes('--papua-only');

/** All 38 provinces' capitals + major cities + every Papua regency/city. */
const DOMAINS = [
  // === PAPUA (entire island, every regency and city) ===
  // Papua — West Papua (Papua Barat)
  'sorongkota',
  'sorong',
  'fakfak',
  'kaimana',
  'manokwari',
  'manokwariselatan',
  'pegununganarfak',
  'telukbintuni',
  'telukwondama',
  'tambrauw',
  'maybrat',
  'rajaampat',
  'sorongselatan',
  // Papua — Southwest Papua (Papua Barat Daya)
  'sorongselatankab',
  'maybratkab',
  'rajaampatkab',
  'tambrauwkab',
  // Papua — South Papua (Papua Selatan)
  'merauke',
  'meraukekab',
  'mappi',
  'mappikab',
  'asmat',
  'asmatkab',
  'bovendigoel',
  'bovendigoelkab',
  // Papua — Central Papua (Papua Tengah)
  'nabire',
  'nabirekab',
  'mimika',
  'mimikakab',
  'paniai',
  'paniaikab',
  'dogiyai',
  'dogiyaikab',
  'deiyai',
  'deiyaikab',
  'intanjaya',
  'intanjayakab',
  'puncakjaya',
  'puncakjayakab',
  'puncak',
  'puncakkab',
  // Papua — Highland Papua (Papua Pegunungan)
  'jayawijaya',
  'jayawijayakab',
  'lannyjaya',
  'lannyjayakab',
  'mamberamotengah',
  'mamberamotengahkab',
  'nduga',
  'ndugakab',
  'pegununganbintang',
  'pegununganbintangkab',
  'tolikara',
  'tolikarakab',
  'yahukimo',
  'yahukimokab',
  'yalimo',
  'yalimokab',
  // Papua — Papua province (Papua)
  'jayapurakota',
  'jayapura',
  'jayapurakab',
  'biaknumfor',
  'biaknumforkab',
  'keerom',
  'keeromkab',
  'kepulauanyapen',
  'kepulauanyapenkab',
  'mamberamoraya',
  'mamberamorayakab',
  'sarmi',
  'sarmikab',
  'supiori',
  'supiorikab',
  'waropen',
  'waropenkab',
  // === SUMATRA ===
  'medankota',
  'padangkota',
  'pekanbarukota',
  'batamkota',
  'tanjungpinangkota',
  'jambikota',
  'palembangkota',
  'pangkalpinangkota',
  'bandarlampungkota',
  'bengkuluskota',
  'bandaacehkota',
  'lhokseumawekota',
  'padangsidimpuankota',
  'binjaikota',
  'tebingtinggikota',
  'pematangsiantarkota',
  'sibolgakota',
  'dumalkota',
  'bukittinggikota',
  'payakumbuhkota',
  'sawahluntokota',
  'padangpanjangkota',
  'solokkota',
  'metrokota',
  'sungaipenuhkota',
  'sabangkota',
  'langsakota',
  'subulussalamkota',
  'gunungsitolikota',
  'tanjungbalaikota',
  'prabumulihkota',
  'pageralamkota',
  'lubuklinggaukota',
  // === JAVA ===
  'jakarta',
  'jakartapusat',
  'jakartautara',
  'jakartabarat',
  'jakartaselatan',
  'jakartatimur',
  'bandungkota',
  'bandung',
  'surabayakota',
  'surabaya',
  'semarangkota',
  'semarang',
  'yogyakartakota',
  'yogyakarta',
  'surakartakota',
  'solo',
  'tanggerangkota',
  'tangerang',
  'tangerangselatankota',
  'depokkota',
  'depok',
  'bekasikota',
  'bekasi',
  'bogorkota',
  'bogor',
  'malangkota',
  'malang',
  'cilegonkota',
  'serangkota',
  'tasikmalayakota',
  'banjarkota',
  'banjar',
  'cimahikota',
  'sukabumikota',
  'cirebonkota',
  'pekalongankota',
  'tegal kota'.replace(' ', ''),
  'salatigakota',
  'magelangkota',
  'kedirikota',
  'blitarkota',
  'madiunkota',
  'mojokertokota',
  'pasuruankota',
  'probollinggokota',
  'batu-kota'.replace('-', ''),
  'probolinggokota',
  // === KALIMANTAN ===
  'pontianakkota',
  'samarindakota',
  'balikpapankota',
  'tanjungselorkota',
  'tarakankota',
  'bontangkota',
  'palangkarayakota',
  'banjarbarukota',
  'banjarmasinkota',
  'singkawangkota',
  // === SULAWESI ===
  'makassarkota',
  'manadokota',
  'palu kota'.replace(' ', ''),
  'kendarikota',
  'bauba ukota'.replace(' ', ''),
  'gorontalokota',
  'palopokota',
  'bitungkota',
  'tomohonkota',
  'kotamobagukota',
  'pareparekota',
  // === NUSA TENGGARA / MALUKU / PAPUA BARAT DAYA ===
  'denpasarkota',
  'denpasar',
  'mataramkota',
  'kupangkota',
  'ambonkota',
  'ternatekota',
  'tidorekepulauankota',
  'sorong',
  'manokwari',
  // === extra regencies known to run ATCS-style portals ===
  'banjarkab',
  'jemberkab',
  'garutkab',
  'sidoarjokab',
  'banyumaskab',
  'banyuwangikab',
].filter(Boolean);

const seen = new Set();
const slugs = [
  ...new Set(
    DOMAINS.map((s) => String(s).trim().toLowerCase()).filter(
      (s) => s && !seen.has(s) && (seen.add(s), true),
    ),
  ),
];

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

async function get(url, timeoutMs = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'gods-eye-atcs-collector/1.0 (+readonly)' },
    });
    const text = await res.text();
    return { status: res.status, text };
  } catch (err) {
    return { status: 0, text: '', error: err.name };
  } finally {
    clearTimeout(timer);
  }
}

async function liveCheck(url) {
  const r = await get(url, LIVE_TIMEOUT_MS);
  if (r.status !== 200) return false;
  return r.text.includes('#EXTM3U') || r.text.includes('#EXT-X-STREAM-INF');
}

/** Banjar template: PHP modul endpoints. */
async function probeBanjarTemplate(domain) {
  const base = `https://atcs.${domain}.go.id`;
  const map = await get(`${base}/modul/get_data_map.php`);
  if (map.status !== 200) return null;
  let list;
  try {
    list = JSON.parse(map.text);
  } catch {
    return null;
  }
  if (!Array.isArray(list)) return null;
  const cameras = [];
  for (const c of list) {
    if (!c?.id) continue;
    const [lat, lon] = String(c.latlong || '')
      .split(',')
      .map((v) => parseFloat(v));
    const live = await get(
      `${base}/modul/get_data_live.php?id=${encodeURIComponent(c.id)}`,
    );
    let streamUrl = null;
    try {
      const d = JSON.parse(live.text);
      streamUrl = d?.url_link_1 || null;
    } catch {
      /* keep null */
    }
    const isLive = streamUrl ? await liveCheck(streamUrl) : false;
    cameras.push({
      id: `atcs-${domain}-${c.id}`,
      name: String(c.nama || c.nama_lokasi || `Camera ${c.id}`).trim(),
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
      city: domain,
      provider: 'atcs',
      type: 'traffic',
      source: base,
      streamUrl,
      live: isLive,
    });
  }
  return { template: 'banjar', cameras };
}

/** SPA template: NestJS/Vue style `/api`. */
async function probeSpaTemplate(domain) {
  const base = `https://atcs.${domain}.go.id`;
  const root = await get(`${base}/`);
  if (root.status !== 200) return null;

  // "atcs-suite" template: NestJS API with a public camera list.
  for (const ep of ['/api/public/cameras', '/api/public/cameras/wall']) {
    const r = await get(`${base}${ep}`);
    if (r.status !== 200) continue;
    let data;
    try {
      data = JSON.parse(r.text);
    } catch {
      continue;
    }
    if (!Array.isArray(data) || !data.length) continue;
    const cameras = await Promise.all(
      data.map(async (c, i) => {
        const lat = Number(c?.lat ?? c?.latitude);
        const lon = Number(c?.lng ?? c?.lon ?? c?.longitude);
        const streamUrl =
          c?.stream ?? c?.streamUrl ?? c?.hls ?? c?.url ?? c?.m3u8 ?? null;
        const posterUrl = c?.poster ?? c?.posterUrl ?? c?.thumbnail ?? null;
        return {
          id: `atcs-${domain}-${c?.code ?? c?.id ?? i}`,
          name: String(c?.name ?? c?.nama ?? `Camera ${i}`).trim(),
          lat: Number.isFinite(lat) ? lat : null,
          lon: Number.isFinite(lon) ? lon : null,
          city: domain,
          provider: 'atcs',
          type: 'traffic',
          source: `${base}${ep}`,
          streamUrl,
          posterUrl,
          live: streamUrl ? await liveCheck(streamUrl) : false,
        };
      }),
    );
    return { template: 'atcs-suite', cameras };
  }

  const hasVueAssets = /\/assets\/index-[\w-]+\.js/.test(root.text);
  if (!hasVueAssets && !root.text.includes('LiveApp')) return null;
  return { template: 'spa', cameras: [], note: 'no public camera route found' };
}

async function probeDomain(domain) {
  const entry = { domain, status: 'down', cameras: 0, live: 0, template: null };
  const root = await get(`https://atcs.${domain}.go.id/`);
  if (root.status !== 200) return entry;
  entry.status = 'up';
  const banjar = await probeBanjarTemplate(domain);
  if (banjar) {
    entry.template = banjar.template;
    entry.cameras = banjar.cameras.length;
    entry.live = banjar.cameras.filter((c) => c.live).length;
    entry.camerasList = banjar.cameras;
    return entry;
  }
  const spa = await probeSpaTemplate(domain);
  if (spa) {
    entry.template = spa.template;
    entry.cameras = spa.cameras.length;
    entry.live = spa.cameras.filter((c) => c.live).length;
    entry.camerasList = spa.cameras;
    entry.note = spa.note;
    return entry;
  }
  entry.status = 'up-no-template';
  return entry;
}

async function run() {
  if (PAPUA_ONLY) {
    log('--papua-only: skipping non-Papua slugs');
  }
  const targets = PAPUA_ONLY
    ? slugs.filter((s) =>
        /sorong|fakfak|kaimana|manokwari|tambrauw|maybrat|rajaampat|merauke|mappi|asmat|bowen|nabire|mimika|paniai|dogiyai|deiyai|intan|puncak|jayawijaya|lanny|mamberamo|nduga|bintang|tolikara|yahukimo|yalimo|biak|keerom|yapen|sarmi|supiori|waropen|jayapura/.test(
          s,
        ),
      )
    : slugs;

  log(`sweeping ${targets.length} domains (concurrency ${CONCURRENCY})...`);
  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < targets.length) {
      const domain = targets[cursor++];
      const entry = await probeDomain(domain);
      const mark =
        entry.status === 'up' && entry.cameras > 0
          ? `+${entry.cameras} cam (${entry.live} live)`
          : entry.status;
      log(`${domain.padEnd(28)} ${mark}`);
      results.push(entry);
    }
  });
  await Promise.all(workers);

  results.sort((a, b) => b.cameras - a.cameras);
  const up = results.filter((r) => r.status === 'up');
  const withCam = up.filter((r) => r.cameras > 0);
  const totalCameras = withCam.reduce((n, r) => n + r.cameras, 0);
  const totalLive = withCam.reduce((n, r) => n + r.live, 0);

  const payload = {
    sweptAt: new Date().toISOString(),
    papuaOnly: PAPUA_ONLY,
    domainsSwept: targets.length,
    domainsUp: up.length,
    portalsWithCameras: withCam.length,
    totalCameras,
    totalLive,
    cities: withCam.map((r) => ({
      domain: r.domain,
      template: r.template,
      cameras: r.cameras,
      live: r.live,
      camerasList: r.camerasList,
    })),
    portalsUpNoCamera: up
      .filter((r) => r.cameras === 0)
      .map((r) => ({ domain: r.domain, template: r.template, note: r.note })),
    downDomains: results
      .filter((r) => r.status === 'down')
      .map((r) => r.domain),
  };

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
  log('');
  log(`=== RESULT ===`);
  log(
    `domains up: ${up.length}/${targets.length} · portals with cameras: ${withCam.length}`,
  );
  log(`total cameras: ${totalCameras} · confirmed live HLS: ${totalLive}`);
  for (const c of payload.cities) {
    log(
      `  ${c.domain.padEnd(26)} ${String(c.cameras).padStart(3)} cam · ${String(c.live).padStart(3)} live · ${c.template}`,
    );
  }
  log(`cache written: ${OUT}`);
}

run().catch((err) => {
  log(`FAILED: ${err.stack || err}`);
  process.exit(1);
});
