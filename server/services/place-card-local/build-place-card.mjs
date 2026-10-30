/**
 * Local Place Card builder — end-to-end, no external provider calls.
 * Combines local geocoding + local street photo + intent for the globe.
 *
 * @param {string} query
 * @param {object} [options]
 * @param {number} [options.radiusKm]
 * @returns {Promise<object>}
 */
import { resolvePlace } from './resolve-place.mjs';
import { fetchStreetPhoto } from './fetch-street-photo.mjs';
import { fetchLocalCctv } from './fetch-cctv-local.mjs';

const DEFAULT_RADIUS_KM = 25;

/**
 * Bounding box around a point (local, no external calls).
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
 * Build a place card from a query.
 *
 * @param {string} query
 * @param {object} [options]
 * @param {number} [options.radiusKm]
 */
export async function buildPlaceCard(query, options = {}) {
  const { radiusKm = DEFAULT_RADIUS_KM } = options;
  const place = await resolvePlace(query, options);
  const photo = await fetchStreetPhoto(place, options);
  const cctv = await fetchLocalCctv(place, radiusKm);
  const bbox = bboxAround(place.lat, place.lon, radiusKm);
  return {
    query,
    place,
    radiusKm,
    bbox,
    photo,
    cctv,
    intent: {
      tool: 'show_in_gods_eye_view',
      camera: { lat: place.lat, lon: place.lon, altitude_m: 1200 },
      layers: ['streetLevel', 'cctv'],
      providerSwitches: '0.m.0_0.r.google-0*kartaview-1',
    },
    generatedAt: Date.now(),
    source: 'local-only',
  };
}