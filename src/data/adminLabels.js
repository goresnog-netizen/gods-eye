/**
 * Administrative names the globe can show as the camera closes in.
 *
 * This is the LOD table for place names: provinces read from far out, regencies
 * as the camera drops, districts and villages only when it is close enough for
 * them to matter. The app imports it as a module so the labels survive a
 * production build.
 *
 * The SEED below is honest about what it is: the names are real, the positions
 * are the seat of each unit, and every entry carries `synthetic: true` so no
 * consumer can present them as a survey. Replace it with
 * `server/services/place-card-local/import-admin.mjs` when a real boundary set
 * (OSM, GADM, Badan Informasi Geospasial) is at hand.
 */

/** Level 1 province, level 2 regency/city, level 3 district, level 4 village. */
export const ADMIN_LEVELS = Object.freeze({
  province: 1,
  regency: 2,
  district: 3,
  village: 4,
});

/**
 * Camera heights (metres) at which each level starts to read.
 *
 * A province is legible from orbit; a village is not. The ranges are wide on
 * purpose — the point is that names appear as the camera closes in, not that a
 * boundary is drawn at an exact altitude.
 */
export const LEVEL_RANGES = Object.freeze([
  { level: ADMIN_LEVELS.province, minHeightM: 2_000_000 },
  { level: ADMIN_LEVELS.regency, minHeightM: 400_000 },
  { level: ADMIN_LEVELS.district, minHeightM: 90_000 },
  { level: ADMIN_LEVELS.village, minHeightM: 0 },
]);

/** How many labels may be on screen at once; the globe is not a list. */
export const MAX_VISIBLE_LABELS = 80;

const unit = (name, level, lat, lon, kind) => ({
  id: `adm-${level}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  name,
  level,
  lat,
  lon,
  kind,
  synthetic: true,
  source: 'local-seed',
});

/** Provinces of the Papuan region, as they stand after the 2022 expansion. */
const PROVINCES = [
  ['Papua', -2.5337, 140.7175, 'provinsi'],
  ['Papua Barat', -0.8615, 134.062, 'provinsi'],
  ['Papua Barat Daya', -0.8763, 131.2558, 'provinsi'],
  ['Papua Pegunungan', -4.1, 138.95, 'provinsi'],
  ['Papua Tengah', -3.3667, 135.4833, 'provinsi'],
  ['Papua Selatan', -8.4932, 140.4018, 'provinsi'],
].map(([name, lat, lon, kind]) => unit(name, 1, lat, lon, kind));

/**
 * Regencies and cities of the region, positioned at their seats.
 * The names are the real administrative names; the coordinates are the seat
 * town, which is within a few kilometres of the unit's centroid.
 */
const REGENCIES = [
  ['Jayapura', -2.5337, 140.7175, 'kota'],
  ['Sarmi', -1.8667, 138.75, 'kabupaten'],
  ['Keerom', -3.4, 140.9, 'kabupaten'],
  ['Waropen', -2.1, 136.6, 'kabupaten'],
  ['Yapen Waropen', -1.8833, 136.2333, 'kabupaten'],
  ['Biak Numfor', -1.1833, 136.0833, 'kabupaten'],
  ['Supiori', -0.7, 135.6, 'kabupaten'],
  ['Mamberamo Raya', -2.25, 137.6, 'kabupaten'],
  ['Mamberamo Tengah', -3.6, 139.0, 'kabupaten'],
  ['Tolikara', -3.6833, 138.4833, 'kabupaten'],
  ['Yahukimo', -4.4833, 139.5333, 'kabupaten'],
  ['Yalimo', -3.8, 138.6, 'kabupaten'],
  ['Pegunungan Bintang', -4.9, 140.6, 'kabupaten'],
  ['Lanny Jaya', -3.95, 138.4, 'kabupaten'],
  ['Nduga', -4.45, 138.0, 'kabupaten'],
  ['Puncak', -3.9833, 137.7833, 'kabupaten'],
  ['Puncak Jaya', -3.6167, 137.4833, 'kabupaten'],
  ['Dogiyai', -4.0, 135.8, 'kabupaten'],
  ['Deiyai', -4.05, 136.3, 'kabupaten'],
  ['Intan Jaya', -3.75, 137.1, 'kabupaten'],
  ['Paniai', -3.9167, 136.3667, 'kabupaten'],
  ['Mimika', -4.5461, 136.8876, 'kabupaten'],
  ['Nabire', -3.3667, 135.4833, 'kabupaten'],
  ['Kaimana', -3.65, 133.75, 'kabupaten'],
  ['Fakfak', -2.9167, 132.3, 'kabupaten'],
  ['Teluk Wondama', -2.7, 134.5, 'kabupaten'],
  ['Teluk Bintuni', -2.2, 133.4, 'kabupaten'],
  ['Manokwari', -0.8615, 134.062, 'kabupaten'],
  ['Sorong', -0.8763, 131.2558, 'kota'],
  ['Sorong Selatan', -1.5, 132.2, 'kabupaten'],
  ['Raja Ampat', -0.4333, 130.8167, 'kabupaten'],
  ['Tambrauw', -0.8, 132.4, 'kabupaten'],
  ['Maybrat', -1.25, 132.5, 'kabupaten'],
  ['Asmat', -5.55, 138.1, 'kabupaten'],
  ['Boven Digoel', -6.1, 140.3, 'kabupaten'],
  ['Mappi', -6.5, 139.3, 'kabupaten'],
  ['Merauke', -8.4932, 140.4018, 'kabupaten'],
].map(([name, lat, lon, kind]) => unit(name, 2, lat, lon, kind));

/** Districts, where the seed knows them by name. */
const DISTRICTS = [
  ['Abepura', -2.6100, 140.6500, 'kecamatan'],
  ['Muara Tami', -2.5100, 140.7500, 'kecamatan'],
  ['Sentani', -2.5760, 140.5140, 'kecamatan'],
  ['Waena', -2.5900, 140.6400, 'kecamatan'],
  ['Heram', -2.5600, 140.6900, 'kecamatan'],
  ['Timika', -4.5461, 136.8876, 'kecamatan'],
  ['Karubaga (Tolikara)', -3.6833, 138.4833, 'distrik'],
  ['Dekai (Yahukimo)', -4.4833, 139.5333, 'distrik'],
  ['Mulia (Puncak Jaya)', -3.6167, 137.4833, 'distrik'],
  ['Agats (Asmat)', -5.55, 138.1, 'distrik'],
  ['Waisai (Raja Ampat)', -0.4333, 130.8167, 'distrik'],
  ['Kepi (Mappi)', -6.5, 139.3, 'distrik'],
].map(([name, lat, lon, kind]) => unit(name, 3, lat, lon, kind));

/** Every unit the seed knows, provinces first so a cap favours them. */
export const ADMIN_UNITS = Object.freeze([
  ...PROVINCES,
  ...REGENCIES,
  ...DISTRICTS,
]);

export const ADMIN_LABEL_SOURCE = 'local-seed';
