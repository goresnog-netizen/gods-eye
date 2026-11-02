/**
 * Local CCTV resolver — keyless, no external provider calls.
 * Uses a static local catalog of CCTV sources (same shape as /api/cctv/sources).
 *
 * @param {object} place - {lat, lon}
 * @param {number} [radiusKm]
 * @returns {Promise<{available:boolean, count:number, total:number, inside:any[]}>}
 */
export async function fetchLocalCctv(place, radiusKm = 25) {
  // Static local catalog (mirrors /api/cctv/sources shape)
  const catalog = [
    {
      id: 'cctv-1',
      name: 'Jakarta Center',
      lat: -6.2,
      lon: 106.8167,
      provider: 'local-mock',
    },
    {
      id: 'cctv-2',
      name: 'Papua Highlands',
      lat: -4.5326,
      lon: 140.5066,
      provider: 'local-mock',
    },
    {
      id: 'cctv-3',
      name: 'Surabaya Port',
      lat: -7.2478,
      lon: 112.7644,
      provider: 'local-mock',
    },
    {
      id: 'cctv-4',
      name: 'Bali Denpasar',
      lat: -8.6507,
      lon: 115.2175,
      provider: 'local-mock',
    },
    {
      id: 'cctv-5',
      name: 'Bandung Plaza',
      lat: -6.9175,
      lon: 107.6191,
      provider: 'local-mock',
    },
    {
      id: 'cctv-6',
      name: 'Yogyakarta Malioboro',
      lat: -7.7953,
      lon: 110.3678,
      provider: 'local-mock',
    },
    {
      id: 'cctv-7',
      name: 'Medan Center',
      lat: 3.5833,
      lon: 98.6667,
      provider: 'local-mock',
    },
    {
      id: 'cctv-8',
      name: 'Semarang Harbor',
      lat: -6.9667,
      lon: 110.4167,
      provider: 'local-mock',
    },
    {
      id: 'cctv-9',
      name: 'Makassar Port',
      lat: -5.1621,
      lon: 119.4341,
      provider: 'local-mock',
    },
    {
      id: 'cctv-10',
      name: 'Jayapura City',
      lat: -2.5337,
      lon: 140.7175,
      provider: 'local-mock',
    },
    {
      id: 'cctv-11',
      name: 'Sorong Harbor',
      lat: -0.8763,
      lon: 131.2558,
      provider: 'local-mock',
    },
    {
      id: 'cctv-12',
      name: 'Manokwari Center',
      lat: -0.8667,
      lon: 134.0833,
      provider: 'local-mock',
    },
    {
      id: 'cctv-13',
      name: 'Merauke Border',
      lat: -8.4667,
      lon: 140.3333,
      provider: 'local-mock',
    },
    {
      id: 'cctv-14',
      name: 'Wamena Valley',
      lat: -4.1,
      lon: 138.95,
      provider: 'local-mock',
    },
    {
      id: 'cctv-15',
      name: 'Nabire Port',
      lat: -3.3667,
      lon: 135.4833,
      provider: 'local-mock',
    },
    {
      id: 'cctv-16',
      name: 'Biak Airport',
      lat: -1.0333,
      lon: 136.0833,
      provider: 'local-mock',
    },
    {
      id: 'cctv-17',
      name: 'Timika Mine',
      lat: -4.55,
      lon: 136.8833,
      provider: 'local-mock',
    },
    {
      id: 'cctv-18',
      name: 'Tolikara Highlands',
      lat: -3.6833,
      lon: 138.4833,
      provider: 'local-mock',
    },
    {
      id: 'cctv-19',
      name: 'Yahukimo Base',
      lat: -4.4833,
      lon: 139.5333,
      provider: 'local-mock',
    },
    {
      id: 'cctv-20',
      name: 'Puncak Pass',
      lat: -3.9833,
      lon: 137.7833,
      provider: 'local-mock',
    },
    {
      id: 'cctv-21',
      name: 'Puncak Jaya Summit',
      lat: -3.6167,
      lon: 137.4833,
      provider: 'local-mock',
    },
  ];

  const latDelta = (radiusKm / 110.574) * 1.2;
  const lonScale = Math.max(0.15, Math.cos((place.lat * Math.PI) / 180));
  const lonDelta = (radiusKm / (111.32 * lonScale)) * 1.2;

  const south = place.lat - latDelta;
  const north = place.lat + latDelta;
  const west = place.lon - lonDelta;
  const east = place.lon + lonDelta;

  const inside = catalog.filter((c) => {
    return c.lat >= south && c.lat <= north && c.lon >= west && c.lon <= east;
  });

  return {
    available: true,
    count: inside.length,
    total: catalog.length,
    inside,
    source: 'local-mock',
  };
}
