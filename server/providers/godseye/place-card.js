/**
 * Place Card: a name, its coordinates, a street-level photo and the intent the
 * app needs to show it.
 *
 * The card does not build share links. The app already owns that (its
 * `show_in_gods_eye_view` tool and share-link builder), so the card returns
 * the camera, layer and provider switch and lets the app render it.
 */

const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const KARTAVIEW_ENDPOINT = 'https://api.kartaview.org/2.0/photo/';
const PLACE_HEADERS = { 'User-Agent': 'GodsEye/1.0 (local research console)' };
const DEFAULT_RADIUS_KM = 25;

/**
 * Bounding box around a point.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {number} [radiusKm]
 */
export function bboxAround(lat, lon, radiusKm = DEFAULT_RADIUS_KM) {
  const latDelta = (radiusKm / 110.574) * 1.2;
  const lonScale = Math.max(0.15, Math.cos((lat * Math.PI) / 180));
  const lonDelta = (radiusKm / (111.32 * lonScale)) * 1.2;
  return {
    south: Math.max(-90, lat - latDelta),
    west: lon - lonDelta,
    north: Math.min(90, lat + latDelta),
    east: lon + lonDelta,
  };
}

/**
 * Normalise a geocode answer into one place shape.
 *
 * @param {object|Array} payload
 * @param {string} source
 */
export function normalizePlace(payload, source) {
  const first = Array.isArray(payload)
    ? payload[0]
    : Array.isArray(payload?.results)
      ? payload.results[0]
      : payload;
  if (!first) return null;
  const location = first?.geometry?.location;
  const lat = Number(location?.lat ?? first?.lat);
  const lon = Number(location?.lng ?? first?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    name:
      first?.name ||
      first?.display_name ||
      first?.formatted_address ||
      `${lat}, ${lon}`,
    lat,
    lon,
    bounds: first?.geometry?.bounds || first?.boundingbox || null,
    source,
  };
}

/**
 * Resolve a place name to coordinates.
 *
 * @param {string} query
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 */
export async function resolvePlace(query, options = {}) {
  const { fetchImpl = (...args) => fetch(...args) } = options;
  const url = `${NOMINATIM_ENDPOINT}?q=${encodeURIComponent(query)}&format=jsonv2&limit=1`;
  const response = await fetchImpl(url, { headers: PLACE_HEADERS });
  if (!response.ok) {
    const error = new Error(`geocode HTTP ${response.status}`);
    error.code = 'upstream_error';
    throw error;
  }
  const payload = await response.json();
  const place = normalizePlace(payload, 'nominatim');
  if (!place) {
    const error = new Error(`place "${query}" not found`);
    error.code = 'not_found';
    throw error;
  }
  return place;
}

/**
 * Fetch the nearest street-level photo.
 *
 * @param {{lat:number,lon:number}} place
 * @param {object} [options]
 */
export async function fetchStreetPhoto(place, options = {}) {
  const {
    fetchImpl = (...args) => fetch(...args),
    zoomLevel = 18,
    itemsPerPage = 5,
  } = options;
  const url = `${KARTAVIEW_ENDPOINT}?lat=${place.lat}&lng=${place.lon}&zoomLevel=${zoomLevel}&itemsPerPage=${itemsPerPage}`;
  const response = await fetchImpl(url, { headers: PLACE_HEADERS });
  if (!response.ok) {
    const error = new Error(`kartaview HTTP ${response.status}`);
    error.code = 'upstream_error';
    throw error;
  }
  const payload = await response.json();
  const photo = Array.isArray(payload?.result?.data)
    ? payload.result.data[0]
    : null;
  if (!photo) {
    const error = new Error('no street photo covers this point');
    error.code = 'no_coverage';
    throw error;
  }
  return {
    provider: 'KartaView',
    id: photo.id,
    url: photo.imageProcUrl || photo.imageLthUrl || null,
    thumbUrl: photo.imageThUrl || photo.imageLthUrl || null,
    lowUrl: photo.imageLthUrl || null,
    capturedAt: photo.dateAdded || null,
    lat: Number(photo.lat),
    lon: Number(photo.lng),
    license: 'CC BY-SA 4.0 (KartaView contributors)',
    attribution: '(c) KartaView contributors',
  };
}

/**
 * Build a place card.
 *
 * @param {string} query
 * @param {object} [options]
 * @param {number} [options.radiusKm]
 */
export async function buildPlaceCard(query, options = {}) {
  const { radiusKm = DEFAULT_RADIUS_KM } = options;
  const place = await resolvePlace(query, options);
  const photo = await fetchStreetPhoto(place, options).catch((error) => ({
    available: false,
    reason: error?.code || error?.message || 'no photo',
  }));
  const bbox = bboxAround(place.lat, place.lon, radiusKm);
  return {
    query,
    place,
    radiusKm,
    bbox,
    photo,
    intent: {
      tool: 'show_in_gods_eye_view',
      camera: { lat: place.lat, lon: place.lon, altitude_m: 1200 },
      layers: ['streetLevel'],
      providerSwitches: '0.m.0_0.r.google-0*kartaview-1',
    },
    generatedAt: Date.now(),
  };
}
