import assert from 'node:assert/strict';
import test from 'node:test';

import {
  apiKeyFromEnv,
  areaSize,
  cellFromOcid,
  cellPosition,
  cellsInArea,
  isAuthError,
  normalizeRadio,
  rangeKmFor,
  techFromRadio,
} from './opencellid.mjs';

/** A fetch stand-in that answers with one JSON body and records the URL. */
function fakeFetch(body, { status = 200 } = {}) {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () =>
        typeof body === 'string' ? body : JSON.stringify(body),
    };
  };
  impl.calls = calls;
  return impl;
}

// The shape OpenCellID actually returns — note the absence of a `status` field.
const CELL_BODY = {
  lat: -4.5461,
  lon: 136.8876,
  mcc: 510,
  mnc: 10,
  lac: 12345,
  cellid: 67890,
  averageSignalStrength: 0,
  range: 1898,
  samples: 42,
  changeable: 1,
  radio: 'LTE',
  rnc: 0,
  cid: 0,
  tac: 0,
  sid: 0,
  nid: 0,
  bid: 0,
  message: null,
};

test('a cell record is normalised into the registry shape', () => {
  const cell = cellFromOcid(CELL_BODY);
  assert.equal(cell.lat, -4.5461);
  assert.equal(cell.lon, 136.8876);
  assert.equal(cell.tech, '4G');
  assert.equal(cell.rangeKm, 1.898);
  assert.equal(cell.samples, 42);
  assert.equal(cell.cellId, 67890);
});

test('a record without coordinates is not a cell', () => {
  assert.equal(cellFromOcid({ mcc: 510, mnc: 10 }), null);
  assert.equal(cellFromOcid({ lat: 0, lon: 0, mcc: 510, mnc: 10 }), null);
  assert.equal(cellFromOcid(null), null);
});

test('radio names map to the labels the panel shows', () => {
  assert.equal(techFromRadio('LTE'), '4G');
  assert.equal(techFromRadio('NR'), '5G');
  assert.equal(techFromRadio('UMTS'), '3G');
  assert.equal(techFromRadio('GSM'), '2G');
  assert.equal(techFromRadio('NBIOT'), 'NB-IoT');
  assert.equal(techFromRadio(''), 'unknown');
  assert.equal(normalizeRadio('lte'), 'LTE');
  assert.equal(normalizeRadio('nonsense'), null);
});

test('a missing range falls back to the planning radius of the technology', () => {
  assert.equal(rangeKmFor('4G', null), 5);
  assert.equal(rangeKmFor('2G', null), 35);
  assert.equal(rangeKmFor('4G', 1898), 1.898);
});

test('a successful lookup is accepted even though it carries no status field', async () => {
  // Regression: the previous client required `status === 'ok'`, which the JSON
  // response never contains, so every real answer was thrown away.
  const fetchImpl = fakeFetch(CELL_BODY);
  const answer = await cellPosition({
    key: 'k',
    mcc: 510,
    mnc: 10,
    lac: 12345,
    cellId: 67890,
    fetchImpl,
  });
  assert.equal(answer.ok, true);
  assert.equal(answer.cell.lat, -4.5461);
  assert.equal(answer.credits, 1);
  assert.match(fetchImpl.calls[0], /\/cell\/get\?/);
  assert.match(fetchImpl.calls[0], /format=json/);
});

test('an API error in the body is a failure even with HTTP 200', async () => {
  const fetchImpl = fakeFetch(
    { error: 'API Key not known', code: 2 },
    { status: 200 },
  );
  const answer = await cellPosition({
    key: 'bad',
    mcc: 510,
    mnc: 10,
    lac: 1,
    cellId: 2,
    fetchImpl,
  });
  assert.equal(answer.ok, false);
  assert.equal(answer.error, 'API Key not known');
  assert.equal(answer.code, 2);
});

test('a 401 is reported with the body error, not a crash', async () => {
  const fetchImpl = fakeFetch('{"error":"API Key not known: ","code":2}', {
    status: 401,
  });
  const answer = await cellPosition({
    key: 'bad',
    mcc: 510,
    mnc: 10,
    lac: 1,
    cellId: 2,
    fetchImpl,
  });
  assert.equal(answer.ok, false);
  assert.equal(answer.status, 401);
});

test('an unknown cell is not an error with a zero position', async () => {
  const fetchImpl = fakeFetch({ error: 'Cell not found', code: 3 });
  const answer = await cellPosition({
    key: 'k',
    mcc: 510,
    mnc: 10,
    lac: 1,
    cellId: 2,
    fetchImpl,
  });
  assert.equal(answer.ok, false);
  assert.equal(answer.error, 'Cell not found');
});

test('a page of cells reports whether more remain', async () => {
  const cells = Array.from({ length: 50 }, (_, index) => ({
    ...CELL_BODY,
    cellid: 1000 + index,
  }));
  const fetchImpl = fakeFetch({ count: 120, cells });
  const page = await cellsInArea({
    key: 'k',
    bbox: { south: -3, west: 140, north: -2, east: 141 },
    fetchImpl,
  });
  assert.equal(page.ok, true);
  assert.equal(page.total, 120);
  assert.equal(page.cells.length, 50);
  assert.equal(page.hasMore, true);
  assert.equal(page.nextOffset, 50);
  assert.match(fetchImpl.calls[0], /limit=50/);
  assert.match(fetchImpl.calls[0], /BBOX=-3%2C140%2C-2%2C141/);
});

test('a short page ends the paging', async () => {
  const fetchImpl = fakeFetch({
    count: 3,
    cells: [CELL_BODY, CELL_BODY, CELL_BODY],
  });
  const page = await cellsInArea({
    key: 'k',
    bbox: { south: -3, west: 140, north: -2, east: 141 },
    fetchImpl,
  });
  assert.equal(page.hasMore, false);
});

test('an empty area is a successful zero', async () => {
  const fetchImpl = fakeFetch({ count: 0, cells: [] });
  const page = await cellsInArea({
    key: 'k',
    bbox: { south: 0, west: 0, north: 0.1, east: 0.1 },
    fetchImpl,
  });
  assert.equal(page.ok, true);
  assert.equal(page.total, 0);
  assert.equal(page.cells.length, 0);
});

test('the area size answers with a count', async () => {
  const fetchImpl = fakeFetch({ count: 4321 });
  const size = await areaSize({
    key: 'k',
    bbox: { south: -3, west: 140, north: -2, east: 141 },
    fetchImpl,
  });
  assert.equal(size.ok, true);
  assert.equal(size.count, 4321);
  assert.match(fetchImpl.calls[0], /getInAreaSize/);
});

test('without a key nothing is sent anywhere', async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { ok: true, status: 200, text: async () => '{}' };
  };
  const answer = await cellPosition({
    mcc: 510,
    mnc: 10,
    lac: 1,
    cellId: 2,
    fetchImpl,
  });
  assert.equal(answer.ok, false);
  assert.equal(answer.error, 'key_required');
  assert.equal(called, false, 'a missing key must not reach the network');
});

test('a non-JSON answer is reported, not thrown', async () => {
  const fetchImpl = fakeFetch('<html>rate limited</html>');
  const answer = await cellPosition({
    key: 'k',
    mcc: 510,
    mnc: 10,
    lac: 1,
    cellId: 2,
    fetchImpl,
  });
  assert.equal(answer.ok, false);
  assert.equal(answer.error, 'not_json');
});

test('the key comes from the environment and is trimmed', () => {
  assert.equal(apiKeyFromEnv({ OPENCELLID_API_KEY: '  abc  ' }), 'abc');
  assert.equal(apiKeyFromEnv({}), '');
});

test('an auth failure is recognised, so a sweep stops instead of retrying', () => {
  assert.equal(
    isAuthError({ ok: false, error: 'API Key not known: ', code: 2 }),
    true,
  );
  assert.equal(isAuthError({ ok: false, error: 'Forbidden', code: 401 }), true);
  assert.equal(
    isAuthError({ ok: false, error: 'Cell not found', code: 3 }),
    false,
  );
  assert.equal(isAuthError({ ok: true }), false);
  assert.equal(isAuthError(null), false);
});

test('an omitted filter is not sent as zero', async () => {
  // `Number(null) === 0`, so a naive check sent mcc=0 and every area answered
  // "no cells" — the bug that made the first Papua probe return nothing.
  const fetchImpl = fakeFetch({ count: 4, cells: [CELL_BODY] });
  await cellsInArea({
    key: 'k',
    bbox: { south: -2.588, west: 140.712, north: -2.572, east: 140.728 },
    fetchImpl,
  });
  const url = new URL(fetchImpl.calls[0]);
  assert.equal(url.searchParams.has('mcc'), false);
  assert.equal(url.searchParams.has('mnc'), false);
  assert.equal(url.searchParams.has('lac'), false);
});

test('a supplied filter is sent, including zero', async () => {
  const fetchImpl = fakeFetch({ count: 0, cells: [] });
  await cellsInArea({
    key: 'k',
    bbox: { south: -2.588, west: 140.712, north: -2.572, east: 140.728 },
    mcc: 510,
    mnc: 10,
    lac: 0,
    fetchImpl,
  });
  const url = new URL(fetchImpl.calls[0]);
  assert.equal(url.searchParams.get('mcc'), '510');
  assert.equal(url.searchParams.get('mnc'), '10');
  assert.equal(url.searchParams.get('lac'), '0');
});
