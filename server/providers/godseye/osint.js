/**
 * World events for the Gold Impact feed.
 *
 * USGS publishes an open GeoJSON feed of the last 24 hours of earthquakes.
 * It needs no key, so the feed keeps a live event stream with nothing to
 * configure.
 */

const USGS_FEED =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';
const USGS_HEADERS = { 'User-Agent': 'GodsEye/1.0 (local research console)' };

/**
 * Fetch recent earthquakes.
 *
 * @param {object} [options]
 * @param {number} [options.minMagnitude]
 * @param {typeof fetch} [options.fetchImpl]
 */
export async function fetchUsgsEarthquakes(options = {}) {
  const { fetchImpl = (...args) => fetch(...args), minMagnitude = 0 } = options;
  const response = await fetchImpl(USGS_FEED, { headers: USGS_HEADERS });
  if (!response.ok) {
    const error = new Error(`usgs HTTP ${response.status}`);
    error.code = 'upstream_error';
    throw error;
  }
  const data = await response.json();
  const features = Array.isArray(data?.features) ? data.features : [];
  return features
    .map((feature) => {
      const properties = feature?.properties || {};
      const coordinates = feature?.geometry?.coordinates || [];
      const magnitude = Number(properties.mag);
      if (!Number.isFinite(magnitude) || magnitude < minMagnitude) return null;
      return {
        kind: 'earthquake',
        title: `Earthquake M${magnitude.toFixed(1)}`,
        place: properties.place || '',
        ts: Number.isFinite(properties.time) ? properties.time : null,
        lat: Number.isFinite(coordinates[1]) ? coordinates[1] : null,
        lon: Number.isFinite(coordinates[0]) ? coordinates[0] : null,
        depthKm: Number.isFinite(coordinates[2]) ? coordinates[2] : null,
        magnitude,
        url: properties.url || '',
        source: 'USGS',
      };
    })
    .filter(Boolean);
}

/**
 * Collect world events. A failing source is reported, never fatal.
 *
 * @param {object} [options]
 * @param {number} [options.minMagnitude]
 */
export async function fetchOsint(options = {}) {
  const { minMagnitude = 4.5 } = options;
  const settled = await Promise.allSettled([
    fetchUsgsEarthquakes({ ...options, minMagnitude }),
  ]);
  const items = settled[0].status === 'fulfilled' ? settled[0].value : [];
  const failed = settled
    .map((result, index) =>
      result.status === 'rejected'
        ? { source: ['usgs'][index], error: result.reason?.message || 'failed' }
        : null,
    )
    .filter(Boolean);
  items.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return { items, failed, fetchedAt: Date.now() };
}
