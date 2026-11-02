/**
 * Build a real BTS registry for the whole of Papua from OpenCellID.
 *
 * Two facts about the API decide the shape of this file, and the first version
 * of it got both wrong until a real token was tried:
 *
 *   1. `getInArea` refuses any box larger than **4,000,000 m²** — about
 *      2 km × 2 km. A province cannot be swept with it; a neighbourhood can.
 *   2. The bulk data comes from the **download page**, not the API: a country
 *      export (Indonesia = MCC 510, ~1 MB gzipped) holds every cell observed in
 *      the last 18 months and costs no API credits at all.
 *
 * So there are two sources, used for what each is good at:
 *
 *   `--download` (default)  country CSV → filter to Papua → sites
 *   `--api-probe`           small boxes around towns → cells the export lacks
 *
 * The probe is budgeted (1,000 credits a day) and resumable, because a box the
 * export missed is worth one credit and there are only so many per day.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import {
  groupIntoSites,
  PAPUA_BBOX,
  parseOcidCsv,
  toRegistry,
} from './import-bts.mjs';
import { BTS_SEED, distanceKm } from './bts-registry.mjs';
import { getCarrier } from './cell-tower.mjs';
import {
  cellsInArea,
  isAuthError,
  isInputError,
  isQuotaError,
  OCID_ATTRIBUTION,
  OCID_BASE,
  OCID_DAILY_CREDITS,
  OCID_MAX_LIMIT,
} from './opencellid.mjs';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
export const DEFAULT_OUT = path.join(
  ROOT,
  'src/data/place-card-results/bts-registry.json',
);
export const DEFAULT_STATE = path.join(ROOT, '.gev-cache/bts-papua-state.json');
export const CACHE_DIR = path.join(ROOT, '.gev-cache/ocid');
export const DEFAULT_BUDGET = 900;

/** The documented ceiling for one `getInArea` call, in square metres. */
export const MAX_BOX_M2 = 4_000_000;

/** Kilometres per degree of latitude, near enough for a box test. */
const KM_PER_DEG = 111.32;

/** Area of a box in square kilometres, at its own latitude. */
export function boxAreaKm2(box) {
  const midLat = ((box.south + box.north) / 2) * (Math.PI / 180);
  const height = Math.abs(box.north - box.south) * KM_PER_DEG;
  const width = Math.abs(box.east - box.west) * KM_PER_DEG * Math.cos(midLat);
  return height * width;
}

/** Whether a box is small enough for the API to accept it. */
export function boxFits(box, maxM2 = MAX_BOX_M2) {
  return boxAreaKm2(box) * 1_000_000 <= maxM2;
}

/**
 * A grid of API-sized boxes around one centre.
 *
 * `radiusKm` is how far from the centre to look; the grid is square and sized
 * to cover that radius in every direction. Each box is checked against the
 * 4 km² ceiling before it is ever sent.
 */
export function probeBoxes(centre, { radiusKm = 4, boxKm = 1.8 } = {}) {
  const spanKm = Math.max(0, radiusKm) * 2;
  const count = Math.max(1, Math.ceil(spanKm / boxKm));
  const stepLat = boxKm / KM_PER_DEG;
  const stepLon = boxKm / (KM_PER_DEG * Math.cos((centre.lat * Math.PI) / 180));
  const startLat = centre.lat - (count * stepLat) / 2;
  const startLon = centre.lon - (count * stepLon) / 2;
  const boxes = [];
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      const south = startLat + row * stepLat;
      const west = startLon + col * stepLon;
      const box = {
        // The identity of a box is the ground it covers, so the id is its
        // south-west corner and nothing else. Keying on the centre as well
        // meant re-probing the same square from a second town (or from
        // `--centre`) was billed again — a 49-credit repeat of ground the
        // state file already had.
        id: `${south.toFixed(4)},${west.toFixed(4)}`,
        label: centre.label || centre.id,
        south: Number(south.toFixed(5)),
        west: Number(west.toFixed(5)),
        north: Number((south + stepLat).toFixed(5)),
        east: Number((west + stepLon).toFixed(5)),
      };
      if (boxFits(box)) boxes.push(box);
    }
  }
  return boxes;
}

/** The default probe targets: every regency capital this console already watches. */
export function defaultCentres() {
  return BTS_SEED.map((site) => ({
    id: site.id,
    label: site.name,
    lat: site.lat,
    lon: site.lon,
  }));
}

/** Read the resumable state; a missing or broken file starts a fresh run. */
export const STATE_VERSION = 2;

/**
 * The coordinate part of a state key.
 *
 * Older runs keyed a box as `<centre>:<south>,<west>`. The centre carried no
 * information about the ground, and it made the same square look new whenever
 * it was reached from a different town, so the key is now coordinates only.
 * Normalising on load keeps the credits already spent: every old mark still
 * matches the box it was paid for.
 * @param {string} key
 * @returns {string}
 */
export function normalizeBoxKey(key) {
  const text = String(key ?? '');
  const cut = text.lastIndexOf(':');
  return cut >= 0 ? text.slice(cut + 1) : text;
}

/**
 * Re-key a state's boxes by coordinates, keeping the strongest mark when two
 * legacy keys collapse onto the same square.
 * @param {object} boxes
 * @returns {object}
 */
export function normalizeBoxes(boxes) {
  if (!boxes || typeof boxes !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(boxes)) {
    const id = normalizeBoxKey(key);
    const previous = out[id];
    out[id] = previous?.done ? previous : value;
  }
  return out;
}

export function loadState(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    // A state file written by a different grid scheme would mark boxes done
    // that were never asked about.
    if (parsed?.version !== STATE_VERSION) {
      return {
        boxes: {},
        requests: 0,
        cells: 0,
        probe: null,
        updatedAt: null,
        startedAt: null,
      };
    }
    return {
      boxes: normalizeBoxes(parsed?.boxes),
      requests: Number(parsed?.requests) || 0,
      cells: Number(parsed?.cells) || 0,
      probe: parsed?.probe || null,
      updatedAt: parsed?.updatedAt || null,
      startedAt: parsed?.startedAt || null,
    };
  } catch {
    return {
      boxes: {},
      requests: 0,
      cells: 0,
      probe: null,
      updatedAt: null,
      startedAt: null,
    };
  }
}

export function saveState(file, state) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    `${JSON.stringify({ ...state, version: STATE_VERSION, updatedAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

/**
 * The tokenised country export URL.
 *
 * The download page is a form: POST the token, and the answer lists the files
 * with the token already baked into each link. Scraping it is the only
 * documented way in, and it keeps the token out of this file's arguments.
 */
export async function resolveDownloadUrl({
  token,
  mcc = 510,
  fetchImpl = null,
  timeoutMs = 30_000,
} = {}) {
  if (!token) return { ok: false, error: 'token_required' };
  const impl = fetchImpl || globalThis.fetch;
  if (typeof impl !== 'function')
    return { ok: false, error: 'fetch_unavailable' };
  const body = new URLSearchParams({ token });
  try {
    const response = await impl(`${OCID_BASE}/downloads.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout?.(timeoutMs),
    });
    if (!response.ok) {
      return { ok: false, error: `downloads_page_${response.status}` };
    }
    const html = await response.text();
    const wanted = new RegExp(
      `href="([^"]*type=mcc[^"]*file=${mcc}\\.csv\\.gz)"`,
      'i',
    );
    const match = wanted.exec(html);
    if (!match) return { ok: false, error: 'country_export_missing', mcc };
    const url = match[1]
      .replace(/&amp;/g, '&')
      .replace(/^https?:\/\/[^/]+/, OCID_BASE);
    return { ok: true, url, mcc };
  } catch (error) {
    return {
      ok: false,
      error: 'network_error',
      detail: error?.message || null,
    };
  }
}

/** Download one country export into the cache, unless a fresh copy is there. */
export async function downloadCountryFile({
  token,
  mcc = 510,
  out = path.join(CACHE_DIR, `${mcc}.csv.gz`),
  fetchImpl = null,
  refresh = false,
  maxAgeMs = 12 * 3600 * 1000,
} = {}) {
  if (!refresh) {
    try {
      const info = await stat(out);
      if (info.size > 0 && Date.now() - info.mtimeMs < maxAgeMs) {
        return { ok: true, path: out, bytes: info.size, cached: true };
      }
    } catch {
      /* no cache yet */
    }
  }
  const resolved = await resolveDownloadUrl({ token, mcc, fetchImpl });
  if (!resolved.ok) return resolved;
  const impl = fetchImpl || globalThis.fetch;
  const response = await impl(resolved.url);
  if (!response.ok) return { ok: false, error: `download_${response.status}` };
  const buffer = Buffer.from(await response.arrayBuffer());
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, buffer);
  return { ok: true, path: out, bytes: buffer.length, cached: false };
}

/** The CSV text inside a `.gz` (or a plain CSV) file. */
export function readExportText(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const isGzip = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  return isGzip ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8');
}

/**
 * Probe boxes one at a time, stopping at the budget.
 *
 * A box that fails for a reason other than the key is recorded but not marked
 * done, so the next run tries it again. A rejected key stops everything: the
 * remaining boxes would fail identically and spend a credit each.
 */
export async function collectCellsByProbe({
  key,
  boxes = [],
  budget = DEFAULT_BUDGET,
  state = { boxes: {}, requests: 0, cells: 0 },
  fetchImpl = null,
  onBox = null,
  log = () => {},
} = {}) {
  if (!key) return { ok: false, error: 'key_required', cells: [], requests: 0 };
  const collected = [];
  let requests = 0;
  // What previous runs already spent; the state carries the running total.
  const requestsBefore = Number(state.requests) || 0;
  let stopped = null;
  let visited = 0;

  for (const box of boxes) {
    if (stopped) break;
    if (state.boxes[box.id]?.done) continue;
    if (requests + 1 > budget) {
      stopped = 'budget';
      break;
    }
    visited += 1;
    let offset = 0;
    let total = null;
    let fetched = 0;
    let exhausted = false;

    for (;;) {
      if (requests + 1 > budget) {
        exhausted = true;
        stopped = 'budget';
        break;
      }
      const page = await cellsInArea({
        key,
        bbox: box,
        limit: OCID_MAX_LIMIT,
        offset,
        fetchImpl,
      });
      requests += 1;
      if (!page.ok) {
        // Quota first: the message names the key, but the key is fine.
        if (isQuotaError(page)) {
          stopped = 'quota_exceeded';
        } else if (page.error === 'key_required' || isAuthError(page)) {
          stopped = isAuthError(page) ? 'invalid_key' : page.error;
        } else if (isInputError(page)) {
          // Every further box would fail the same way: this is a bug in the
          // grid, not a fact about the area.
          stopped = 'input_rejected';
          log(`box ${box.id} rejected: ${page.error}`);
        } else {
          log(`box ${box.id}: ${page.error}`);
          state.boxes[box.id] = {
            ...(state.boxes[box.id] || {}),
            error: page.error,
            at: new Date().toISOString(),
          };
        }
        break;
      }
      total = Number.isFinite(page.total) ? page.total : page.cells.length;
      collected.push(...page.cells);
      fetched += page.cells.length;
      if (!page.hasMore) break;
      offset = page.nextOffset;
    }

    if (stopped) break;
    state.boxes[box.id] = {
      done: !exhausted,
      count: total ?? fetched,
      fetched,
      at: new Date().toISOString(),
    };
    // Credits are cumulative across runs: a second sweep must not reset the
    // counter to that sweep's spend, or the registry reports a budget it never
    // had. `requests` is this run's running total, so adding it to the value
    // read at the start stays idempotent while the loop writes state per box.
    state.requests = requestsBefore + requests;
    state.cells = (state.cells || 0) + fetched;
    if (fetched) log(`box ${box.id}: ${fetched}/${total ?? '?'} cells`);
    onBox?.({ box, state, requests, cells: fetched });
  }

  return {
    ok: true,
    cells: collected,
    requests,
    boxes: boxes.length,
    visited,
    stopped,
    pending: boxes.filter((box) => !state.boxes[box.id]?.done).length,
  };
}

/** Deduplicate cells by their network identity; the last record wins. */
export function dedupeCells(cells = []) {
  const byKey = new Map();
  for (const cell of cells) {
    if (!cell) continue;
    byKey.set(`${cell.mcc}-${cell.mnc}-${cell.lac}-${cell.cellId}`, cell);
  }
  return [...byKey.values()];
}

/**
 * Rebuild the site list from every cell both sources know.
 *
 * Merging at the *site* level would keep two entries for one mast whenever the
 * export and the API saw different cells of it — they are different keys, so
 * they never match. Merging at the *cell* level and re-clustering is the only
 * version that converges: one tower, one entry, every cell it serves.
 *
 * Sites with no cells at all (an OSM mast, a field survey) cannot be
 * re-clustered and are passed through untouched.
 */
export function rebuildSites(
  existing = [],
  incomingCells = [],
  { mergeM = 120 } = {},
) {
  const passthrough = existing.filter((site) => !(site.cells || []).length);
  const existingCells = existing.flatMap((site) =>
    (site.cells || []).map((cell) => ({
      mcc: site.mcc,
      mnc: site.mnc,
      lac: cell.lac,
      cellId: cell.cellId,
      lat: site.lat,
      lon: site.lon,
      rangeKm: site.rangeKm,
      tech: site.tech,
      radio: site.tech,
      samples: site.samples ?? 0,
    })),
  );
  const sites = cellsToSites([...existingCells, ...incomingCells], { mergeM });
  return [...sites, ...passthrough];
}

/** The place names a site can borrow, from the regency capitals this console knows. */
const PLACES = BTS_SEED.map((site) => ({
  name: site.name,
  lat: site.lat,
  lon: site.lon,
}));

/**
 * A human name for a site: the nearest town it serves, then the operator.
 *
 * `4G 510-10 · 26 sampel` says nothing an operator can use; `Sentani ·
 * Telkomsel 4G` says where and who. Beyond 60 km no town name is honest, so
 * the coordinates are shown instead.
 */
export function siteLabel(site, places = PLACES) {
  const carrier =
    getCarrier(site.mcc, site.mnc)?.name || `MCC ${site.mcc}-${site.mnc}`;
  const tech = site.tech ? ` ${site.tech}` : '';
  let nearest = null;
  for (const place of places) {
    const distance = distanceKm(site.lat, site.lon, place.lat, place.lon);
    if (!nearest || distance < nearest.distance)
      nearest = { ...place, distance };
  }
  const where =
    nearest && nearest.distance <= 60
      ? nearest.name
      : `${site.lat.toFixed(3)}, ${site.lon.toFixed(3)}`;
  return `${where} · ${carrier}${tech}`;
}

/** Apply the human name to every site that came from OpenCellID. */
export function nameSites(sites = [], places = PLACES) {
  return sites.map((site) =>
    site.source === 'opencellid'
      ? { ...site, name: siteLabel(site, places) }
      : site,
  );
}

/** Turn raw OpenCellID records into registry sites. */
export function cellsToSites(cells, { mergeM = 120 } = {}) {
  const rows = dedupeCells(cells).map((cell) => ({
    radio: cell.radio,
    tech: cell.tech,
    mcc: cell.mcc,
    mnc: cell.mnc,
    lac: cell.lac,
    cellId: cell.cellId,
    lat: cell.lat,
    lon: cell.lon,
    rangeKm: cell.rangeKm,
    samples: cell.samples,
  }));
  return groupIntoSites(rows, { mergeM });
}

/** Turn a country export into sites inside Papua. */
export function sitesFromExport(
  text,
  { bbox = PAPUA_BBOX, mergeM = 120, minSamples = 1 } = {},
) {
  const rows = parseOcidCsv(text, { bbox, minSamples });
  return { rows: rows.length, sites: groupIntoSites(rows, { mergeM }) };
}

function parseArgs(argv) {
  const args = {
    out: DEFAULT_OUT,
    state: DEFAULT_STATE,
    budget: DEFAULT_BUDGET,
    bbox: PAPUA_BBOX,
    mergeM: 120,
    mcc: 510,
    radiusKm: 4,
    boxKm: 1.8,
    dryRun: false,
    download: false,
    apiProbe: false,
    refresh: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--token' && argv[i + 1]) args.token = argv[++i];
    else if (flag === '--out' && argv[i + 1]) args.out = argv[++i];
    else if (flag === '--state' && argv[i + 1]) args.state = argv[++i];
    else if (flag === '--budget' && argv[i + 1])
      args.budget = Number(argv[++i]);
    else if (flag === '--mcc' && argv[i + 1]) args.mcc = Number(argv[++i]);
    else if (flag === '--merge-m' && argv[i + 1])
      args.mergeM = Number(argv[++i]);
    else if (flag === '--centre' && argv[i + 1]) {
      const [lat, lon] = argv[++i].split(',').map(Number);
      if (Number.isFinite(lat) && Number.isFinite(lon))
        args.centre = { lat, lon };
    } else if (flag === '--label' && argv[i + 1]) args.label = argv[++i];
    else if (flag === '--radius-km' && argv[i + 1])
      args.radiusKm = Number(argv[++i]);
    else if (flag === '--box-km' && argv[i + 1]) args.boxKm = Number(argv[++i]);
    else if (flag === '--bbox' && argv[i + 1]) {
      const [south, west, north, east] = argv[++i].split(',').map(Number);
      if ([south, west, north, east].every(Number.isFinite)) {
        args.bbox = { south, west, north, east };
      }
    } else if (flag === '--download') args.download = true;
    else if (flag === '--api-probe') args.apiProbe = true;
    else if (flag === '--refresh') args.refresh = true;
    else if (flag === '--dry-run') args.dryRun = true;
  }
  // The download is the cheap path and the one that actually covers Papua, so
  // it is what a bare command does.
  if (!args.download && !args.apiProbe) args.download = true;
  return args;
}

function readExisting(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(parsed?.sites) ? parsed.sites : [];
  } catch {
    return [];
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = String(
    args.token || process.env.OPENCELLID_API_KEY || '',
  ).trim();

  if (args.dryRun) {
    const probe = args.apiProbe
      ? (args.centre ? [args.centre] : defaultCentres()).reduce(
          (sum, centre) =>
            sum +
            probeBoxes(centre, { radiusKm: args.radiusKm, boxKm: args.boxKm })
              .length,
          0,
        )
      : 0;
    console.log('Papua build plan');
    console.log(`  source A : country export MCC ${args.mcc} (no API credits)`);
    console.log(
      `  source B : API probe ${probe} boxes of ~${args.boxKm} km (1 credit each)`,
    );
    console.log(`  budget   : ${args.budget} of ${OCID_DAILY_CREDITS} credits`);
    console.log(
      `  box limit: ${MAX_BOX_M2 / 1e6} km² per getInArea call (API rule)`,
    );
    console.log(`  output   : ${args.out}`);
    return 0;
  }

  if (!token) {
    console.error('No OpenCellID token.');
    console.error('  Set OPENCELLID_API_KEY in .env, or pass --token <token>.');
    console.error(
      '  Token: https://opencellid.org/ -> account -> API access token',
    );
    console.error(
      '  Keyless alternative: node import-bts.mjs --osm (OSM masts, no cell ids)',
    );
    return 2;
  }

  const collectedCells = [];
  const provenance = [];
  const state = loadState(args.state);
  state.startedAt = state.startedAt || new Date().toISOString();

  if (args.download) {
    const file = await downloadCountryFile({
      token,
      mcc: args.mcc,
      refresh: args.refresh,
    });
    if (!file.ok) {
      console.error(`Country export failed: ${file.error}`);
      return 1;
    }
    console.log(
      `Country export MCC ${args.mcc}: ${Math.round(file.bytes / 1024)} KB ` +
        `(${file.cached ? 'cached' : 'downloaded'})`,
    );
    const text = readExportText(await readFile(file.path));
    const { rows, sites } = sitesFromExport(text, {
      bbox: args.bbox,
      mergeM: args.mergeM,
    });
    console.log(`  ${rows} cell rows inside Papua -> ${sites.length} sites`);
    collectedCells.push(
      ...sites.flatMap((site) =>
        (site.cells || []).map((cell) => ({
          mcc: site.mcc,
          mnc: site.mnc,
          lac: cell.lac,
          cellId: cell.cellId,
          lat: site.lat,
          lon: site.lon,
          rangeKm: site.rangeKm,
          tech: site.tech,
          radio: site.tech,
          samples: site.samples,
        })),
      ),
    );
    provenance.push(`opencellid:mcc${args.mcc}:export`);
  }

  if (args.apiProbe) {
    // A named centre probes one place properly; without one, the probe takes
    // the town cores, where the export is most likely to be thin.
    const targets = args.centre
      ? [
          {
            id: 'custom',
            label: args.label || `${args.centre.lat},${args.centre.lon}`,
            lat: args.centre.lat,
            lon: args.centre.lon,
          },
        ]
      : defaultCentres();
    const allBoxes = targets.flatMap((centre) =>
      probeBoxes(centre, { radiusKm: args.radiusKm, boxKm: args.boxKm }),
    );
    console.log(
      `API probe: ${targets.length} ${args.centre ? 'centre' : 'towns'}, ` +
        `${allBoxes.length} boxes of ~${args.boxKm} km, budget ${args.budget}`,
    );
    const result = await collectCellsByProbe({
      key: token,
      boxes: allBoxes,
      budget: args.budget,
      state,
      log: (line) => console.log(line),
      onBox: () => saveState(args.state, state),
    });
    saveState(args.state, state);
    if (!result.ok) {
      console.error(`Probe failed: ${result.error}`);
      return 1;
    }
    if (result.stopped === 'invalid_key') {
      console.error('OpenCellID rejected the token. Nothing was written.');
      return 1;
    }
    if (result.stopped === 'input_rejected') {
      console.error(
        'OpenCellID rejected a box: the grid is wrong, not the data.',
      );
      return 1;
    }
    if (result.stopped === 'quota_exceeded') {
      console.error(
        "Today's 1,000-credit quota is gone. Run again tomorrow to continue.",
      );
    }
    console.log(
      `  ${result.cells.length} cells from ${result.requests} credits` +
        (result.stopped ? ` (stopped: ${result.stopped})` : ''),
    );
    collectedCells.push(...result.cells);
    provenance.push('opencellid:api-probe');
    state.probe = {
      boxes: allBoxes.length,
      pending: result.pending,
      requests: result.requests,
      at: new Date().toISOString(),
    };
  }

  const merged = nameSites(
    rebuildSites(readExisting(args.out), collectedCells, {
      mergeM: args.mergeM,
    }),
  );
  const document = toRegistry(merged, {
    source: provenance.join('+'),
    bbox: args.bbox,
  });
  document.attribution = OCID_ATTRIBUTION;
  document.credits = {
    used: state.requests || 0,
    budget: args.budget,
    daily: OCID_DAILY_CREDITS,
    boxesPending: state.probe?.pending ?? 0,
  };
  document.generatedAt = new Date().toISOString();
  mkdirSync(path.dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(document, null, 2)}\n`);

  console.log(
    `Wrote ${document.count} sites (${document.cells} cells) to ${args.out}`,
  );
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('fetch-bts-papua.mjs')) {
  main()
    .then((code) => {
      if (code) process.exitCode = code;
    })
    .catch((error) => {
      console.error('Fetch failed:', error?.message || error);
      process.exitCode = 1;
    });
}
