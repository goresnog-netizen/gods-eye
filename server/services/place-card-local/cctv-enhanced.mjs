/**
 * CCTV Enhanced — Local CCTV catalog with phone camera integration.
 *
 * Features:
 * - 100+ CCTV sources (Indonesia + Papua)
 * - Phone camera integration (WebRTC/RTSP)
 * - No external provider calls
 * - Local-only data
 */

import { loadAtcsCameras } from './cctv-atcs.mjs';

const BASE_CCTV_CATALOG = [
  // === INDONESIA - MAJOR CITIES ===
  {
    id: 'cctv-001',
    name: 'Jakarta - Monas',
    lat: -6.1751,
    lon: 106.8272,
    provider: 'local',
    type: 'fixed',
    city: 'Jakarta',
  },
  {
    id: 'cctv-002',
    name: 'Jakarta - Sudirman',
    lat: -6.2088,
    lon: 106.8456,
    provider: 'local',
    type: 'fixed',
    city: 'Jakarta',
  },
  {
    id: 'cctv-003',
    name: 'Jakarta - Thamrin',
    lat: -6.1944,
    lon: 106.8229,
    provider: 'local',
    type: 'fixed',
    city: 'Jakarta',
  },
  {
    id: 'cctv-004',
    name: 'Jakarta - Bundaran HI',
    lat: -6.1934,
    lon: 106.823,
    provider: 'local',
    type: 'fixed',
    city: 'Jakarta',
  },
  {
    id: 'cctv-005',
    name: 'Jakarta - Senayan',
    lat: -6.2297,
    lon: 106.806,
    provider: 'local',
    type: 'fixed',
    city: 'Jakarta',
  },

  {
    id: 'cctv-006',
    name: 'Surabaya - Tunjungan',
    lat: -7.2575,
    lon: 112.7521,
    provider: 'local',
    type: 'fixed',
    city: 'Surabaya',
  },
  {
    id: 'cctv-007',
    name: 'Surabaya - Juanda',
    lat: -7.3799,
    lon: 112.7869,
    provider: 'local',
    type: 'fixed',
    city: 'Surabaya',
  },
  {
    id: 'cctv-008',
    name: 'Surabaya - Pakuwon',
    lat: -7.2819,
    lon: 112.7378,
    provider: 'local',
    type: 'fixed',
    city: 'Surabaya',
  },

  {
    id: 'cctv-009',
    name: 'Bandung - Dago',
    lat: -6.8915,
    lon: 107.6107,
    provider: 'local',
    type: 'fixed',
    city: 'Bandung',
  },
  {
    id: 'cctv-010',
    name: 'Bandung - Braga',
    lat: -6.9147,
    lon: 107.6098,
    provider: 'local',
    type: 'fixed',
    city: 'Bandung',
  },

  {
    id: 'cctv-011',
    name: 'Bali - Kuta',
    lat: -8.7211,
    lon: 115.1697,
    provider: 'local',
    type: 'fixed',
    city: 'Bali',
  },
  {
    id: 'cctv-012',
    name: 'Bali - Sanur',
    lat: -8.6806,
    lon: 115.2629,
    provider: 'local',
    type: 'fixed',
    city: 'Bali',
  },
  {
    id: 'cctv-013',
    name: 'Bali - Ubud',
    lat: -8.5069,
    lon: 115.2625,
    provider: 'local',
    type: 'fixed',
    city: 'Bali',
  },

  {
    id: 'cctv-014',
    name: 'Yogyakarta - Malioboro',
    lat: -7.7928,
    lon: 110.3659,
    provider: 'local',
    type: 'fixed',
    city: 'Yogyakarta',
  },
  {
    id: 'cctv-015',
    name: 'Yogyakarta - Tugu',
    lat: -7.7828,
    lon: 110.367,
    provider: 'local',
    type: 'fixed',
    city: 'Yogyakarta',
  },

  {
    id: 'cctv-016',
    name: 'Medan - Merdeka',
    lat: 3.5931,
    lon: 98.6767,
    provider: 'local',
    type: 'fixed',
    city: 'Medan',
  },
  {
    id: 'cctv-017',
    name: 'Medan - Kesawan',
    lat: 3.5851,
    lon: 98.672,
    provider: 'local',
    type: 'fixed',
    city: 'Medan',
  },

  {
    id: 'cctv-018',
    name: 'Makassar - Losari',
    lat: -5.1477,
    lon: 119.4327,
    provider: 'local',
    type: 'fixed',
    city: 'Makassar',
  },
  {
    id: 'cctv-019',
    name: 'Makassar - Panakkukang',
    lat: -5.165,
    lon: 119.433,
    provider: 'local',
    type: 'fixed',
    city: 'Makassar',
  },

  // === PAPUA ===
  {
    id: 'cctv-020',
    name: 'Jayapura - Abepura',
    lat: -2.5337,
    lon: 140.7175,
    provider: 'local',
    type: 'fixed',
    city: 'Jayapura',
  },
  {
    id: 'cctv-021',
    name: 'Jayapura - Hamadi',
    lat: -2.5333,
    lon: 140.7,
    provider: 'local',
    type: 'fixed',
    city: 'Jayapura',
  },
  {
    id: 'cctv-022',
    name: 'Jayapura - Entrop',
    lat: -2.5333,
    lon: 140.7167,
    provider: 'local',
    type: 'fixed',
    city: 'Jayapura',
  },

  {
    id: 'cctv-023',
    name: 'Sorong - Pelabuhan',
    lat: -0.8763,
    lon: 131.2558,
    provider: 'local',
    type: 'fixed',
    city: 'Sorong',
  },
  {
    id: 'cctv-024',
    name: 'Sorong - Kota',
    lat: -0.8763,
    lon: 131.2558,
    provider: 'local',
    type: 'fixed',
    city: 'Sorong',
  },

  {
    id: 'cctv-025',
    name: 'Manokwari - Pelabuhan',
    lat: -0.8667,
    lon: 134.0833,
    provider: 'local',
    type: 'fixed',
    city: 'Manokwari',
  },
  {
    id: 'cctv-026',
    name: 'Manokwari - Kota',
    lat: -0.8667,
    lon: 134.0833,
    provider: 'local',
    type: 'fixed',
    city: 'Manokwari',
  },

  {
    id: 'cctv-027',
    name: 'Merauke - Pelabuhan',
    lat: -8.4667,
    lon: 140.3333,
    provider: 'local',
    type: 'fixed',
    city: 'Merauke',
  },
  {
    id: 'cctv-028',
    name: 'Merauke - Kota',
    lat: -8.4667,
    lon: 140.3333,
    provider: 'local',
    type: 'fixed',
    city: 'Merauke',
  },

  {
    id: 'cctv-029',
    name: 'Wamena - Kota',
    lat: -4.1,
    lon: 138.95,
    provider: 'local',
    type: 'fixed',
    city: 'Wamena',
  },
  {
    id: 'cctv-030',
    name: 'Wamena - Valley',
    lat: -4.1,
    lon: 138.95,
    provider: 'local',
    type: 'fixed',
    city: 'Wamena',
  },

  {
    id: 'cctv-031',
    name: 'Nabire - Pelabuhan',
    lat: -3.3667,
    lon: 135.5,
    provider: 'local',
    type: 'fixed',
    city: 'Nabire',
  },
  {
    id: 'cctv-032',
    name: 'Nabire - Kota',
    lat: -3.3667,
    lon: 135.5,
    provider: 'local',
    type: 'fixed',
    city: 'Nabire',
  },

  {
    id: 'cctv-033',
    name: 'Biak - Pelabuhan',
    lat: -1.1906,
    lon: 136.0806,
    provider: 'local',
    type: 'fixed',
    city: 'Biak',
  },
  {
    id: 'cctv-034',
    name: 'Biak - Kota',
    lat: -1.1906,
    lon: 136.0806,
    provider: 'local',
    type: 'fixed',
    city: 'Biak',
  },

  {
    id: 'cctv-035',
    name: 'Timika - Kota',
    lat: -4.5326,
    lon: 136.884,
    provider: 'local',
    type: 'fixed',
    city: 'Timika',
  },
  {
    id: 'cctv-036',
    name: 'Timika - Tambang',
    lat: -4.5326,
    lon: 136.884,
    provider: 'local',
    type: 'fixed',
    city: 'Timika',
  },

  {
    id: 'cctv-037',
    name: 'Tolikara - Kota',
    lat: -3.6167,
    lon: 137.4833,
    provider: 'local',
    type: 'fixed',
    city: 'Tolikara',
  },
  {
    id: 'cctv-038',
    name: 'Yahukimo - Kota',
    lat: -4.4833,
    lon: 139.5333,
    provider: 'local',
    type: 'fixed',
    city: 'Yahukimo',
  },
  {
    id: 'cctv-039',
    name: 'Puncak - Kota',
    lat: -3.9833,
    lon: 137.7833,
    provider: 'local',
    type: 'fixed',
    city: 'Puncak',
  },
  {
    id: 'cctv-040',
    name: 'Puncak Jaya - Kota',
    lat: -3.6833,
    lon: 138.4833,
    provider: 'local',
    type: 'fixed',
    city: 'Puncak Jaya',
  },

  // === PHONE CAMERAS (WebRTC/RTSP) ===
  {
    id: 'phone-cam-001',
    name: 'Phone Cam - Jayapura',
    lat: -2.5337,
    lon: 140.7175,
    provider: 'phone',
    type: 'phone',
    city: 'Jayapura',
    stream: 'webrtc',
  },
  {
    id: 'phone-cam-002',
    name: 'Phone Cam - Sorong',
    lat: -0.8763,
    lon: 131.2558,
    provider: 'phone',
    type: 'phone',
    city: 'Sorong',
    stream: 'webrtc',
  },
  {
    id: 'phone-cam-003',
    name: 'Phone Cam - Wamena',
    lat: -4.1,
    lon: 138.95,
    provider: 'phone',
    type: 'phone',
    city: 'Wamena',
    stream: 'webrtc',
  },
  {
    id: 'phone-cam-004',
    name: 'Phone Cam - Merauke',
    lat: -8.4667,
    lon: 140.3333,
    provider: 'phone',
    type: 'phone',
    city: 'Merauke',
    stream: 'webrtc',
  },
  {
    id: 'phone-cam-005',
    name: 'Phone Cam - Jakarta',
    lat: -6.2,
    lon: 106.8167,
    provider: 'phone',
    type: 'phone',
    city: 'Jakarta',
    stream: 'webrtc',
  },
  {
    id: 'phone-cam-006',
    name: 'Phone Cam - Bali',
    lat: -8.6507,
    lon: 115.2175,
    provider: 'phone',
    type: 'phone',
    city: 'Bali',
    stream: 'webrtc',
  },
  {
    id: 'phone-cam-007',
    name: 'Phone Cam - Bandung',
    lat: -6.9175,
    lon: 107.6191,
    provider: 'phone',
    type: 'phone',
    city: 'Bandung',
    stream: 'webrtc',
  },
  {
    id: 'phone-cam-008',
    name: 'Phone Cam - Surabaya',
    lat: -7.2478,
    lon: 112.7644,
    provider: 'phone',
    type: 'phone',
    city: 'Surabaya',
    stream: 'webrtc',
  },

  // === RTSP CAMERAS (IP Cameras) ===
  {
    id: 'rtsp-001',
    name: 'RTSP Cam - Papua 1',
    lat: -4.5326,
    lon: 140.5066,
    provider: 'rtsp',
    type: 'ip-camera',
    city: 'Papua',
    stream: 'rtsp',
    url: 'rtsp://192.168.1.100:554/stream1',
  },
  {
    id: 'rtsp-002',
    name: 'RTSP Cam - Papua 2',
    lat: -2.5337,
    lon: 140.7175,
    provider: 'rtsp',
    type: 'ip-camera',
    city: 'Jayapura',
    stream: 'rtsp',
    url: 'rtsp://192.168.1.101:554/stream1',
  },
  {
    id: 'rtsp-003',
    name: 'RTSP Cam - Jakarta 1',
    lat: -6.2,
    lon: 106.8167,
    provider: 'rtsp',
    type: 'ip-camera',
    city: 'Jakarta',
    stream: 'rtsp',
    url: 'rtsp://192.168.1.102:554/stream1',
  },
];

/**
 * Haversine distance (km)
 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Fetch CCTV near location
 */
export async function fetchCctvEnhanced(lat, lon, radiusKm = 25, options = {}) {
  const { type = null, city = null, provider = null } = options;

  let filtered = CCTV_CATALOG;

  if (type) filtered = filtered.filter((c) => c.type === type);
  if (city) filtered = filtered.filter((c) => c.city === city);
  if (provider) filtered = filtered.filter((c) => c.provider === provider);

  const inside = filtered.filter(
    (c) => haversineKm(lat, lon, c.lat, c.lon) <= radiusKm,
  );

  return {
    available: true,
    count: inside.length,
    total: filtered.length,
    inside: inside.map((c) => ({
      ...c,
      distance: Math.round(haversineKm(lat, lon, c.lat, c.lon) * 100) / 100,
    })),
  };
}

/**
 * Get all CCTV by type
 */
export function getCctvByType(type) {
  return CCTV_CATALOG.filter((c) => c.type === type);
}

/**
 * Get all CCTV by provider
 */
export function getCctvByProvider(provider) {
  return CCTV_CATALOG.filter((c) => c.provider === provider);
}

/**
 * Get all CCTV by city
 */
export function getCctvByCity(city) {
  return CCTV_CATALOG.filter((c) => c.city === city);
}

/**
 * Get all CCTV count
 */
export function getCctvCount() {
  const byType = {};
  const byProvider = {};
  CCTV_CATALOG.forEach((c) => {
    byType[c.type] = (byType[c.type] || 0) + 1;
    byProvider[c.provider] = (byProvider[c.provider] || 0) + 1;
  });
  return {
    total: CCTV_CATALOG.length,
    byType,
    byProvider,
    papua: CCTV_CATALOG.filter((c) =>
      [
        'Jayapura',
        'Sorong',
        'Manokwari',
        'Merauke',
        'Wamena',
        'Nabire',
        'Biak',
        'Timika',
        'Tolikara',
        'Yahukimo',
        'Puncak',
        'Puncak Jaya',
      ].includes(c.city),
    ).length,
  };
}

/**
 * CLI
 */
async function main() {
  const args = process.argv.slice(2);
  let lat = -4.5326,
    lon = 140.5066,
    radius = 50;
  let type = null,
    city = null,
    provider = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--lat' && args[i + 1]) {
      lat = parseFloat(args[i + 1]);
      i++;
    } else if (args[i] === '--lon' && args[i + 1]) {
      lon = parseFloat(args[i + 1]);
      i++;
    } else if (args[i] === '--radius' && args[i + 1]) {
      radius = parseFloat(args[i + 1]);
      i++;
    } else if (args[i] === '--type' && args[i + 1]) {
      type = args[i + 1];
      i++;
    } else if (args[i] === '--city' && args[i + 1]) {
      city = args[i + 1];
      i++;
    } else if (args[i] === '--provider' && args[i + 1]) {
      provider = args[i + 1];
      i++;
    } else if (args[i] === '--count') {
      console.log(JSON.stringify(getCctvCount(), null, 2));
      return;
    }
  }

  const result = await fetchCctvEnhanced(lat, lon, radius, {
    type,
    city,
    provider,
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && process.argv[1].endsWith('cctv-enhanced.mjs')) {
  main().catch((e) => {
    console.error('Error:', e.message);
    process.exit(1);
  });
}

/** Real ATCS cameras (live-checked at collection time) come first, then the local base catalog. */
const CCTV_CATALOG = [...loadAtcsCameras(), ...BASE_CCTV_CATALOG];

export { CCTV_CATALOG, haversineKm };
