/**
 * Cell Tower Tracker — OpenCellID based location lookup.
 * 
 * Free, no API key needed for basic queries.
 * Database: https://opencellid.org (3.4M+ towers)
 * 
 * Usage:
 *   node cell-tower.mjs --mcc 510 --mnc 10 --lac 12345 --cellid 456789
 *   node cell-tower.mjs --phone "+62-812-3456-7890"  # Needs cell info
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_URL = 'https://opencellid.org/cell/get';
const CACHE_DIR = resolve(__dirname, '../../../src/data/place-card-results');
const CACHE_FILE = resolve(CACHE_DIR, 'cell-tower-cache.json');

// Default Indonesia carriers (MCC 510)
const INDONESIA_CARRIERS = {
  '510-01': { name: 'Telkomsel', mcc: 510, mnc: 1 },
  '510-10': { name: 'Telkomsel', mcc: 510, mnc: 10 },
  '510-11': { name: 'Telkomsel', mcc: 510, mnc: 11 },
  '510-20': { name: 'Indosat', mcc: 510, mnc: 20 },
  '510-21': { name: 'Indosat', mcc: 510, mnc: 21 },
  '510-28': { name: 'Smartfren', mcc: 510, mnc: 28 },
  '510-30': { name: 'XL Axiata', mcc: 510, mnc: 30 },
  '510-31': { name: 'XL Axiata', mcc: 510, mnc: 31 },
  '510-41': { name: '3 (Three)', mcc: 510, mnc: 41 },
  '510-99': { name: 'Axis', mcc: 510, mnc: 99 },
};

// Papua region (rough bounding box)
const PAPUA_BOUNDS = {
  latMin: -9.5, latMax: 1.5,
  lonMin: 130.0, lonMax: 141.5
};

/**
 * The service regions a carrier's cells are placed in, when the cell is not in
 * the database.
 *
 * A carrier is not one city. Telkomsel alone serves every province, so pinning
 * its cells to Jayapura made every estimate for that carrier land in one spot.
 * Each carrier therefore carries its own region list — Papua first, because
 * that is what this console watches, then its national footprint — and the
 * LAC picks the region. Cells that share a LAC share an area, which is what a
 * location area is for.
 *
 * This is a LOCAL HEURISTIC table, not carrier data: it exists so an estimate
 * is at least in the right part of the country and is replaceable with a real
 * LAC table the moment one is available.
 */
const CARRIER_REGIONS = {
  '510-01': [
    { name: 'Jayapura', lat: -2.5337, lon: 140.7175 },
    { name: 'Timika', lat: -4.5461, lon: 136.8876 },
    { name: 'Merauke', lat: -8.4932, lon: 140.4018 },
    { name: 'Nabire', lat: -3.3667, lon: 135.4833 },
    { name: 'Biak', lat: -1.1833, lon: 136.0833 },
    { name: 'Sorong', lat: -0.8763, lon: 131.2558 },
    { name: 'Manokwari', lat: -0.8615, lon: 134.0620 },
    { name: 'Wamena', lat: -4.1000, lon: 138.9500 },
    { name: 'Puncak Jaya', lat: -3.6167, lon: 137.4833 },
    { name: 'Tolikara', lat: -3.6833, lon: 138.4833 },
    { name: 'Yahukimo', lat: -4.4833, lon: 139.5333 },
    { name: 'Jakarta', lat: -6.2088, lon: 106.8456 },
    { name: 'Surabaya', lat: -7.2575, lon: 112.7521 },
    { name: 'Medan', lat: 3.5952, lon: 98.6722 },
    { name: 'Makassar', lat: -5.1477, lon: 119.4327 },
    { name: 'Denpasar', lat: -8.6705, lon: 115.2126 },
  ],
  '510-20': [
    { name: 'Sorong', lat: -0.8763, lon: 131.2558 },
    { name: 'Manokwari', lat: -0.8615, lon: 134.0620 },
    { name: 'Jayapura', lat: -2.5337, lon: 140.7175 },
    { name: 'Biak', lat: -1.1833, lon: 136.0833 },
    { name: 'Jakarta', lat: -6.2088, lon: 106.8456 },
    { name: 'Bandung', lat: -6.9175, lon: 107.6191 },
    { name: 'Semarang', lat: -6.9932, lon: 110.4203 },
  ],
  '510-28': [
    { name: 'Manokwari', lat: -0.8615, lon: 134.0620 },
    { name: 'Sorong', lat: -0.8763, lon: 131.2558 },
    { name: 'Jakarta', lat: -6.2088, lon: 106.8456 },
    { name: 'Surabaya', lat: -7.2575, lon: 112.7521 },
  ],
  '510-30': [
    { name: 'Timika', lat: -4.5461, lon: 136.8876 },
    { name: 'Jayapura', lat: -2.5337, lon: 140.7175 },
    { name: 'Merauke', lat: -8.4932, lon: 140.4018 },
    { name: 'Jakarta', lat: -6.2088, lon: 106.8456 },
    { name: 'Surabaya', lat: -7.2575, lon: 112.7521 },
    { name: 'Yogyakarta', lat: -7.7956, lon: 110.3695 },
  ],
  '510-41': [
    { name: 'Merauke', lat: -8.4932, lon: 140.4018 },
    { name: 'Jayapura', lat: -2.5337, lon: 140.7175 },
    { name: 'Jakarta', lat: -6.2088, lon: 106.8456 },
    { name: 'Medan', lat: 3.5952, lon: 98.6722 },
  ],
  '510-99': [
    { name: 'Wamena', lat: -4.1000, lon: 138.9500 },
    { name: 'Nabire', lat: -3.3667, lon: 135.4833 },
    { name: 'Jakarta', lat: -6.2088, lon: 106.8456 },
    { name: 'Bandung', lat: -6.9175, lon: 107.6191 },
  ],
};
const PAPUA_CENTRE = { name: 'Papua', lat: -4.0, lon: 138.0 };
const ESTIMATE_SPREAD_DEG = 0.15; // ≈ 16 km, about the reach of one cell
const ESTIMATE_ACCURACY_M = 20000;
/** Bump when the estimate changes shape, so old entries stop being served. */
const CELL_CACHE_VERSION = 2;

// One operator, several MNCs: Telkomsel is 01/10/11, Indosat 20/21, XL 30/31.
CARRIER_REGIONS['510-10'] = CARRIER_REGIONS['510-01'];
CARRIER_REGIONS['510-11'] = CARRIER_REGIONS['510-01'];
CARRIER_REGIONS['510-21'] = CARRIER_REGIONS['510-20'];
CARRIER_REGIONS['510-31'] = CARRIER_REGIONS['510-30'];

/**
 * The region a cell belongs to: the LAC picks from the carrier's own list, so
 * cells of one location area stay together and different areas spread out.
 */
function regionFor(mcc, mnc, lac) {
  const regions = CARRIER_REGIONS[`${mcc}-${mnc}`];
  if (!regions || !regions.length) return PAPUA_CENTRE;
  const index = Math.abs(Math.trunc(Number(lac) || 0)) % regions.length;
  return regions[index];
}

/**
 * Get carrier info from MNC
 */
function getCarrier(mcc, mnc) {
  const key = `${mcc}-${mnc}`;
  if (INDONESIA_CARRIERS[key]) return INDONESIA_CARRIERS[key];
  
  // Generic fallback
  return { name: `Carrier ${mcc}-${mnc}`, mcc, mnc };
}

/**
 * Check if location is in Papua
 */
function isInPapua(lat, lon) {
  return lat >= PAPUA_BOUNDS.latMin && lat <= PAPUA_BOUNDS.latMax &&
         lon >= PAPUA_BOUNDS.lonMin && lon <= PAPUA_BOUNDS.lonMax;
}

/**
 * Load cache
 */
function loadCache() {
  try {
    if (existsSync(CACHE_FILE)) {
      return JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('[CACHE] Load error:', e.message);
  }
  return {};
}

/**
 * Save cache
 */
function saveCache(cache) {
  try {
    mkdirSync(dirname(CACHE_FILE), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.error('[CACHE] Save error:', e.message);
  }
}

/**
 * Lookup cell tower via OpenCellID
 * Note: Requires API key for live lookup, but we can use their free tile service
 */
export async function lookupCell(mcc, mnc, lac, cellId, apiKey = '') {
  const cache = loadCache();
  // The version is part of the key: an estimate written by an older estimator
  // must not survive a change to how estimates are made.
  const cacheKey = `cell:v${CELL_CACHE_VERSION}:${mcc}:${mnc}:${lac}:${cellId}`;
  
  // Check cache first (7 day TTL for cell towers - they don't move)
  if (cache[cacheKey] && cache[cacheKey].timestamp > Date.now() - 7 * 86400000) {
    console.log(`[CACHE] Cell ${cellId} -> ${cache[cacheKey].lat},${cache[cacheKey].lon}`);
    return { ...cache[cacheKey], source: 'cache' };
  }
  
  // Try OpenCellID API (needs key for proper query)
  if (apiKey) {
    try {
      console.log(`[API] Querying OpenCellID for cell ${cellId}...`);
      const url = `https://opencellid.org/cell/get?key=${apiKey}&mcc=${mcc}&mnc=${mnc}&lac=${lac}&cellid=${cellId}&format=json`;
      const res = await fetch(url);
      const text = await res.text();
      console.log(`[API] Response status: ${res.status}, body: ${text.substring(0, 200)}`);
      
      if (res.ok) {
        const data = JSON.parse(text);
        
        if (data.status === 'ok' && data.lat && data.lon) {
          const result = {
            lat: parseFloat(data.lat),
            lon: parseFloat(data.lon),
            accuracy: parseInt(data.range) || 1000,
            mcc: data.mcc,
            mnc: data.mnc,
            lac: data.lac,
            cellId: data.cellid,
            carrier: getCarrier(data.mcc, data.mnc),
            isPapua: isInPapua(parseFloat(data.lat), parseFloat(data.lon)),
            timestamp: Date.now()
          };
          
          cache[cacheKey] = result;
          saveCache(cache);
          
          console.log(`[OK] Cell ${cellId} -> ${result.lat},${result.lon} (${result.carrier.name})`);
          return result;
        }
      }
    } catch (e) {
      console.error('[API] Error:', e.message);
    }
  }
  
  // Fallback: estimate inside the carrier's region for this LAC (mock data).
  // In real use, user needs to provide cell info from target device
  console.log('[FALLBACK] Estimating inside the carrier region');

  const seed = parseInt(cellId) || 0;
  const anchor = regionFor(mcc, mnc, lac);
  // The offset is derived from the seed, never random: an estimate that moved
  // on every cache miss would read as movement that never happened.
  const dLat = (((seed % 41) - 20) / 20) * ESTIMATE_SPREAD_DEG;
  const dLon = ((((seed * 7) % 41) - 20) / 20) * ESTIMATE_SPREAD_DEG;

  const result = {
    lat: anchor.lat + dLat,
    lon: anchor.lon + dLon,
    accuracy: ESTIMATE_ACCURACY_M,
    mcc, mnc, lac, cellId,
    carrier: getCarrier(mcc, mnc),
    region: anchor.name,
    isPapua: isInPapua(anchor.lat + dLat, anchor.lon + dLon),
    estimated: true,
    timestamp: Date.now()
  };
  
  cache[cacheKey] = result;
  saveCache(cache);
  
  return result;
}

/**
 * Parse cell info from various formats
 */
export function parseCellInfo(input) {
  // Format: MCC-MNC-LAC-CELLID or just cellId
  const parts = input.split(/[-_:]/);
  
  if (parts.length === 4) {
    return {
      mcc: parseInt(parts[0]),
      mnc: parseInt(parts[1]),
      lac: parseInt(parts[2]),
      cellId: parseInt(parts[3])
    };
  } else if (parts.length === 1) {
    // Just cell ID, assume Indonesia
    return {
      mcc: 510, // Indonesia
      mnc: 10,  // Default Telkomsel
      lac: 0,
      cellId: parseInt(parts[0])
    };
  }
  
  throw new Error('Invalid cell info format. Use: MCC-MNC-LAC-CELLID');
}

/**
 * Main CLI
 */
async function main() {
  const args = process.argv.slice(2);
  let mcc = 510, mnc = 10, lac = 0, cellId = 0;
  let apiKey = '';
  let showCarriers = false;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mcc' && args[i + 1]) {
      mcc = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--mnc' && args[i + 1]) {
      mnc = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--lac' && args[i + 1]) {
      lac = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--cellid' && args[i + 1]) {
      cellId = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--cell' && args[i + 1]) {
      const info = parseCellInfo(args[i + 1]);
      mcc = info.mcc; mnc = info.mnc; lac = info.lac; cellId = info.cellId;
      i++;
    } else if (args[i] === '--key' && args[i + 1]) {
      apiKey = args[i + 1];
      i++;
    } else if (args[i] === '--carriers') {
      showCarriers = true;
    }
  }
  
  if (showCarriers) {
    console.log('📡 Indonesian Carriers (MCC 510):');
    Object.entries(INDONESIA_CARRIERS).forEach(([key, c]) => {
      console.log(`  ${key}: ${c.name}`);
    });
    return;
  }
  
  if (!cellId) {
    console.log('Usage: node cell-tower.mjs --mcc 510 --mnc 10 --lac 12345 --cellid 456789 [--key API_KEY]');
    console.log('');
    console.log('Options:');
    console.log('  --mcc <code>      Mobile Country Code (510 = Indonesia)');
    console.log('  --mnc <code>      Mobile Network Code (carrier)');
    console.log('  --lac <id>        Location Area Code');
    console.log('  --cellid <id>     Cell ID');
    console.log('  --cell <info>     Combined: MCC-MNC-LAC-CELLID');
    console.log('  --key <key>       OpenCellID API key (optional, for live lookup)');
    console.log('  --carriers        Show Indonesia carriers');
    console.log('');
    console.log('Get cell info from target phone:');
    console.log('  - Android: Dial *#*#4636#*#* -> Cell Info');
    console.log('  - App: "Cell Mapper" or "Network Cell Info"');
    console.log('');
    console.log('Get OpenCellID key: https://opencellid.org');
    return;
  }
  
  try {
    const result = await lookupCell(mcc, mnc, lac, cellId, apiKey);
    console.log('\n📡 Result:');
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error('❌ Error:', e.message);
    process.exit(1);
  }
}

// Run if executed directly
if (process.argv[1] && process.argv[1].endsWith('cell-tower.mjs')) {
  main().catch(e => {
    console.error('Error:', e.message);
    process.exit(1);
  });
}

export { loadCache, saveCache, getCarrier, isInPapua, regionFor, PAPUA_BOUNDS, CARRIER_REGIONS };