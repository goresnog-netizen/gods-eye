/**
 * Free sources — what this console can lean on without paying, and what it
 * cannot.
 *
 * The point of this table is not to list services; it is to stop the console
 * from claiming a capability it does not have. Every entry was probed from
 * this machine, so `status` is an observation, not a hope:
 *
 *   verified  — a real request returned real data here
 *   reachable — the service answers, but a credential is missing
 *   dead      — it no longer exists
 *
 * Anything with `key: 'free-signup'` needs an account the operator creates;
 * the README and the roadmap name them so nobody has to guess.
 */

/** A source that needs no key at all and was proven to work here. */
const KEYLESS_VERIFIED = [
  {
    id: 'esri-world-imagery',
    name: 'Esri World Imagery',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
    kind: 'imagery',
    key: 'none',
    status: 'verified',
    resolution: 'sub-metre in cities, ~1 m in most of the world',
    license: 'Esri terms — attribution required ("Powered by Esri")',
    note: 'The basemap Cesium already loads, and the tile the panel shows next to an answer.',
  },
  {
    id: 'open-meteo-elevation',
    name: 'Open-Meteo Elevation',
    url: 'https://api.open-meteo.com/v1/elevation',
    kind: 'elevation',
    key: 'none',
    status: 'verified',
    resolution: '~90 m (Copernicus DEM)',
    license: 'CC BY 4.0 — attribution required',
    note:
      'An independent DEM. Two elevation models that agree to a few metres make the ' +
      'height trustworthy; one that disagrees is reported as uncertain.',
  },
  {
    id: 'open-meteo-weather',
    name: 'Open-Meteo Forecast',
    url: 'https://api.open-meteo.com/v1/forecast',
    kind: 'weather',
    key: 'none',
    status: 'verified',
    resolution: 'hourly, 1–11 km grid',
    license: 'CC BY 4.0 — attribution required',
    note: 'Cloud and rain at the answer, which is what actually blocks a radio path.',
  },
  {
    id: 'rainviewer',
    name: 'RainViewer radar',
    url: 'https://api.rainviewer.com/public/weather-maps.json',
    kind: 'weather',
    key: 'none',
    status: 'verified',
    resolution: '~1 km, 10-minute frames',
    license: 'free for non-commercial with attribution',
    note: 'Live precipitation tiles, useful when a viewshed has to explain a gap.',
  },
  {
    id: 'wikimedia-geosearch',
    name: 'Wikimedia Commons geosearch',
    url: 'https://commons.wikimedia.org/w/api.php',
    kind: 'photos',
    key: 'none',
    status: 'verified',
    resolution: 'point photos with coordinates',
    license: 'CC BY-SA / public domain per file',
    note: 'Geotagged photographs — ground truth a satellite cannot give.',
  },
];

/** Reachable, but the operator has to create an account. */
const FREE_SIGNUP = [
  {
    id: 'unwired-labs',
    name: 'Unwired Labs LocationAPI',
    url: 'https://unwiredlabs.com/',
    kind: 'cells',
    key: 'free-signup',
    status: 'reachable',
    freeTier: '10,000 requests/day',
    resolution: 'cell-level, own database',
    license: 'commercial, free tier',
    note:
      'A second cell database with a different crowd than OpenCellID. Two databases ' +
      'that place the same cell 200 m apart make both more believable; one that ' +
      'places it 20 km apart is a warning.',
    needs: 'token from unwiredlabs.com (free tier)',
  },
  {
    id: 'mapillary',
    name: 'Mapillary',
    url: 'https://www.mapillary.com/',
    kind: 'photos',
    key: 'free-signup',
    status: 'reachable',
    freeTier: 'free for non-commercial, 30k requests/day',
    resolution: 'street-level, sub-metre',
    license: 'CC BY-SA 4.0',
    note: 'Street-level photographs along roads — the only way to see a mast as a driver does.',
    needs: 'client token from mapillary.com',
  },
  {
    id: 'sentinel-hub',
    name: 'Sentinel Hub',
    url: 'https://www.sentinel-hub.com/',
    kind: 'imagery',
    key: 'free-signup',
    status: 'reachable',
    freeTier: '2,500 processing units/month',
    resolution: '10 m (Sentinel-2), multispectral',
    license: 'free tier, attribution required',
    note:
      'Multispectral: NIR and SWIR see through haze and show burn scars and new ' +
      'clearing that plain RGB hides.',
    needs: 'OAuth client id from sentinel-hub.com',
  },
  {
    id: 'nasa-earthdata',
    name: 'NASA Earthdata',
    url: 'https://urs.earthdata.nasa.gov/',
    kind: 'elevation',
    key: 'free-signup',
    status: 'reachable',
    freeTier: 'free for research and evaluation',
    resolution: 'SRTM 30 m / ASTER',
    license: 'free with attribution',
    note: 'The authoritative DEM behind the free terrain tiles, for verification.',
    needs: 'Earthdata login',
  },
  {
    id: 'openaerialmap',
    name: 'OpenAerialMap',
    url: 'https://openaerialmap.org/',
    kind: 'imagery',
    key: 'free-signup',
    status: 'reachable',
    freeTier: 'free, open',
    resolution: 'drone imagery, centimetres',
    license: 'varies per image, mostly CC BY 4.0',
    note: 'Humanitarian drone flights over areas nobody else photographs closely.',
    needs: 'API token',
  },
];

/** Reachable but the exact request matrix is not resolved here. */
const UNRESOLVED = [
  {
    id: 'nasa-gibs',
    name: 'NASA GIBS',
    url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/WMTSCapabilities.xml',
    kind: 'imagery',
    key: 'none',
    status: 'reachable',
    resolution: '250 m daily (MODIS/VIIRS)',
    license: 'public domain',
    note:
      'The capabilities document answers (5.8 MB, 400+ layers) but every tile request ' +
      'answered 400 "TILEMATRIXSET is invalid for LAYER". Esri covers the same need ' +
      'at better resolution, so this stays a note rather than a dependency.',
  },
];

/** Gone. Recorded so nobody builds on it. */
const DEAD = [
  {
    id: 'mozilla-location-service',
    name: 'Mozilla Location Service',
    url: 'https://location.services.mozilla.com/',
    kind: 'cells',
    key: 'none',
    status: 'dead',
    resolution: 'cell + wifi geolocation',
    license: 'was open',
    note: 'Shut down in 2024 — every endpoint answers 404. Its dataset is no longer available.',
  },
];

export const FREE_SOURCES = [
  ...KEYLESS_VERIFIED,
  ...FREE_SIGNUP,
  ...UNRESOLVED,
  ...DEAD,
];

/** The sources the operator should go and get, in the order they help most. */
export const RECOMMENDED_KEYS = [
  {
    id: 'unwired-labs',
    why: 'A second, independent cell database — the single biggest accuracy win available without an operator feed.',
    where: 'https://unwiredlabs.com/ (free tier, 10k requests/day)',
    effort: '5 minutes',
  },
  {
    id: 'mapillary',
    why: 'Street-level photographs: the only imagery that shows an actual mast.',
    where: 'https://www.mapillary.com/ (free token, CC BY-SA 4.0)',
    effort: '10 minutes',
  },
  {
    id: 'sentinel-hub',
    why: 'Multispectral imagery that sees through haze and shows change RGB hides.',
    where: 'https://www.sentinel-hub.com/ (free tier, 2,500 units/month)',
    effort: '15 minutes',
  },
];

/**
 * What a phone number can and cannot be told from.
 *
 * This is the sentence the whole system has to keep saying, because it is the
 * one thing every buyer of a "phone tracker" gets wrong. It lives here so the
 * API, the panel and the docs all read the same words.
 */
export const PHONE_LIMIT = Object.freeze({
  status: 'catalog',
  statement:
    'A phone number is an identifier, not a position. Only the network that ' +
    'serves the handset knows where it is, and it answers only a lawful request.',
  whatWorks:
    'A cell the handset reports (mcc-mnc-lac-cellid) is measured against the ' +
    'tower registry — that is a real fix, with an accuracy and a source.',
  whatDoesNot:
    'A number on its own resolves to a sample catalogue entry, never to a ' +
    'coordinate.',
  bridge:
    'The operator feed is the only bridge: a consented handoff from the ' +
    'carrier, which needs a legal basis and a contract, not an API key.',
});

/** Sources grouped for a status line: how many are usable without a key. */
export function sourceSummary() {
  const counts = { verified: 0, reachable: 0, dead: 0 };
  for (const source of FREE_SOURCES) counts[source.status] += 1;
  return {
    total: FREE_SOURCES.length,
    keyless: FREE_SOURCES.filter((source) => source.key === 'none').length,
    ...counts,
    needsKey: RECOMMENDED_KEYS.map((entry) => entry.id),
  };
}
