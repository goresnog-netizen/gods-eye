/**
 * Local Place Card resolver — keyless, no external provider calls.
 * Uses static city data within the project for geocoding.
 *
 * @param {string} query
 * @param {object} [options]
 * @returns {Promise<{name:string,lat:number,lon:number}|null>}
 */
export async function resolvePlace(query, options = {}) {
  const cities = {
    jakarta: { lat: -6.2, lon: 106.8167, name: 'Jakarta, Indonesia' },
    papua: { lat: -4.5326, lon: 140.5066, name: 'Papua, Indonesia' },
    surabaya: { lat: -7.2478, lon: 112.7644, name: 'Surabaya, Indonesia' },
    bandung: { lat: -6.9175, lon: 107.6191, name: 'Bandung, Indonesia' },
    yogyakarta: { lat: -7.7953, lon: 110.3678, name: 'Yogyakarta, Indonesia' },
    bali: { lat: -8.3405, lon: 115.092, name: 'Bali, Indonesia' },
    medan: { lat: 3.5833, lon: 98.6667, name: 'Medan, Indonesia' },
    semarang: { lat: -6.9667, lon: 110.4167, name: 'Semarang, Indonesia' },
    denpasar: { lat: -8.6507, lon: 115.2175, name: 'Denpasar, Indonesia' },
    makassar: { lat: -5.1621, lon: 119.4341, name: 'Makassar, Indonesia' },
    jayapura: {
      lat: -2.5337,
      lon: 140.7175,
      name: 'Jayapura, Papua, Indonesia',
    },
    sorong: { lat: -0.8763, lon: 131.2558, name: 'Sorong, Papua, Indonesia' },
    manokwari: {
      lat: -0.8667,
      lon: 134.0833,
      name: 'Manokwari, Papua Barat, Indonesia',
    },
    merauke: { lat: -8.4667, lon: 140.3333, name: 'Merauke, Papua, Indonesia' },
    wamena: { lat: -4.1, lon: 138.95, name: 'Wamena, Papua, Indonesia' },
    nabire: { lat: -3.3667, lon: 135.4833, name: 'Nabire, Papua, Indonesia' },
    biak: { lat: -1.0333, lon: 136.0833, name: 'Biak, Papua, Indonesia' },
    timika: { lat: -4.55, lon: 136.8833, name: 'Timika, Papua, Indonesia' },
    tolikara: {
      lat: -3.6833,
      lon: 138.4833,
      name: 'Tolikara, Papua, Indonesia',
    },
    yahukimo: {
      lat: -4.4833,
      lon: 139.5333,
      name: 'Yahukimo, Papua, Indonesia',
    },
    puncak: { lat: -3.9833, lon: 137.7833, name: 'Puncak, Papua, Indonesia' },
    'puncak jaya': {
      lat: -3.6167,
      lon: 137.4833,
      name: 'Puncak Jaya, Papua, Indonesia',
    },
  };

  const lower = query.toLowerCase().trim();
  // Exact match first
  if (cities[lower]) return cities[lower];

  // Partial match
  for (const [key, city] of Object.entries(cities)) {
    if (key.includes(lower) || city.name.toLowerCase().includes(lower))
      return city;
  }

  // Default: return first city (Jakarta) as fallback
  return cities.jakarta;
}
