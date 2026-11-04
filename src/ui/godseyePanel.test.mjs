import assert from 'node:assert/strict';
import test from 'node:test';

import { GodsEyePanel, scaleDetections } from './godseyePanel.js';
import { railFixture } from './railTestFixture.mjs';

const FEED = {
  generatedAt: Date.parse('2026-10-22T09:30:00Z'),
  gold: { symbol: 'GC=F', price: 4153.9, changePct: -0.16 },
  composite: {
    impact: 1.917,
    direction: 'up',
    note: 'relevance score, not a cause',
  },
  drivers: [
    {
      id: 'inflation',
      label: 'Inflation (CPI/PCE)',
      impact: 1.38,
      direction: 'up',
    },
    { id: 'dxy', label: 'Dollar index (DXY)', impact: 1.08, direction: 'up' },
    { id: 'risk', label: 'Equity risk-off', impact: -0.33, direction: 'down' },
  ],
  news: [{ title: 'Gold rebounds' }, { title: 'Fed decision looms' }],
};

const CARD = {
  place: {
    name: 'Madrid, Community of Madrid, Spain',
    lat: 40.41678,
    lon: -3.70351,
  },
  photo: {
    provider: 'KartaView',
    id: '1001734242',
    url: 'https://cdn.kartaview.org/proc.jpg',
    license: 'CC BY-SA 4.0 (KartaView contributors)',
  },
};

const BTS_COVERAGE = {
  ok: true,
  source: 'opencellid:getInArea',
  synthetic: false,
  sites: 1200,
  totals: { sites: 1200, cells: 4300, coveredPct: 18.4 },
  provinces: [
    {
      id: 'papua',
      name: 'Papua',
      capital: 'Jayapura',
      capitalLat: -2.5337,
      capitalLon: 140.7175,
      sites: 700,
      coveredPct: 31.2,
    },
    {
      id: 'papua-pegunungan',
      name: 'Papua Pegunungan',
      capital: 'Wamena',
      capitalLat: -4.1,
      capitalLon: 138.95,
      sites: 80,
      coveredPct: 4.6,
    },
  ],
};

const VIEWSHED = {
  ok: true,
  site: { id: 'adhoc', lat: -4.1, lon: 138.95, groundM: 1676.1 },
  profile: {
    tech: '4G',
    freqMhz: 1800,
    capKm: 20,
    antennaM: 1706,
    toleranceDb: 12,
  },
  rings: [
    { azimuthDeg: 0, rangeKm: 5.4, obstructionDb: 0, obstructionAtKm: null },
    { azimuthDeg: 15, rangeKm: 12, obstructionDb: 0, obstructionAtKm: null },
  ],
  stats: { minKm: 5.4, maxKm: 12, meanKm: 8.7, blockedAzimuths: 0 },
  tilesPrefetched: 9,
};

const LOCATE = {
  ok: true,
  mode: 'target',
  query: 'Target Papua 1',
  matchType: 'name',
  source: 'local-catalog',
  synthetic: true,
  capability: 'catalog-sample',
  target: {
    id: 'target-1',
    name: 'Target Papua 1',
    lat: -2.5337,
    lon: 140.7175,
    city: 'Jayapura',
  },
  cctv: { available: true, count: 1, radiusKm: 50, cameras: [] },
};

const PHONE = {
  ok: true,
  mode: 'phone',
  source: 'phone-prefix',
  capability: 'number-metadata',
  synthetic: false,
  position: null,
  estimated: false,
  positionBasis: 'none',
  phone: {
    kind: 'mobile-number',
    input: '081234567890',
    national: '081234567890',
    e164: '+6281234567890',
    operator: 'Telkomsel',
    prefix: '0812',
    source: 'Kemenkominfo national numbering plan (08xx mobile blocks)',
    position: null,
    reason: 'A number identifies a subscription, not a place.',
  },
  detail:
    'No sample entry for this number. It is a Telkomsel number (0812), and a number carries no position — send the cell id the handset reports instead.',
};

const GROUND = {
  ok: true,
  height: {
    ok: true,
    localM: 1658,
    remoteM: 1654,
    deltaM: 4,
    verdict: 'agree',
    detail: 'Two independent DEMs agree within 4 m.',
  },
  imagery: {
    available: true,
    groundM: 2.39,
    zoom: 16,
    source: 'esri-world-imagery',
  },
};

function fixture({
  feed = FEED,
  card = CARD,
  bts = BTS_COVERAGE,
  viewshed = VIEWSHED,
  ground = GROUND,
  locate = LOCATE,
  fail = null,
} = {}) {
  const f = railFixture();
  const element = () => f.document.createElement('div');
  const elements = {
    _godseyeTabLatest: f.document.createElement('button'),
    _godseyeTabPlace: f.document.createElement('button'),
    _godseyePaneLatest: element(),
    _godseyePanePlace: element(),
    _godseyeGoldPrice: element(),
    _godseyeGoldChange: element(),
    _godseyeComposite: element(),
    _godseyeDrivers: element(),
    _godseyeRefreshBtn: f.document.createElement('button'),
    _godseyeLatestStatus: element(),
    _godseyePlaceInput: f.document.createElement('input'),
    _godseyePlaceBtn: f.document.createElement('button'),
    _godseyePlaceCard: element(),
    _godseyePlaceName: element(),
    _godseyePlaceCoords: element(),
    _godseyePlacePhoto: f.document.createElement('img'),
    _godseyePlacePhotoNote: element(),
    _godseyePlaceStatus: element(),
    _godseyeFlyBtn: f.document.createElement('button'),
    _godseyeTabVision: f.document.createElement('button'),
    _godseyePaneVision: element(),
    _godseyeVisionInput: f.document.createElement('input'),
    _godseyeVisionBtn: f.document.createElement('button'),
    _godseyeVisionFile: f.document.createElement('input'),
    _godseyeVisionStage: element(),
    _godseyeVisionImage: f.document.createElement('img'),
    _godseyeVisionOverlay: f.document.createElement('canvas'),
    _godseyeVisionList: element(),
    _godseyeVisionStatus: element(),
    _godseyeLocateInput: f.document.createElement('input'),
    _godseyeLocateBtn: f.document.createElement('button'),
    _godseyeLocateBasis: f.document.createElement('select'),
    _godseyeLocateCard: element(),
    _godseyeLocateName: element(),
    _godseyeLocateCoords: element(),
    _godseyeLocateNote: element(),
    _godseyeLocatePhoto: f.document.createElement('img'),
    _godseyeLocateGround: element(),
    _godseyeLocateList: element(),
    _godseyeLocateStatus: element(),
    _godseyeLocateFly: f.document.createElement('button'),
    _godseyeLocateNetwork: element(),
    _godseyeLocateGeo: f.document.createElement('input'),
    _godseyeLocateNetworkBtn: f.document.createElement('button'),
    _godseyeLocateConsent: element(),
    _godseyeLocateConsentRequest: f.document.createElement('button'),
    _godseyeLocateConsentLink: f.document.createElement('input'),
    _godseyeLocateConsentCopy: f.document.createElement('button'),
    _godseyeLocateConsentStatus: element(),
    _godseyeTabBts: f.document.createElement('button'),
    _godseyePaneBts: element(),
    _godseyeBtsRefresh: f.document.createElement('button'),
    _godseyeBtsViewshedInput: f.document.createElement('input'),
    _godseyeBtsViewshedBtn: f.document.createElement('button'),
    _godseyeBtsViewshed: element(),
    _godseyeBtsList: element(),
    _godseyeBtsStatus: element(),
  };
  const requests = [];
  const flights = [];
  const points = [];
  const services = {
    godseye: {
      async raw(endpoint) {
        requests.push(endpoint);
        if (fail) return { ok: false, status: fail.status, data: fail.data };
        if (endpoint.startsWith('/api/godseye/gold-impact')) {
          return { ok: true, status: 200, data: feed };
        }
        if (endpoint.startsWith('/api/godseye/bts')) {
          if (endpoint.includes('viewshed=1')) {
            return { ok: true, status: 200, data: viewshed };
          }
          return { ok: true, status: 200, data: bts };
        }
        if (endpoint.startsWith('/api/godseye/verify')) {
          return { ok: true, status: 200, data: ground };
        }
        if (endpoint.startsWith('/api/godseye/locate')) {
          return { ok: true, status: 200, data: locate };
        }
        return { ok: true, status: 200, data: card };
      },
    },
  };
  return {
    ...f,
    elements,
    requests,
    flights,
    points,
    services,
    panel: new GodsEyePanel({
      elements,
      services,
      document: f.document,
      flyTo: (query) => flights.push(query),
      flyToPoint: (lat, lon, altitude) => points.push({ lat, lon, altitude }),
    }),
  };
}

test('the panel shows the gold quote and one row per driver', async () => {
  const f = fixture();
  await f.panel.connect();
  assert.equal(f.elements._godseyeGoldPrice.textContent, '4153.90');
  assert.equal(f.elements._godseyeGoldChange.textContent, '-0.16%');
  assert.match(f.elements._godseyeComposite.textContent, /1\.917/);
  assert.equal(f.elements._godseyeDrivers.children.length, 3);
  const first = f.elements._godseyeDrivers.children[0];
  assert.equal(first.className, 'godseye-driver');
  assert.equal(first.children[1].textContent, 'Inflation (CPI/PCE)');
  assert.equal(first.children[2].textContent, '1.38');
  assert.equal(first.children[0].textContent, '▲');
  assert.match(f.elements._godseyeComposite.textContent, /1\.917 ▲/);
  assert.match(f.elements._godseyeLatestStatus.textContent, /2 headlines/);
});

test('an empty feed says so instead of showing nothing', async () => {
  const f = fixture({ feed: { ...FEED, drivers: [] } });
  await f.panel.connect();
  assert.equal(f.elements._godseyeDrivers.children.length, 1);
  assert.equal(
    f.elements._godseyeDrivers.children[0].textContent,
    'NO HEADLINES',
  );
});

test('a failed feed reports the reason in the status line', async () => {
  const f = fixture({
    fail: { status: 502, data: { detail: 'upstream is down' } },
  });
  await f.panel.connect();
  assert.equal(f.elements._godseyeLatestStatus.textContent, 'upstream is down');
  assert.equal(f.elements._godseyeDrivers.children.length, 0);
});

test('the place tab fills the card and flies to the place', async () => {
  const f = fixture();
  await f.panel.connect();
  f.elements._godseyeTabPlace.dispatchEvent(new Event('click'));
  assert.equal(f.elements._godseyePanePlace.hidden, false);
  assert.equal(f.elements._godseyePaneLatest.hidden, true);
  f.elements._godseyePlaceInput.value = 'Madrid';
  f.elements._godseyePlaceBtn.dispatchEvent(new Event('click'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    f.elements._godseyePlaceName.textContent,
    'Madrid, Community of Madrid, Spain',
  );
  assert.equal(
    f.elements._godseyePlaceCoords.textContent,
    '40.41678, -3.70351',
  );
  assert.equal(
    f.elements._godseyePlacePhoto.src,
    'https://cdn.kartaview.org/proc.jpg',
  );
  assert.equal(f.elements._godseyePlaceCard.hidden, false);
  f.elements._godseyeFlyBtn.click();
  assert.deepEqual(f.flights, ['Madrid, Community of Madrid, Spain']);
});

test('a place without street coverage says so', async () => {
  const f = fixture({
    card: { ...CARD, photo: { available: false, reason: 'no_coverage' } },
  });
  await f.panel.connect();
  f.elements._godseyePlaceInput.value = 'Ubud';
  f.elements._godseyePlaceBtn.dispatchEvent(new Event('click'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    f.elements._godseyePlacePhotoNote.textContent,
    'NO STREET PHOTO HERE',
  );
  assert.equal(f.elements._godseyePlacePhoto.hidden, true);
});

test('an empty place query asks for a name instead of calling the server', async () => {
  const f = fixture();
  await f.panel.connect();
  const before = f.requests.length;
  f.elements._godseyePlaceBtn.dispatchEvent(new Event('click'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.requests.length, before);
  assert.equal(
    f.elements._godseyePlaceStatus.textContent,
    'ENTER A PLACE NAME',
  );
});

test('scaled detections place the box on the displayed image', () => {
  const rects = scaleDetections(
    {
      people: [
        {
          bbox: [0.1, 0.2, 0.25, 0.5],
          activity: 'standing',
          confidence: 0.8,
        },
      ],
      vehicles: [
        { bbox: [0.5, 0.5, 0.25, 0.25], type: 'car', confidence: 0.6 },
      ],
    },
    { naturalWidth: 1000, naturalHeight: 500, viewWidth: 500, viewHeight: 250 },
  );
  assert.equal(rects.length, 2);
  assert.equal(rects[0].kind, 'person');
  assert.equal(rects[0].x, 50);
  assert.equal(rects[0].y, 50);
  assert.equal(rects[0].width, 125);
  assert.equal(rects[0].height, 125);
  assert.equal(rects[1].kind, 'vehicle');
  assert.equal(scaleDetections({ people: [] }, {}).length, 0);
});

test('the vision tab analyses an image and lists what was found', async () => {
  const f = fixture();
  f.services.godseye.raw = async (endpoint, options) => {
    f.requests.push(endpoint);
    assert.equal(endpoint, '/api/openai/vision');
    assert.equal(JSON.parse(options.body).scene, true);
    return {
      ok: true,
      status: 200,
      data: {
        detections: {
          parsed: true,
          people: [
            {
              bbox: [0.1, 0.2, 0.25, 0.5],
              holding: ['phone'],
              activity: 'standing',
              confidence: 0.8,
            },
          ],
          vehicles: [],
        },
      },
    };
  };
  await f.panel.connect();
  f.elements._godseyeTabVision.dispatchEvent(new Event('click'));
  assert.equal(f.elements._godseyePaneVision.hidden, false);
  assert.equal(f.elements._godseyePanePlace.hidden, true);
  f.elements._godseyeVisionInput.value = 'https://example.org/street.jpg';
  f.elements._godseyeVisionBtn.dispatchEvent(new Event('click'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    f.elements._godseyeVisionImage.src,
    'https://example.org/street.jpg',
  );
  assert.equal(f.elements._godseyeVisionList.children.length, 1);
  const row = f.elements._godseyeVisionList.children[0];
  assert.equal(row.children[0].textContent, 'PERSON');
  assert.match(row.children[1].textContent, /standing/);
  assert.match(row.children[1].textContent, /phone/);
  assert.equal(row.children[2].textContent, '0.80');
  assert.match(f.elements._godseyeVisionStatus.textContent, /1 PEOPLE/);
});

test('the vision tab reports an empty answer instead of nothing', async () => {
  const f = fixture();
  f.services.godseye.raw = async () => ({
    ok: true,
    status: 200,
    data: { detections: { parsed: true, people: [], vehicles: [] } },
  });
  await f.panel.connect();
  f.elements._godseyeVisionInput.value = 'https://example.org/empty.jpg';
  f.elements._godseyeVisionBtn.dispatchEvent(new Event('click'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.elements._godseyeVisionList.children.length, 1);
  assert.equal(
    f.elements._godseyeVisionList.children[0].textContent,
    'NO DETECTIONS',
  );
});

test('the BTS tab lists each province with its coverage', async () => {
  const f = fixture();
  await f.panel.connect();
  f.elements._godseyeTabBts.dispatchEvent(new Event('click'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.elements._godseyePaneBts.hidden, false);
  assert.equal(f.elements._godseyePaneLatest.hidden, true);
  // Best-covered province first: the operator reads top-down.
  const rows = f.elements._godseyeBtsList.children;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].children[0].children[0].textContent, 'Papua');
  assert.equal(rows[0].children[0].children[2].textContent, '31.2%');
  assert.equal(rows[1].children[0].children[0].textContent, 'Papua Pegunungan');
  assert.match(
    f.elements._godseyeBtsStatus.textContent,
    /1200 SITES · COVERAGE 18\.4% · SOURCE opencellid:getInArea/,
  );
});

test('a province row flies the globe to its capital', async () => {
  const f = fixture();
  await f.panel.connect();
  f.elements._godseyeTabBts.dispatchEvent(new Event('click'));
  await new Promise((resolve) => setImmediate(resolve));
  f.elements._godseyeBtsList.children[1].children[0].click();
  assert.deepEqual(f.points.at(-1), {
    lat: -4.1,
    lon: 138.95,
    altitude: 120000,
  });
});

test('a seed registry says it is synthetic instead of implying real data', async () => {
  const f = fixture({
    bts: {
      ...BTS_COVERAGE,
      source: 'local-seed',
      synthetic: true,
      totals: { sites: 42, coveredPct: 3.1 },
      provinces: [
        {
          id: 'papua',
          name: 'Papua',
          capital: 'Jayapura',
          sites: 8,
          coveredPct: 2.2,
        },
      ],
    },
  });
  await f.panel.connect();
  f.elements._godseyeTabBts.dispatchEvent(new Event('click'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(f.elements._godseyeBtsStatus.textContent, /SYNTHETIC/);
  assert.match(f.elements._godseyeBtsStatus.textContent, /42 SITES/);
  // A province without capital coordinates cannot fly, so it is not clickable.
  assert.equal(
    f.elements._godseyeBtsList.children[0].children[0].disabled,
    true,
  );
});

test('a person query without a legal basis never leaves the panel', async () => {
  const f = fixture();
  await f.panel.connect();
  f.elements._godseyeLocateInput.value = 'Target Papua 1';
  f.elements._godseyeLocateBtn.dispatchEvent(new Event('click'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    f.elements._godseyeLocateStatus.textContent,
    'LEGAL BASIS REQUIRED',
  );
  assert.equal(
    f.requests.filter((url) => url.startsWith('/api/godseye/locate')).length,
    0,
    'no request was made',
  );
});

test('with a basis the query goes out and carries it', async () => {
  const f = fixture();
  await f.panel.connect();
  f.elements._godseyeLocateInput.value = 'Target Papua 1';
  const option = f.document.createElement('option');
  option.value = 'consent';
  f.elements._godseyeLocateBasis.append(option);
  f.elements._godseyeLocateBasis.value = 'consent';
  f.elements._godseyeLocateBtn.dispatchEvent(new Event('click'));
  await new Promise((resolve) => setImmediate(resolve));
  const call = f.requests.find((url) => url.startsWith('/api/godseye/locate'));
  assert.ok(call, 'the query was sent');
  assert.match(call, /legalBasis=consent/);
});

test('a phone number answers with its operator and no invented position', async () => {
  const f = fixture({ locate: PHONE });
  await f.panel.connect();
  f.elements._godseyeLocateInput.value = '081234567890';
  const option = f.document.createElement('option');
  option.value = 'consent';
  f.elements._godseyeLocateBasis.append(option);
  f.elements._godseyeLocateBasis.value = 'consent';
  f.elements._godseyeLocateBtn.dispatchEvent(new Event('click'));
  await new Promise((resolve) => setImmediate(resolve));

  // The card has to appear: an empty card plus "unavailable" is exactly the
  // failure that reads as "the phone check does not exist".
  assert.equal(f.elements._godseyeLocateCard.hidden, false);
  assert.equal(f.elements._godseyeLocateName.textContent, 'Telkomsel');
  assert.equal(f.elements._godseyeLocateCoords.textContent, '+6281234567890');
  assert.match(f.elements._godseyeLocateStatus.textContent, /NUMBER METADATA/);
  const rows = [...f.elements._godseyeLocateList.children].map((li) =>
    [...li.children].map((span) => span.textContent).join(' '),
  );
  assert.ok(
    rows.some((row) => row.includes('0812')),
    'the prefix is a fact',
  );
  assert.ok(
    rows.some((row) => row.includes('NO POSITION')),
    'the absence of a position is stated, not implied',
  );
  assert.ok(
    rows.some((row) => row.includes('mcc-mnc-lac-cellid')),
    'the card names the only input that yields a real coordinate',
  );
  // Nothing to fly to, so the button is not offered.
  assert.equal(f.elements._godseyeLocateFly.hidden, true);
});

test('a phone answer never pretends to have a coordinate', async () => {
  const f = fixture({ locate: PHONE });
  await f.panel.connect();
  f.elements._godseyeLocateInput.value = '081234567890';
  const option = f.document.createElement('option');
  option.value = 'consent';
  f.elements._godseyeLocateBasis.append(option);
  f.elements._godseyeLocateBasis.value = 'consent';
  f.elements._godseyeLocateBtn.dispatchEvent(new Event('click'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.panel._located, null);
});

test('the terrain field answers with the ground height and the real ranges', async () => {
  const f = fixture();
  await f.panel.connect();
  f.elements._godseyeBtsViewshedInput.value = '-4.10,138.95';
  f.elements._godseyeBtsViewshedBtn.dispatchEvent(new Event('click'));
  await new Promise((resolve) => setImmediate(resolve));
  const box = f.elements._godseyeBtsViewshed;
  assert.equal(box.hidden, false);
  const row = box.children[0];
  assert.equal(row.children[0].textContent, 'GROUND 1676 m');
  assert.equal(row.children[1].textContent, 'MEDIAN 12 km');
  assert.equal(row.children[2].textContent, 'MAX 12 km');
  assert.match(
    box.children[1].textContent,
    /2 azimuths · MEAN 8.7 km · 9 tiles/,
  );
  assert.match(
    f.requests.find((url) => url.includes('viewshed=1')),
    /lat=-4.1&lon=138.95/,
  );
});

test('a terrain answer flies the globe to that point', async () => {
  const f = fixture();
  await f.panel.connect();
  f.elements._godseyeBtsViewshedInput.value = '-4.10,138.95';
  f.elements._godseyeBtsViewshedBtn.dispatchEvent(new Event('click'));
  await new Promise((resolve) => setImmediate(resolve));
  f.elements._godseyeBtsViewshed.children[0].click();
  assert.deepEqual(f.points.at(-1), {
    lat: -4.1,
    lon: 138.95,
    altitude: 60000,
  });
});

test('a coordinate that is not one is refused before any request', async () => {
  const f = fixture();
  await f.panel.connect();
  f.elements._godseyeBtsViewshedInput.value = 'Wamena';
  f.elements._godseyeBtsViewshedBtn.dispatchEvent(new Event('click'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    f.elements._godseyeBtsViewshed.children[0].textContent,
    'ENTER A COORDINATE',
  );
  assert.equal(
    f.requests.filter((url) => url.includes('viewshed=1')).length,
    0,
    'no request was made',
  );
});

test('a flat-earth answer says so instead of looking like a real reading', async () => {
  const f = fixture({
    viewshed: {
      ...VIEWSHED,
      site: { id: 'adhoc', lat: 0, lon: 0, groundM: 0 },
      rings: [
        { azimuthDeg: 0, rangeKm: 20, obstructionDb: 0, obstructionAtKm: null },
        {
          azimuthDeg: 15,
          rangeKm: 20,
          obstructionDb: 0,
          obstructionAtKm: null,
        },
      ],
      stats: { minKm: 20, maxKm: 20, meanKm: 20, blockedAzimuths: 0 },
    },
  });
  await f.panel.connect();
  f.elements._godseyeBtsViewshedInput.value = '0,0';
  f.elements._godseyeBtsViewshedBtn.dispatchEvent(new Event('click'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(
    f.elements._godseyeBtsViewshed.children[1].textContent,
    /FLAT EARTH/,
  );
  assert.equal(
    f.elements._godseyeBtsViewshed.children[0].children[0].textContent,
    'GROUND 0 m',
  );
});

test('a located answer is shown with the real photograph of the point', async () => {
  const f = fixture();
  await f.panel.connect();
  f.elements._godseyeLocateInput.value = 'Target Papua 1';
  const option = f.document.createElement('option');
  option.value = 'consent';
  f.elements._godseyeLocateBasis.append(option);
  f.elements._godseyeLocateBasis.value = 'consent';
  f.elements._godseyeLocateBtn.dispatchEvent(new Event('click'));
  await new Promise((resolve) => setImmediate(resolve));
  const photo = f.elements._godseyeLocatePhoto;
  assert.equal(photo.hidden, false, 'the photograph is shown');
  assert.match(photo.src, /lat=-2\.5\d+&lon=140\.\d+&zoom=16/);
  // Decorative: the coordinate line above already names the point, so the
  // image adds nothing for a screen reader beyond what is said.
  assert.ok(!photo.getAttribute('alt'));
});

test('the ground line confirms a height two DEMs agree on', async () => {
  const f = fixture();
  await f.panel.connect();
  f.elements._godseyeLocateInput.value = 'Target Papua 1';
  const option = f.document.createElement('option');
  option.value = 'consent';
  f.elements._godseyeLocateBasis.append(option);
  f.elements._godseyeLocateBasis.value = 'consent';
  f.elements._godseyeLocateBtn.dispatchEvent(new Event('click'));
  await new Promise((resolve) => setImmediate(resolve));
  const ground = f.elements._godseyeLocateGround;
  assert.equal(ground.hidden, false);
  assert.match(
    ground.textContent,
    /GROUND 1658 m · HEIGHT CONFIRMED · 2\.39 m\/px/,
  );
});

test('a disputed height says so instead of showing a confident number', async () => {
  const f = fixture({
    ground: {
      ...GROUND,
      height: {
        ok: false,
        localM: 1658,
        remoteM: 900,
        deltaM: 758,
        verdict: 'disagree',
        detail: 'The two DEMs differ by 758 m.',
      },
    },
  });
  await f.panel.connect();
  f.elements._godseyeLocateInput.value = 'Target Papua 1';
  const option = f.document.createElement('option');
  option.value = 'consent';
  f.elements._godseyeLocateBasis.append(option);
  f.elements._godseyeLocateBasis.value = 'consent';
  f.elements._godseyeLocateBtn.dispatchEvent(new Event('click'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(f.elements._godseyeLocateGround.textContent, /HEIGHT DISPUTED/);
  assert.match(f.elements._godseyeLocateGround.textContent, /GROUND 1658 m/);
});

test('a failed ground check leaves the answer without a photograph', async () => {
  const f = fixture({
    ground: { ok: false, height: {}, imagery: { available: false } },
  });
  await f.panel.connect();
  f.elements._godseyeLocateInput.value = 'Target Papua 1';
  const option = f.document.createElement('option');
  option.value = 'consent';
  f.elements._godseyeLocateBasis.append(option);
  f.elements._godseyeLocateBasis.value = 'consent';
  f.elements._godseyeLocateBtn.dispatchEvent(new Event('click'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    f.elements._godseyeLocatePhoto.hidden,
    true,
    'no picture is invented',
  );
  assert.equal(
    f.elements._godseyeLocateGround.hidden,
    true,
    'no height is invented',
  );
});

test('the cctv camera row marks a live ATCS stream and offers a player button', () => {
  const f = fixture();
  const live = f.panel._cameraRow({
    id: 'atcs-bjm-1',
    name: 'Simpang Mentari',
    city: 'Banjarmasin',
    type: 'traffic',
    lat: -3.324434,
    lon: 114.591027,
    distance: 1.25,
    live: true,
    streamUrl: 'https://atcs.banjarmasinkota.go.id/stream/x/index.m3u8',
  });
  const badge = live.querySelector('.godseye-live-badge');
  assert.ok(badge, 'live badge is rendered');
  assert.equal(badge.hidden, false, 'live badge is visible');
  assert.ok(
    live.querySelector('.godseye-stream-btn'),
    'stream player button is rendered',
  );
  // Clicking the row flies the globe; the player button must not.
  const rowButton = live.querySelector('.godseye-camera');
  rowButton.click();
  assert.equal(f.points.length, 1, 'row click flies the globe');

  const dead = f.panel._cameraRow({
    id: 'atcs-bjr-9',
    name: 'Offline camera',
    city: 'Banjar',
    type: 'traffic',
    lat: -7.36,
    lon: 108.54,
    live: false,
  });
  assert.equal(dead.querySelector('.godseye-live-badge').hidden, true);
  assert.equal(dead.querySelector('.godseye-stream-btn'), null);
});

const PHONE_NETWORK = {
  ...PHONE,
  query: '081234567890',
  legalBasis: 'consent',
  network: {
    around: { lat: -2.55, lon: 140.7 },
    operator: 'Telkomsel',
    radiusKm: 30,
    basis: 'caller-supplied-point',
    towers: [
      {
        id: 'bts-1',
        name: 'Jayapura Kota · Telkomsel 4G',
        lat: -2.5337,
        lon: 140.7175,
        tech: '4G',
        rangeKm: 5,
        cells: 2,
        samples: 26,
        distanceKm: 0.11,
        bearing: 180,
      },
      {
        id: 'bts-2',
        name: 'Waena · Telkomsel 3G',
        lat: -2.59,
        lon: 140.64,
        tech: '3G',
        rangeKm: 10,
        cells: 0,
        samples: null,
        distanceKm: 5.2,
        bearing: 240,
      },
    ],
  },
};

test('a phone answer with a supplied point lists the operator towers and offers a flight', async () => {
  const f = fixture({ locate: PHONE_NETWORK });
  await f.panel.connect();
  f.elements._godseyeLocateInput.value = '081234567890';
  const option = f.document.createElement('option');
  option.value = 'consent';
  f.elements._godseyeLocateBasis.append(option);
  f.elements._godseyeLocateBasis.value = 'consent';
  f.elements._godseyeLocateBtn.dispatchEvent(new Event('click'));
  await new Promise((resolve) => setImmediate(resolve));

  const text = [...f.elements._godseyeLocateList.children]
    .map((li) => [...li.children].map((span) => span.textContent).join(' '))
    .join('\n');
  assert.match(text, /0\.11 km · 180°/);
  assert.match(text, /Jayapura Kota · Telkomsel 4G/);
  assert.match(text, /5\.2 km · 240°/);
  // Nearest tower is flyable, and the label carries the distance.
  assert.equal(f.elements._godseyeLocateFly.hidden, false);
  assert.match(f.elements._godseyeLocateFly.textContent, /0\.11 km/);
  assert.deepEqual(f.panel._located, {
    lat: -2.5337,
    lon: 140.7175,
    name: 'Jayapura Kota · Telkomsel 4G',
  });
  // The honest label stays on the card.
  assert.match(
    f.elements._godseyeLocateNote.textContent,
    /NETWORK CONTEXT, NOT A POSITION/,
  );
});

test('a phone answer without a point offers the network-context action', async () => {
  const f = fixture({
    locate: { ...PHONE, network: null, networkHint: 'Add ?lat=...&lon=...' },
  });
  await f.panel.connect();
  f.elements._godseyeLocateInput.value = '081234567890';
  const option = f.document.createElement('option');
  option.value = 'consent';
  f.elements._godseyeLocateBasis.append(option);
  f.elements._godseyeLocateBasis.value = 'consent';
  f.elements._godseyeLocateBtn.dispatchEvent(new Event('click'));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(
    f.elements._godseyeLocateNetwork.hidden,
    false,
    'the action is offered',
  );
  assert.match(
    f.elements._godseyeLocateStatus.textContent,
    /lat=\.\.\.&lon=\.\.\./,
  );
  assert.equal(
    f.elements._godseyeLocateFly.hidden,
    true,
    'nothing to fly to yet',
  );
  assert.equal(f.panel._located, null);
});

test('a malformed context point refuses instead of guessing', async () => {
  const f = fixture({ locate: PHONE_NETWORK });
  await f.panel.connect();
  await f.panel._locateTarget();
  f.elements._godseyeLocateGeo.value = 'not-a-point';
  f.elements._godseyeLocateNetworkBtn.dispatchEvent(new Event('click'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(
    f.elements._godseyeLocateStatus.textContent,
    /ENTER LATITUDE AND LONGITUDE/,
  );
  const locateCalls = f.requests.filter(
    (url) => url.startsWith('/api/godseye/locate') && url.includes('lat='),
  );
  assert.equal(locateCalls.length, 0, 'no request with a bogus point');
});

test('the consent widget offers the request button on every phone answer', async () => {
  const f = fixture({ locate: PHONE });
  await f.panel.connect();
  f.elements._godseyeLocateInput.value = '081340934688';
  const opt = f.document.createElement('option');
  opt.value = 'consent';
  f.elements._godseyeLocateBasis.append(opt);
  f.elements._godseyeLocateBasis.value = 'consent';
  f.elements._godseyeLocateBtn.dispatchEvent(new Event('click'));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(
    f.elements._godseyeLocateConsent.hidden,
    false,
    'the consent widget is unhidden for a phone answer',
  );
  assert.equal(
    f.elements._godseyeLocateConsentCopy.disabled,
    true,
    'copy button waits for a created link',
  );
});

test('requesting a consent link creates the link, enables copy, and polls until collected', async () => {
  let pollCount = 0;
  const f = fixture({ locate: PHONE });
  // Intercept the location-request endpoints in the test services.
  const baseRaw = f.services.godseye.raw;
  f.services.godseye.raw = async (endpoint, options = {}) => {
    if (
      endpoint === '/api/godseye/location-request' &&
      options.method === 'POST'
    ) {
      return {
        ok: true,
        status: 200,
        data: {
          id: 'req12345',
          secret: 'sec98765',
          link: 'http://localhost:4173/api/godseye/locate-consent/tok555',
          expiresAt: Date.now() + 60_000,
        },
      };
    }
    if (endpoint.startsWith('/api/godseye/location-request/req12345')) {
      pollCount += 1;
      if (pollCount === 1) {
        return { ok: true, status: 200, data: { status: 'pending' } };
      }
      return {
        ok: true,
        status: 200,
        data: {
          status: 'collected',
          numberMasked: '0813*****688',
          fix: {
            lat: -2.55,
            lon: 140.7,
            accuracyM: 15,
            collectedAt: Date.now(),
          },
        },
      };
    }
    return baseRaw(endpoint, options);
  };
  await f.panel.connect();
  f.elements._godseyeLocateInput.value = '081340934688';
  const opt = f.document.createElement('option');
  opt.value = 'consent';
  f.elements._godseyeLocateBasis.append(opt);
  f.elements._godseyeLocateBasis.value = 'consent';
  f.elements._godseyeLocateBtn.dispatchEvent(new Event('click'));
  await new Promise((resolve) => setImmediate(resolve));

  // User taps REQUEST LOCATION (CONSENT LINK).
  f.elements._godseyeLocateConsentRequest.dispatchEvent(new Event('click'));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(
    f.elements._godseyeLocateConsentLink.value,
    'http://localhost:4173/api/godseye/locate-consent/tok555',
  );
  assert.equal(f.elements._godseyeLocateConsentCopy.disabled, false);
  assert.match(
    f.elements._godseyeLocateConsentStatus.textContent,
    /SHARE LINK AND WAIT/,
  );

  // First poll: pending.
  await f.panel._pollConsentStatus();
  assert.equal(f.elements._godseyeLocateFly.hidden, true);

  // Second poll: fix arrives. The panel flies, renders the real coordinate.
  await f.panel._pollConsentStatus();
  assert.equal(f.elements._godseyeLocateFly.hidden, false);
  assert.deepEqual(f.panel._located, {
    lat: -2.55,
    lon: 140.7,
    name: '0813*****688 · -2.55000, 140.70000',
  });
  assert.match(
    f.elements._godseyeLocateCoords.textContent,
    /-2\.55000, 140\.70000/,
  );
  assert.match(f.elements._godseyeLocateNote.textContent, /15 M/);
  assert.match(f.elements._godseyeLocateStatus.textContent, /LOCATION SHARED/);

  f.panel.destroy();
});
