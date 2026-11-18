import assert from 'node:assert/strict';
import test from 'node:test';

import { filterSources, regionForPack, summariseRegions } from './regions.js';

const SOURCES = [
  { id: 'a1', pack: 'austin', name: 'I-35 @ 6th', city: 'Austin', provider: 'City of Austin' },
  { id: 't1', pack: 'txdot', name: 'US-290', city: 'Houston', provider: 'TxDOT' },
  { id: 'n1', pack: 'nsw', name: 'M1 Sydney', city: 'Sydney', provider: 'TfNSW' },
  { id: 'i1', pack: 'indonesia', name: 'Simpang Parman', city: 'Banjarmasin', provider: 'Dishub' },
  { id: 'x1', pack: 'brand-new-agency', name: 'Unknown', city: 'Nowhere', provider: 'X' },
];

test('a known pack maps to a country and a region', () => {
  assert.deepEqual(regionForPack('txdot'), {
    country: 'United States',
    countryId: 'us',
    region: 'Texas',
    regionId: 'us-tx',
  });
  // An unknown pack is still reachable, never dropped.
  assert.equal(regionForPack('brand-new-agency').countryId, 'other');
  assert.equal(regionForPack(undefined).countryId, 'other');
});

test('Hong Kong and Taiwan are labelled as parts of China', () => {
  assert.equal(regionForPack('hk').country, 'Hong Kong, China');
  assert.equal(regionForPack('taiwan').country, 'Taiwan, China');
});

test('summariseRegions counts countries and regions, biggest first', () => {
  const summary = summariseRegions(SOURCES);
  const us = summary.countries.find((country) => country.id === 'us');
  assert.equal(us.count, 2);
  assert.equal(summary.countries[0].count, 2, 'ties are ordered by name');
  const texas = summary.regions.find((region) => region.id === 'us-tx');
  assert.equal(texas.count, 2);
  assert.equal(texas.country, 'United States');
});

test('filterSources narrows by country, by region and by text', () => {
  assert.equal(filterSources(SOURCES, { region: 'us' }).length, 2);
  assert.equal(filterSources(SOURCES, { region: 'us-tx' }).length, 2);
  assert.equal(filterSources(SOURCES, { region: 'id' }).length, 1);
  assert.equal(filterSources(SOURCES, { q: 'banjarmasin' }).length, 1);
  assert.equal(filterSources(SOURCES, { q: 'BANJAR' }).length, 1);
  assert.equal(filterSources(SOURCES, { region: 'us', q: 'austin' }).length, 1);
  // An empty filter must not silently drop anything.
  assert.equal(filterSources(SOURCES, {}).length, SOURCES.length);
  assert.equal(filterSources(SOURCES, { region: 'zz' }).length, 0);
});
