/**
 * Local Place Card street photo fetcher — keyless, no external provider calls.
 * Returns a synthetic/mock street photo info based on the place coordinates.
 *
 * @param {object} place - {name, lat, lon}
 * @param {object} [options]
 * @returns {Promise<{available:boolean, photoUrl?:string, provider?:string, timestamp?:string, reason?:string}>}
 */
export async function fetchStreetPhoto(place, options = {}) {
  const { radiusKm = 25 } = options;
  const now = Date.now();

  // Generate a deterministic but "mock" photo URL based on coordinates
  // This simulates what KartaView would return without actually calling the API
  const lat = Math.round(place.lat * 10000) / 10000;
  const lon = Math.round(place.lon * 10000) / 10000;
  const photoId = `${lat}_${lon}`;

  // Mock photo info - local only, no external call
  return {
    available: true,
    photoUrl: `/placeholder-street-photo?lat=${lat}&lon=${lon}&id=${photoId}`,
    provider: 'local-mock',
    timestamp: new Date(now - 86400000).toISOString().split('T')[0], // "yesterday"
    reason: null,
    metadata: {
      location: { lat, lon },
      radiusKm,
      captured: '2024-01-15T10:30:00Z', // synthetic date
      confidence: 0.9,
    },
  };
}