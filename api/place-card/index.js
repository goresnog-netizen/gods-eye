/**
 * API: /api/place-card
 * Place card: geocode a name → lat/lon + street-level photo (KartaView).
 * Query params:
 *   q=  (place name)
 *   lat= (optional, for nearby photo)
 *   lon= (optional, for nearby photo)
 *   radius= (default 25km)
 */

const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const KARTAVIEW_ENDPOINT = 'https://api.kartaview.org/2.0/photo/';
const PLACE_HEADERS = { 'User-Agent': 'GodsEye/1.0 (local research console)' };
const DEFAULT_RADIUS_KM = 25;

// In-memory cache
const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function geocode(query) {
  const url = new URL(NOMINATIM_ENDPOINT);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '3');
  url.searchParams.set('addressdetails', '1');

  const res = await fetch(url.toString(), {
    headers: PLACE_HEADERS,
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;

  const first = data[0];
  return {
    name: first.display_name,
    lat: parseFloat(first.lat),
    lon: parseFloat(first.lon),
    type: first.type,
    class: first.class,
    address: first.address || {},
    importance: first.importance,
    placeId: first.place_id,
  };
}

async function findNearbyPhoto(lat, lon, radiusKm = DEFAULT_RADIUS_KM) {
  const bbox = {
    south: lat - (radiusKm / 110.574) * 1.2,
    north: lat + (radiusKm / 110.574) * 1.2,
    west: lon - (radiusKm / 111.32) * 1.2,
    east: lon + (radiusKm / 111.32) * 1.2,
  };

  const url = `${KARTAVIEW_ENDPOINT}?bbox=${bbox.west},${bbox.south},${bbox.east},${bbox.north}&limit=5`;
  const res = await fetch(url, { headers: PLACE_HEADERS });
  if (!res.ok) return null;
  const data = await res.json();

  const photos = data.images || data.photos || data.results || (Array.isArray(data) ? data : []);
  if (!photos || photos.length === 0) return null;

  const photo = photos[0];
  return {
    id: photo.id,
    url: photo.thumbnail || photo.url || photo.image || photo.photo_url,
    username: photo.username || photo.user?.username || 'unknown',
    lat: parseFloat(photo.lat || photo.latitude),
    lon: parseFloat(photo.lon || photo.longitude),
    capturedAt: photo.captured_at || photo.timestamp || null,
    heading: photo.heading || photo.compact_heading || null,
  };
}

function cameraForPlace(lat, lon, placeType, source) {
  const zoomMap = {
    country: 5,
    state: 7,
    city: 10,
    town: 13,
    village: 14,
    suburb: 15,
    neighbourhood: 17,
    residential: 18,
    house: 19,
  };
  const zoom = zoomMap[placeType] || 14;
  return {
    lat,
    lon,
    height: 5000 / Math.pow(2, zoom - 10),
    heading: 0,
    pitch: -45,
    roll: 0,
    duration: 2.0,
  };
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'private, max-age=3600');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).send('');
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const { q, lat, lon, radius } = req.query;
  if (!q) {
    return res.status(400).json({ error: 'missing_param', detail: 'q= (place name) is required' });
  }

  const cacheKey = `place:${q}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return res.status(200).json(cached.data);
  }

  try {
    // Geocode
    const geo = await geocode(q);
    if (!geo) {
      return res.status(404).json({ error: 'not_found', detail: `No results for: ${q}` });
    }

    // Find nearby photo
    let photo = null;
    if (lat && lon) {
      photo = await findNearbyPhoto(parseFloat(lat), parseFloat(lon), parseFloat(radius) || DEFAULT_RADIUS_KM);
    } else {
      photo = await findNearbyPhoto(geo.lat, geo.lon, DEFAULT_RADIUS_KM);
    }

    const card = {
      ok: true,
      place: geo.name,
      lat: geo.lat,
      lon: geo.lon,
      type: geo.type,
      importance: geo.importance,
      camera: cameraForPlace(geo.lat, geo.lon, geo.type, 'nominatim'),
      photo: photo || null,
      source: 'nominatim+kartaview',
    };

    cache.set(cacheKey, { data: card, ts: Date.now() });
    return res.status(200).json(card);
  } catch (err) {
    console.error('place-card error:', err);
    return res.status(500).json({ error: 'geocode_failed', detail: err?.message });
  }
}
