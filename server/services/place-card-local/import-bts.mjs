/**
 * Import a BTS registry from data the operator or the community already has.
 *
 * Two inputs are supported, both written to the same JSON shape the app reads:
 *
 *   --ocid <cell_towers.csv>   OpenCellID export (CC BY-SA 4.0)
 *   --osm                      OpenStreetMap masts over Overpass (ODbL)
 *
 * OpenCellID gives one row per CELL, many cells per physical site. The importer
 * clusters rows that sit within `--merge-m` of each other into one site, so a
 * tower that serves three sectors becomes one entry with three cells — which is
 * exactly what trilateration needs.
 *
 * Nothing here runs by itself: the network call happens only when the operator
 * runs the command.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const DEFAULT_OUT = path.join(ROOT, 'src/data/place-card-results/bts-registry.json');

/** Papua, the area this console watches. Override with --bbox. */
export const PAPUA_BBOX = Object.freeze({
  south: -9.5,
  west: 130.0,
  north: 1.5,
  east: 141.5,
});

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/** OpenCellID radio names to the technology label the panel shows. */
export function normalizeTech(radio) {
  const value = String(radio || '').toUpperCase();
  if (value === 'LTE') return '4G';
  if (value === 'UMTS' || value === 'WCDMA' || value === 'HSPA') return '3G';
  if (value === 'GSM' || value === 'CDMA') return '2G';
  if (value === 'NR') return '5G';
  return value || 'unknown';
}

/**
 * The planning radius for a technology, used when the source gives none.
 * These are conservative: a rural 2G cell really can reach 35 km.
 */
export function defaultRangeKm(tech) {
  if (tech === '5G') return 1;
  if (tech === '4G') return 5;
  if (tech === '3G') return 10;
  return 35;
}

const R_M = 6371000;
function distanceMeters(lat1, lon1, lat2, lon2) {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function inBox(lat, lon, box) {
  return lat >= box.south && lat <= box.north && lon >= box.west && lon <= box.east;
}

/**
 * Parse an OpenCellID CSV export into cell rows.
 *
 * Columns: radio,mcc,net,area,cell,unit,lon,lat,range,samples,...
 * Rows with no coordinates, too few samples, or outside the box are dropped.
 */
export function parseOcidCsv(text, { bbox = PAPUA_BBOX, minSamples = 1 } = {}) {
  const lines = String(text || '').split(/\r?\n/);
  const rows = [];
  for (const line of lines) {
    if (!line || line.startsWith('radio')) continue;
    const parts = line.split(',');
    if (parts.length < 10) continue;
    const radio = parts[0];
    const mcc = Number(parts[1]);
    const net = Number(parts[2]);
    const area = Number(parts[3]);
    const cell = Number(parts[4]);
    const lon = Number(parts[6]);
    const lat = Number(parts[7]);
    const rangeM = Number(parts[8]);
    const samples = Number(parts[9]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat === 0 && lon === 0) continue;
    if (Number.isFinite(samples) && samples < minSamples) continue;
    if (!inBox(lat, lon, bbox)) continue;
    if (!Number.isFinite(mcc) || !Number.isFinite(net)) continue;
    rows.push({
      radio,
      tech: normalizeTech(radio),
      mcc,
      mnc: net,
      lac: Number.isFinite(area) ? area : 0,
      cellId: Number.isFinite(cell) ? cell : 0,
      lat,
      lon,
      rangeKm: Number.isFinite(rangeM) && rangeM > 0 ? rangeM / 1000 : null,
      samples: Number.isFinite(samples) ? samples : 0,
    });
  }
  return rows;
}

/**
 * Cluster cell rows into physical sites.
 *
 * A grid of `mergeM`-sized squares keeps this linear: each row is compared
 * only with the clusters in its own square and the eight around it.
 */
export function groupIntoSites(rows, { mergeM = 120 } = {}) {
  const stepLat = mergeM / 111_320;
  const stepLon = mergeM / (111_320 * Math.cos((0 * Math.PI) / 180) || 1);
  const grid = new Map();
  const sites = [];
  const keyOf = (lat, lon) =>
    `${Math.floor(lat / stepLat)}:${Math.floor(lon / stepLon)}`;

  for (const row of rows) {
    const key = keyOf(row.lat, row.lon);
    const near = [];
    const [gx, gy] = key.split(':').map(Number);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const bucket = grid.get(`${gx + dx}:${gy + dy}`);
        if (bucket) near.push(...bucket);
      }
    }
    const match = near.find(
      (site) =>
        site.mcc === row.mcc &&
        site.mnc === row.mnc &&
        distanceMeters(site.lat, site.lon, row.lat, row.lon) <= mergeM,
    );
    if (match) {
      match.cells.push({ lac: row.lac, cellId: row.cellId });
      match.rows.push(row);
      continue;
    }
    const site = {
      id: `bts-${row.mcc}-${row.mnc}-${row.lac}-${row.cellId}`,
      name: `${row.tech} ${row.mcc}-${row.mnc}`,
      lat: row.lat,
      lon: row.lon,
      tech: row.tech,
      rangeKm: row.rangeKm || defaultRangeKm(row.tech),
      cells: [{ lac: row.lac, cellId: row.cellId }],
      source: 'opencellid',
      mcc: row.mcc,
      mnc: row.mnc,
      rows: [row],
    };
    sites.push(site);
    const bucketKey = keyOf(row.lat, row.lon);
    if (!grid.has(bucketKey)) grid.set(bucketKey, []);
    grid.get(bucketKey).push(site);
  }

  for (const site of sites) {
    // The best-observed cell defines the site: it names it, and its technology
    // and range are the ones a coverage question should be answered with.
    const best = site.rows.reduce(
      (top, row) => (row.samples > (top?.samples ?? -1) ? row : top),
      null,
    );
    const techs = [...new Set(site.rows.map((row) => row.tech))];
    site.tech = best?.tech || site.tech;
    site.rangeKm = best?.rangeKm || defaultRangeKm(site.tech);
    site.techs = techs;
    site.samples = best?.samples ?? 0;
    site.name = `${site.tech} ${site.mcc}-${site.mnc} · ${site.samples} sampel`;
    delete site.rows;
  }
  return sites;
}

/** Read an Overpass answer for communication masts into sites. */
export function parseOsmElements(payload) {
  const elements = Array.isArray(payload?.elements) ? payload.elements : [];
  const sites = [];
  for (const element of elements) {
    const lat = Number(element?.lat ?? element?.center?.lat);
    const lon = Number(element?.lon ?? element?.center?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const tags = element.tags || {};
    const tech = /5g/i.test(tags['communication:5g'] || '')
      ? '5G'
      : /lte|4g/i.test(tags['communication:lte'] || tags['communication:4g'] || '')
        ? '4G'
        : /umts|3g/i.test(tags['communication:3g'] || '')
          ? '3G'
          : '2G';
    sites.push({
      id: `osm-${element.type}-${element.id}`,
      name: tags.name || tags.operator || `Mast ${element.id}`,
      lat,
      lon,
      tech,
      rangeKm: defaultRangeKm(tech),
      cells: [],
      source: 'openstreetmap',
      operator: tags.operator || null,
    });
  }
  return sites;
}

/** The registry document the app reads. */
export function toRegistry(sites, { source, bbox = PAPUA_BBOX } = {}) {
  return {
    source: source || 'imported',
    generatedAt: new Date().toISOString(),
    bbox,
    count: sites.length,
    cells: sites.reduce((sum, site) => sum + (site.cells?.length || 0), 0),
    sites,
  };
}

/** An Overpass query for communication masts inside a box. */
export function overpassQuery(box) {
  const bbox = `${box.south},${box.west},${box.north},${box.east}`;
  return `[out:json][timeout:180];
(
  node["man_made"="mast"]["tower:type"="communication"](${bbox});
  node["man_made"="tower"]["tower:type"="communication"](${bbox});
  way["man_made"="tower"]["tower:type"="communication"](${bbox});
);
out center tags;`;
}

function parseArgs(argv) {
  const args = { mergeM: 120, minSamples: 1, out: DEFAULT_OUT, bbox: PAPUA_BBOX };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--ocid' && argv[i + 1]) args.ocid = argv[++i];
    else if (flag === '--osm') args.osm = true;
    else if (flag === '--out' && argv[i + 1]) args.out = argv[++i];
    else if (flag === '--merge-m' && argv[i + 1]) args.mergeM = Number(argv[++i]);
    else if (flag === '--min-samples' && argv[i + 1]) args.minSamples = Number(argv[++i]);
    else if (flag === '--bbox' && argv[i + 1]) {
      const [south, west, north, east] = argv[++i].split(',').map(Number);
      if ([south, west, north, east].every(Number.isFinite)) {
        args.bbox = { south, west, north, east };
      }
    }
  }
  return args;
}

function writeRegistry(document, out) {
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(document, null, 2)}\n`);
  return document;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.ocid && !args.osm) {
    console.log('Usage:');
    console.log('  node import-bts.mjs --ocid cell_towers.csv [--merge-m 120] [--min-samples 5]');
    console.log('  node import-bts.mjs --osm [--bbox south,west,north,east]');
    console.log('');
    console.log('OpenCellID export: https://opencellid.org/downloads.php (API token required)');
    console.log('Attribution: OpenCelliD, CC BY-SA 4.0 · OSM data © OpenStreetMap, ODbL');
    return;
  }

  let sites = [];
  let source = 'imported';
  if (args.ocid) {
    const text = readFileSync(args.ocid, 'utf8');
    const rows = parseOcidCsv(text, { bbox: args.bbox, minSamples: args.minSamples });
    sites = groupIntoSites(rows, { mergeM: args.mergeM });
    source = `opencellid:${path.basename(args.ocid)}`;
    console.log(`OpenCellID: ${rows.length} cell rows -> ${sites.length} sites`);
  } else {
    const response = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: overpassQuery(args.bbox),
    });
    if (!response.ok) throw new Error(`Overpass answered ${response.status}`);
    sites = parseOsmElements(await response.json());
    source = 'openstreetmap:overpass';
    console.log(`OpenStreetMap: ${sites.length} masts`);
  }

  const document = writeRegistry(toRegistry(sites, { source, bbox: args.bbox }), args.out);
  console.log(`Wrote ${document.count} sites (${document.cells} cells) to ${args.out}`);
}

if (process.argv[1] && process.argv[1].endsWith('import-bts.mjs')) {
  main().catch((error) => {
    console.error('Import failed:', error?.message || error);
    process.exitCode = 1;
  });
}
