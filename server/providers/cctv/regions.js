/**
 * regions.js — human labels for the CCTV packs.
 *
 * `/api/cctv/sources` answers a flat list with no country field, because each
 * pack is a single agency feed whose extent is known at build time. This module
 * is that knowledge: one entry per pack, so the wall can offer "Indonesia",
 * "United States → Texas", and a city search over the same 4 000 cameras
 * instead of making the reader scroll.
 *
 * Naming follows the app's own convention: Hong Kong and Taiwan are written as
 * "Hong Kong, China" and "Taiwan, China".
 */

/** @typedef {{ country: string, countryId: string, region: string, regionId: string }} RegionLabel */

/** Pack id → country/region. Keys are the `pack` values in `catalog.js`. */
const PACK_REGIONS = Object.freeze({
  austin: { country: 'United States', countryId: 'us', region: 'Texas', regionId: 'us-tx' },
  txdot: { country: 'United States', countryId: 'us', region: 'Texas', regionId: 'us-tx' },
  caltrans: { country: 'United States', countryId: 'us', region: 'California', regionId: 'us-ca' },
  wsdot: { country: 'United States', countryId: 'us', region: 'Washington', regionId: 'us-wa' },
  kingcounty: { country: 'United States', countryId: 'us', region: 'Washington', regionId: 'us-wa' },
  deldot: { country: 'United States', countryId: 'us', region: 'Delaware', regionId: 'us-de' },
  nyc: { country: 'United States', countryId: 'us', region: 'New York', regionId: 'us-ny' },
  florida: { country: 'United States', countryId: 'us', region: 'Florida', regionId: 'us-fl' },
  toronto: { country: 'Canada', countryId: 'ca', region: 'Ontario', regionId: 'ca-on' },
  calgary: { country: 'Canada', countryId: 'ca', region: 'Alberta', regionId: 'ca-ab' },
  drivebc: { country: 'Canada', countryId: 'ca', region: 'British Columbia', regionId: 'ca-bc' },
  tfl: { country: 'United Kingdom', countryId: 'gb', region: 'London', regionId: 'gb-lnd' },
  vegvesen: { country: 'Norway', countryId: 'no', region: 'Norway', regionId: 'no-no' },
  fintraffic: { country: 'Finland', countryId: 'fi', region: 'Finland', regionId: 'fi-fi' },
  tallinn: { country: 'Estonia', countryId: 'ee', region: 'Harju', regionId: 'ee-ha' },
  tarktee: { country: 'Estonia', countryId: 'ee', region: 'Harju', regionId: 'ee-ha' },
  lithuania: { country: 'Lithuania', countryId: 'lt', region: 'Lithuania', regionId: 'lt-lt' },
  warendorf: { country: 'Germany', countryId: 'de', region: 'North Rhine-Westphalia', regionId: 'de-nw' },
  catalonia: { country: 'Spain', countryId: 'es', region: 'Catalonia', regionId: 'es-ct' },
  nsw: { country: 'Australia', countryId: 'au', region: 'New South Wales', regionId: 'au-nsw' },
  hk: { country: 'Hong Kong, China', countryId: 'hk', region: 'Hong Kong', regionId: 'hk-hk' },
  taiwan: { country: 'Taiwan, China', countryId: 'tw', region: 'Taiwan', regionId: 'tw-tw' },
  indonesia: { country: 'Indonesia', countryId: 'id', region: 'Indonesia', regionId: 'id-id' },
});

const UNKNOWN = Object.freeze({
  country: 'Other',
  countryId: 'other',
  region: 'Other',
  regionId: 'other',
});

/**
 * Label one pack. Unknown packs land in "Other" rather than disappearing: a new
 * agency must still be reachable from the wall on the day it is added.
 * @param {string} pack
 * @returns {RegionLabel}
 */
export function regionForPack(pack) {
  return PACK_REGIONS[String(pack || '').toLowerCase()] || UNKNOWN;
}

/**
 * Group cameras by region and count them.
 *
 * @param {Array<{pack?: string}>} sources
 * @returns {{ regions: Array<{id: string, country: string, region: string, count: number}>,
 *             countries: Array<{id: string, country: string, count: number}> }}
 */
export function summariseRegions(sources) {
  const regions = new Map();
  const countries = new Map();
  for (const source of sources || []) {
    const label = regionForPack(source?.pack);
    const region = regions.get(label.regionId) || {
      id: label.regionId,
      country: label.country,
      countryId: label.countryId,
      region: label.region,
      count: 0,
    };
    region.count += 1;
    regions.set(label.regionId, region);

    const country = countries.get(label.countryId) || {
      id: label.countryId,
      country: label.country,
      count: 0,
    };
    country.count += 1;
    countries.set(label.countryId, country);
  }
  return {
    regions: [...regions.values()].sort(
      (a, b) => b.count - a.count || a.region.localeCompare(b.region),
    ),
    countries: [...countries.values()].sort(
      (a, b) => b.count - a.count || a.country.localeCompare(b.country),
    ),
  };
}

/**
 * Keep only the cameras that match a region and/or a free-text query.
 *
 * `region` accepts a country id (`us`) or a region id (`us-tx`); `q` matches the
 * camera name, city, provider and code, case-insensitively.
 *
 * @param {Array<object>} sources
 * @param {{region?: string, q?: string}} [filter]
 * @returns {Array<object>}
 */
export function filterSources(sources, { region = '', q = '' } = {}) {
  const wanted = String(region || '').trim().toLowerCase();
  const needle = String(q || '').trim().toLowerCase();
  return (sources || []).filter((source) => {
    if (wanted) {
      const label = regionForPack(source?.pack);
      if (label.countryId !== wanted && label.regionId !== wanted) return false;
    }
    if (needle) {
      const haystack = [
        source?.name,
        source?.city,
        source?.provider,
        source?.code,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}
