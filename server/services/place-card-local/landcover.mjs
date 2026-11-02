/**
 * Land cover, from the keyless ESA WorldCover 10 m raster on AWS Open Data.
 *
 * The knife-edge model sees terrain and nothing else: a ridge blocks a path,
 * flat ground does not. What it cannot see is the difference between 20 km of
 * open water and 20 km of closed canopy at the same elevation — both are flat,
 * and one of them eats the signal. Terrain roughness was the stand-in for that
 * for two rounds, on the stated premise that no keyless global land-cover
 * service existed. That premise is now false, so the proxy is retired where the
 * real thing is available.
 *
 * The source is `ESA_WorldCover_10m_2021_v200_<tile>_Map.tif` — a Cloud
 * Optimized GeoTIFF, CC BY 4.0, no key, no account. Each file covers 3°×3° at
 * 1/12000° per pixel (36 000² px), stored as 1024² Deflate tiles. A single
 * class lookup therefore costs two HTTP range requests of a few kilobytes
 * instead of a 5 MB download, and the bytes are cached on disk afterwards.
 *
 * Pixels hold the official class *codes*, not colours, so there is nothing to
 * guess: 10 tree cover, 20 shrubland, 30 grassland, 40 cropland, 50 built-up,
 * 60 bare/sparse, 70 snow/ice, 80 water, 90 herbaceous wetland, 95 mangroves,
 * 100 moss/lichen. 0 is no data, which in a coastal tile is the sea.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

/**
 * Where the cached tiles live, resolved per call.
 *
 * ESM evaluates imports before the importing module's body runs, so a const
 * here would capture the environment before a test could point it at a
 * temporary directory.
 */
export function worldCoverDir() {
  return (
    process.env.GEV_WORLDCOVER_DIR || path.join(ROOT, '.gev-cache/worldcover')
  );
}

export const WORLDCOVER_VERSION = 'v200/2021';
export const WORLDCOVER_ATTRIBUTION =
  'ESA WorldCover 10 m 2021 v200 · CC BY 4.0 · esa-worldcover.s3.eu-central-1.amazonaws.com';
export const WORLDCOVER_URL = (tile) =>
  `https://esa-worldcover.s3.eu-central-1.amazonaws.com/${WORLDCOVER_VERSION}/map/ESA_WorldCover_10m_2021_v200_${tile}_Map.tif`;

/** Degrees spanned by one WorldCover file, in both axes. */
export const TILE_SPAN_DEG = 3;

/**
 * The official legend, with the one property this console needs: whether a
 * 30 m mast standing in this cover has to push through scattering material.
 *
 * `cluttered` is not a loss figure — it is a yes/no about whether the path is
 * in clutter at that point. The loss is the technology's own flat allowance
 * scaled by how much of the path answered yes, so no new decibels are invented
 * here.
 */
export const WORLDCOVER_CLASSES = {
  0: {
    key: 'no-data',
    name: 'No data (sea or outside coverage)',
    cluttered: false,
  },
  10: { key: 'tree-cover', name: 'Tree cover', cluttered: true },
  20: { key: 'shrubland', name: 'Shrubland', cluttered: true },
  30: { key: 'grassland', name: 'Grassland', cluttered: false },
  40: { key: 'cropland', name: 'Cropland', cluttered: true },
  50: { key: 'built-up', name: 'Built-up', cluttered: true },
  60: {
    key: 'bare-sparse',
    name: 'Bare / sparse vegetation',
    cluttered: false,
  },
  70: { key: 'snow-ice', name: 'Snow and ice', cluttered: false },
  80: { key: 'water', name: 'Permanent water bodies', cluttered: false },
  90: { key: 'wetland', name: 'Herbaceous wetland', cluttered: true },
  95: { key: 'mangroves', name: 'Mangroves', cluttered: true },
  100: { key: 'moss-lichen', name: 'Moss and lichen', cluttered: false },
};

/** A class code as a named record; unknown codes stay unknown, never guessed. */
export function classify(code) {
  const known = WORLDCOVER_CLASSES[code];
  if (known) return { code, ...known };
  return {
    code,
    key: 'unknown',
    name: `Unknown class ${code}`,
    cluttered: false,
  };
}

/** The file that contains a coordinate: `S06E138`, `N51E003`, `S03W060`. */
export function tileNameFor(lat, lon) {
  const south = Math.floor(lat / TILE_SPAN_DEG) * TILE_SPAN_DEG;
  const west = Math.floor(lon / TILE_SPAN_DEG) * TILE_SPAN_DEG;
  const ns = south < 0 ? 'S' : 'N';
  const ew = west < 0 ? 'W' : 'E';
  return `${ns}${String(Math.abs(south)).padStart(2, '0')}${ew}${String(
    Math.abs(west),
  ).padStart(3, '0')}`;
}

/**
 * Read the first IFD of a WorldCover file.
 *
 * Returns the grid geometry and the per-tile byte ranges. `originLat` is the
 * *north* edge — the file name carries the south-west corner, which is the
 * off-by-one that makes a lookup silently return sea.
 */
export function parseTiffHeader(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) {
    throw new Error('worldcover: header too short');
  }
  const order = buffer.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') {
    throw new Error('worldcover: not a TIFF');
  }
  const le = order === 'II';
  const u16 = (o) => (le ? buffer.readUInt16LE(o) : buffer.readUInt16BE(o));
  const u32 = (o) => (le ? buffer.readUInt32LE(o) : buffer.readUInt32BE(o));
  const dbl = (o) => (le ? buffer.readDoubleLE(o) : buffer.readDoubleBE(o));
  if (u16(2) !== 42) throw new Error('worldcover: bad TIFF magic');

  const ifd = u32(4);
  const entries = u16(ifd);
  const header = {
    width: 0,
    height: 0,
    tileWidth: 0,
    tileHeight: 0,
    compression: 1,
    originLon: null,
    originLat: null,
    pixelScale: null,
    offsets: [],
    lengths: [],
  };
  let offsetsAt = null;
  let countsAt = null;
  let tileCount = 0;

  for (let i = 0; i < entries; i += 1) {
    const entry = ifd + 2 + i * 12;
    const tag = u16(entry);
    const type = u16(entry + 2);
    const count = u32(entry + 4);
    // SHORT with count 1 sits inline; anything bigger is an offset.
    const scalar = type === 4 ? u32(entry + 8) : u16(entry + 8);
    switch (tag) {
      case 256:
        header.width = scalar;
        break;
      case 257:
        header.height = scalar;
        break;
      case 259:
        header.compression = scalar;
        break;
      case 322:
        header.tileWidth = scalar;
        break;
      case 323:
        header.tileHeight = scalar;
        break;
      case 324:
        offsetsAt = u32(entry + 8);
        tileCount = count;
        break;
      case 325:
        countsAt = u32(entry + 8);
        break;
      case 33550:
        header.pixelScale = [dbl(u32(entry + 8)), dbl(u32(entry + 8) + 8)];
        break;
      case 33922: {
        const at = u32(entry + 8);
        header.originLon = dbl(at + 24);
        header.originLat = dbl(at + 32);
        break;
      }
      default:
        break;
    }
  }

  if (!offsetsAt || !countsAt) {
    throw new Error('worldcover: file is not tiled');
  }
  if (offsetsAt + tileCount * 4 > buffer.length) {
    throw new Error('worldcover: tile table beyond the fetched header');
  }
  if (countsAt + tileCount * 4 > buffer.length) {
    throw new Error('worldcover: tile length table beyond the fetched header');
  }
  header.offsets = Array.from({ length: tileCount }, (_, i) =>
    buffer.readUInt32LE(offsetsAt + i * 4),
  );
  header.lengths = Array.from({ length: tileCount }, (_, i) =>
    buffer.readUInt32LE(countsAt + i * 4),
  );
  header.across = Math.ceil(header.width / header.tileWidth);
  return header;
}

/** Which 1024² block holds a coordinate, and where inside it. */
export function tileIndexFor(header, lat, lon) {
  const { pixelScale, originLon, originLat, tileWidth, tileHeight } = header;
  if (!pixelScale || originLon === null || originLat === null) {
    throw new Error('worldcover: no georeferencing');
  }
  const px = Math.floor((lon - originLon) / pixelScale[0]);
  const py = Math.floor((originLat - lat) / pixelScale[1]);
  const col = Math.floor(px / tileWidth);
  const row = Math.floor(py / tileHeight);
  return {
    px,
    py,
    col,
    row,
    inside: px >= 0 && py >= 0 && px < header.width && py < header.height,
    index: row * header.across + col,
    inTileX: ((px % tileWidth) + tileWidth) % tileWidth,
    inTileY: ((py % tileHeight) + tileHeight) % tileHeight,
  };
}

/**
 * How much of a sampled path sits in scattering cover.
 *
 * `fraction` is 0 for open water, grassland and bare ground, 1 for closed
 * canopy or built-up. Callers multiply it by the technology's flat clutter
 * allowance, so the model can only ever spend margin the budget already had.
 */
export function landCoverStats(samples = []) {
  const histogram = {};
  let cluttered = 0;
  let total = 0;
  for (const sample of samples) {
    if (!sample || typeof sample.key !== 'string') continue;
    histogram[sample.key] = (histogram[sample.key] || 0) + 1;
    total += 1;
    if (sample.cluttered) cluttered += 1;
  }
  const ranked = Object.entries(histogram).sort((a, b) => b[1] - a[1]);
  return {
    total,
    cluttered,
    fraction: total ? cluttered / total : 0,
    histogram,
    dominant: ranked.length ? ranked[0][0] : null,
    dominantShare: total && ranked.length ? ranked[0][1] / total : 0,
  };
}

/** The flat allowance scaled by the cluttered share of the path. */
export function landCoverClutterDb(stats, { flatDb = 8, maxDb = 10 } = {}) {
  if (!stats || !stats.total) return 0;
  const scaled = flatDb * stats.fraction;
  return Math.min(maxDb, Math.round(scaled * 10) / 10);
}

// --- I/O -------------------------------------------------------------------

const headerCache = new Map();
const tileCache = new Map();
/**
 * How many decoded blocks stay in memory.
 *
 * A block is 1 MB of class pixels and a full coverage sweep walks thousands of
 * them, so an unbounded map would hold the whole province in RAM. 64 blocks is
 * 64 MB and still covers a site's whole ring, whose radials are computed back
 * to back and share their blocks.
 */
const TILE_CACHE_LIMIT = 64;

async function rangeFetch(url, start, end, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { Range: `bytes=${start}-${end}` },
  });
  if (!response.ok && response.status !== 206) {
    throw new Error(`worldcover: HTTP ${response.status} for ${url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  // A server that ignores Range answers 200 with the whole file; slicing the
  // requested window back out keeps callers honest about what they got.
  if (response.status === 200 && buffer.length > end - start + 1) {
    return buffer.subarray(start, end + 1);
  }
  return buffer;
}

/** The header for a tile file, from disk or from one range request. */
export async function loadHeader(
  tile,
  { fetchImpl = fetch, dir = worldCoverDir() } = {},
) {
  if (headerCache.has(tile)) return headerCache.get(tile);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${tile}.header.json`);
  try {
    const cached = JSON.parse(await readFile(file, 'utf8'));
    headerCache.set(tile, cached);
    return cached;
  } catch {
    // no usable cache — fetch it
  }
  const buffer = await rangeFetch(WORLDCOVER_URL(tile), 0, 262143, fetchImpl);
  const header = parseTiffHeader(buffer);
  writeFileSync(file, `${JSON.stringify(header)}\n`);
  headerCache.set(tile, header);
  return header;
}

/** One decoded 1024² block: compressed bytes on disk, pixels in memory. */
export async function loadTilePixels(
  tile,
  header,
  index,
  { fetchImpl = fetch, dir = worldCoverDir() } = {},
) {
  const key = `${tile}:${index}`;
  if (tileCache.has(key)) return tileCache.get(key);

  const file = path.join(dir, tile, `${index}.bin`);
  let compressed;
  try {
    compressed = await readFile(file);
  } catch {
    const offset = header.offsets[index];
    const length = header.lengths[index];
    if (!length) {
      // A sparse tile: the block is entirely no-data.
      const empty = Buffer.alloc(header.tileWidth * header.tileHeight);
      tileCache.set(key, empty);
      return empty;
    }
    compressed = await rangeFetch(
      WORLDCOVER_URL(tile),
      offset,
      offset + length - 1,
      fetchImpl,
    );
    mkdirSync(path.join(dir, tile), { recursive: true });
    writeFileSync(file, compressed);
  }

  const pixels =
    header.compression === 1 ? compressed : zlib.inflateSync(compressed);
  tileCache.set(key, pixels);
  if (tileCache.size > TILE_CACHE_LIMIT) {
    tileCache.delete(tileCache.keys().next().value);
  }
  return pixels;
}

/**
 * The land-cover class under a coordinate.
 *
 * Returns `null` when the coordinate is outside the tile's grid — the caller
 * should treat that as "no observation", never as open ground.
 */
export async function landCoverAt(lat, lon, options = {}) {
  const tile = tileNameFor(lat, lon);
  const header = await loadHeader(tile, options);
  const loc = tileIndexFor(header, lat, lon);
  if (!loc.inside) return null;
  const pixels = await loadTilePixels(tile, header, loc.index, options);
  const at = loc.inTileY * header.tileWidth + loc.inTileX;
  if (at < 0 || at >= pixels.length) return null;
  return { ...classify(pixels[at]), lat, lon, tile };
}
