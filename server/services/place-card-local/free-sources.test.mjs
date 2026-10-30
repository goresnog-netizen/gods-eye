import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FREE_SOURCES,
  PHONE_LIMIT,
  RECOMMENDED_KEYS,
  sourceSummary,
} from './free-sources.mjs';

const HTTPS = /^https:\/\//;

test('every source says whether it was proven or only reached', () => {
  for (const source of FREE_SOURCES) {
    assert.ok(
      ['verified', 'reachable', 'dead'].includes(source.status),
      `${source.id} has a status`,
    );
    assert.ok(source.license, `${source.id} names its licence`);
    assert.ok(source.note, `${source.id} says what it is for`);
  }
});

test('the keyless list is the one that was actually used here', () => {
  const keyless = FREE_SOURCES.filter((source) => source.key === 'none');
  assert.ok(
    keyless.length >= 5,
    'Esri, two Open-Meteo endpoints, RainViewer, Wikimedia',
  );
  for (const source of keyless) {
    if (source.status === 'verified') {
      assert.ok(HTTPS.test(source.url), `${source.id} was fetched over TLS`);
    }
  }
});

test('a dead service is recorded, not quietly dropped', () => {
  const mls = FREE_SOURCES.find(
    (source) => source.id === 'mozilla-location-service',
  );
  assert.ok(mls, 'the shut-down geolocation service is still listed');
  assert.equal(mls.status, 'dead');
  assert.match(mls.note, /Shut down/);
});

test('the recommended keys are ordered by how much they help', () => {
  assert.equal(
    RECOMMENDED_KEYS[0].id,
    'unwired-labs',
    'a second cell database first',
  );
  for (const entry of RECOMMENDED_KEYS) {
    assert.ok(HTTPS.test(entry.where), `${entry.id} says where to sign up`);
    assert.ok(entry.why.length > 20, `${entry.id} explains the gain`);
  }
});

test('the summary counts what is usable without paying', () => {
  const summary = sourceSummary();
  assert.equal(summary.total, FREE_SOURCES.length);
  assert.ok(summary.keyless > 0);
  assert.ok(summary.verified > 0);
  assert.equal(summary.needsKey.length, RECOMMENDED_KEYS.length);
});

test('the phone limit is stated the same way everywhere', () => {
  assert.equal(PHONE_LIMIT.status, 'catalog');
  assert.match(PHONE_LIMIT.statement, /identifier, not a position/);
  assert.match(PHONE_LIMIT.whatWorks, /cell the handset reports/);
  assert.match(PHONE_LIMIT.whatDoesNot, /never to a/);
});
