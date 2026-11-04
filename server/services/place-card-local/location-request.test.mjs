import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  clearLocationRequests,
  collectLocationFix,
  createLocationRequest,
  getLocationRequest,
  maskNumber,
  normalizeNumber,
  openRequestCount,
} from './location-request.mjs';
import { renderConsentPage } from './location-consent-page.mjs';
import {
  operatorLocationProvider,
  queryOperatorLocation,
} from './operator-location.mjs';

/** Each test gets its own store file. */
function tempStore(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gev-lr-'));
  const file = path.join(dir, 'requests.json');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return file;
}

test('maskNumber keeps the edges and stars the middle', () => {
  assert.equal(maskNumber('081340934688'), '0813*****688');
  assert.equal(maskNumber('+6281340934688'), '6281******688');
  assert.equal(maskNumber('12345'), '12345');
});

test('normalizeNumber accepts E.164 and national forms, rejects garbage', () => {
  assert.equal(normalizeNumber('0813 4093 4688'), '081340934688');
  assert.equal(normalizeNumber('+62-813-4093-4688'), '+6281340934688');
  assert.equal(normalizeNumber('not-a-number'), null);
  assert.equal(normalizeNumber('123'), null);
});

test('a request needs a number and a legal basis', async (t) => {
  const file = tempStore(t);
  const badNumber = await createLocationRequest({
    number: 'abc',
    legalBasis: 'consent',
    file,
  });
  assert.equal(badNumber.ok, false);
  assert.equal(badNumber.error, 'invalid_number');
  const noBasis = await createLocationRequest({ number: '081340934688', file });
  assert.equal(noBasis.ok, false);
  assert.equal(noBasis.error, 'legal_basis_required');
});

test('the flow: create → collect → requester reads exactly one fix', async (t) => {
  const file = tempStore(t);
  const created = await createLocationRequest({
    number: '081340934688',
    legalBasis: 'consent',
    file,
    now: 1_700_000_000_000,
  });
  assert.equal(created.ok, true);
  assert.ok(created.id.length >= 8);
  assert.ok(created.link.includes('/api/godseye/locate-consent/'));
  assert.equal(openRequestCount({ file, now: 1_700_000_000_000 }), 1);

  // Requester polls before the fix: pending, no coordinate.
  const pending = await getLocationRequest(created.id, created.secret, {
    file,
    now: 1_700_000_000_100,
  });
  assert.equal(pending.status, 'pending');
  assert.equal(pending.fix, undefined);
  assert.equal(pending.numberMasked, '0813*****688');

  // Wrong secret never reads a coordinate.
  assert.equal(
    await getLocationRequest(created.id, 'nope', {
      file,
      now: 1_700_000_000_100,
    }),
    null,
  );

  // The target's browser posts a fix through the token in the URL.
  const collected = await collectLocationFix(
    created.id,
    created.token,
    { lat: -2.55, lon: 140.7, accuracyM: 40 },
    {
      file,
      now: 1_700_000_001_000,
    },
  );
  assert.equal(collected.ok, true);

  const after = await getLocationRequest(created.id, created.secret, {
    file,
    now: 1_700_000_001_100,
  });
  assert.equal(after.status, 'collected');
  assert.deepEqual(after.fix, {
    lat: -2.55,
    lon: 140.7,
    accuracyM: 40,
    collectedAt: 1_700_000_001_000,
  });

  // One-time: a second submit returns nothing.
  const second = await collectLocationFix(
    created.id,
    created.token,
    { lat: -1, lon: 139 },
    { file, now: 1_700_000_002_000 },
  );
  assert.equal(second.ok, false);
  assert.equal(second.error, 'already_collected');
  assert.equal(openRequestCount({ file, now: 1_700_000_002_000 }), 0);
});

test('an expired request can be collected no longer, and is reported as such', async (t) => {
  const file = tempStore(t);
  const created = await createLocationRequest({
    number: '081340934688',
    legalBasis: 'public-task',
    file,
    now: 0,
    ttlMs: 60_000,
  });
  const late = await collectLocationFix(
    created.id,
    created.token,
    { lat: 0, lon: 0, accuracyM: 10 },
    { file, now: 120_000 },
  );
  assert.equal(late.ok, false);
  assert.equal(late.error, 'expired');
  const view = await getLocationRequest(created.id, created.secret, {
    file,
    now: 120_000,
  });
  assert.equal(view.status, 'expired');
});

test('a bogus token never collects, and a bogus fix is refused', async (t) => {
  const file = tempStore(t);
  const created = await createLocationRequest({
    number: '081340934688',
    legalBasis: 'consent',
    file,
  });
  const bogus = await collectLocationFix(
    created.id,
    'wrong-token',
    { lat: 0, lon: 0 },
    { file },
  );
  assert.equal(bogus.ok, false);
  assert.equal(bogus.error, 'invalid_token');
  const badFix = await collectLocationFix(
    created.id,
    created.token,
    { lat: 999, lon: 0 },
    { file },
  );
  assert.equal(badFix.ok, false);
  assert.equal(badFix.error, 'invalid_fix');
});

test('the consent page names the number and posts only on tap', () => {
  const html = renderConsentPage({
    numberMasked: '0813*****688',
    legalBasis: 'consent',
    expiresAt: Date.now() + 60_000,
  });
  assert.match(html, /0813\*\*\*\*\*688/);
  assert.match(html, /SHARE MY POSITION/);
  assert.match(html, /enableHighAccuracy/);
  assert.doesNotMatch(html, /lat:\s*-?\d/);
});

test('operatorLocationProvider answers honestly when unconfigured', () => {
  const off = operatorLocationProvider({});
  assert.equal(off.available, false);
  assert.equal(off.reason, 'unknown-provider');
  const noKey = operatorLocationProvider({
    GODSEYE_LOCATION_PROVIDER: 'vonage',
  });
  assert.equal(noKey.available, false);
  assert.equal(noKey.reason, 'not-configured');
  assert.match(noKey.hint, /register/i);
  const ready = operatorLocationProvider({
    GODSEYE_LOCATION_PROVIDER: 'vonage',
    VONAGE_API_TOKEN: 'abc',
  });
  assert.equal(ready.available, true);
});

test('queryOperatorLocation maps a Vonage-style circle', async () => {
  const seen = {};
  const fetchImpl = async (url, init) => {
    seen.url = url;
    seen.body = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({
        location: {
          lat: -2.55,
          lon: 140.7,
          radius: 1200,
          last_location_time: '2026-11-04T05:00:00Z',
        },
      }),
    };
  };
  const result = await queryOperatorLocation({
    e164: '+6281340934688',
    env: { GODSEYE_LOCATION_PROVIDER: 'vonage', VONAGE_API_TOKEN: 'tok' },
    fetchImpl,
  });
  assert.equal(result.ok, true);
  assert.equal(result.lat, -2.55);
  assert.equal(result.lon, 140.7);
  assert.equal(result.accuracyM, 1200);
  assert.equal(seen.body.phoneNumber, '+6281340934688');
  assert.equal(
    seen.url,
    'https://api-eu.vonage.com/network-location/v0.1/retrieval',
  );
});

test('queryOperatorLocation reports provider errors without crashing', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 403,
    json: async () => ({ message: 'operator declined this number' }),
  });
  const result = await queryOperatorLocation({
    e164: '+6281340934688',
    env: { GODSEYE_LOCATION_PROVIDER: 'vonage', VONAGE_API_TOKEN: 'tok' },
    fetchImpl,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'provider_error');
  assert.match(result.detail, /declined/);
});
