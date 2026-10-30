import assert from 'node:assert/strict';
import test from 'node:test';

import {
  defaultRangeKm,
  groupIntoSites,
  normalizeTech,
  parseOcidCsv,
  parseOsmElements,
  toRegistry,
  overpassQuery,
  PAPUA_BBOX,
} from './import-bts.mjs';

const HEADER =
  'radio,mcc,net,area,cell,unit,lon,lat,range,samples,changeable,created,updated,averageSignal';

/** Three Telkomsel cells on one mast, one Indosat cell 60 m away, plus noise. */
const FIXTURE = [
  HEADER,
  'LTE,510,10,12345,111,1,140.7175,-2.5337,5000,40,1,0,0,0',
  'LTE,510,10,12345,112,2,140.7176,-2.5338,5000,30,1,0,0,0',
  'GSM,510,10,12345,113,,140.7174,-2.5336,35000,12,1,0,0,0',
  'GSM,510,20,12345,211,,140.7180,-2.5340,35000,8,1,0,0,0',
  'LTE,510,10,99999,999,9,106.8000,-6.2000,5000,50,1,0,0,0',
  'LTE,510,10,12345,114,4,140.7175,-2.5337,5000,0,1,0,0,0',
  '',
].join('\n');

test('a radio name becomes the label the panel shows', () => {
  assert.equal(normalizeTech('LTE'), '4G');
  assert.equal(normalizeTech('UMTS'), '3G');
  assert.equal(normalizeTech('GSM'), '2G');
  assert.equal(normalizeTech('NR'), '5G');
  assert.equal(normalizeTech(''), 'unknown');
});

test('a technology without a range gets a conservative one', () => {
  assert.equal(defaultRangeKm('4G'), 5);
  assert.equal(defaultRangeKm('2G'), 35);
  assert.ok(defaultRangeKm('5G') < defaultRangeKm('4G'));
});

test('the CSV is filtered to the box, to real coordinates and to samples', () => {
  const rows = parseOcidCsv(FIXTURE, { minSamples: 1 });
  // Jakarta and the zero-sample row are dropped, four remain.
  assert.equal(rows.length, 4);
  assert.ok(rows.every((row) => row.lat < 0));
  assert.ok(rows.every((row) => row.samples >= 1));
});

test('a range in metres becomes kilometres', () => {
  const rows = parseOcidCsv(FIXTURE);
  const lte = rows.find((row) => row.tech === '4G');
  assert.equal(lte.rangeKm, 5);
});

test('cells on one mast become one site, another operator stays separate', () => {
  const sites = groupIntoSites(parseOcidCsv(FIXTURE), { mergeM: 120 });
  assert.equal(sites.length, 2, 'three cells merged, the other operator kept');
  const telkomsel = sites.find((site) => site.mnc === 10);
  assert.equal(telkomsel.cells.length, 3);
  assert.deepEqual(telkomsel.techs.sort(), ['2G', '4G']);
  // The best-observed cell (40 samples, LTE) defines the site.
  assert.equal(telkomsel.tech, '4G');
  assert.equal(telkomsel.rangeKm, 5);
  assert.equal(telkomsel.samples, 40);
});

test('a merge radius smaller than the gap splits the sites', () => {
  const sites = groupIntoSites(parseOcidCsv(FIXTURE), { mergeM: 5 });
  assert.ok(sites.length >= 3, `sites: ${sites.length}`);
});

test('the registry document counts sites and cells', () => {
  const sites = groupIntoSites(parseOcidCsv(FIXTURE), { mergeM: 120 });
  const document = toRegistry(sites, { source: 'opencellid:test' });
  assert.equal(document.source, 'opencellid:test');
  assert.equal(document.count, 2);
  assert.equal(document.cells, 4);
  assert.deepEqual(document.bbox, PAPUA_BBOX);
  assert.match(document.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('a registry site carries what the app reads', () => {
  const sites = groupIntoSites(parseOcidCsv(FIXTURE), { mergeM: 120 });
  for (const site of sites) {
    assert.ok(site.id);
    assert.ok(Number.isFinite(site.lat) && Number.isFinite(site.lon));
    assert.ok(site.rangeKm > 0);
    assert.ok(Array.isArray(site.cells) && site.cells.length >= 1);
    assert.equal(site.source, 'opencellid');
    assert.equal(site.rows, undefined, 'the raw rows do not leak out');
  }
});

test('an Overpass answer becomes sites without cell ids', () => {
  const sites = parseOsmElements({
    elements: [
      {
        type: 'node',
        id: 1,
        lat: -2.5337,
        lon: 140.7175,
        tags: { 'man_made': 'mast', 'tower:type': 'communication', name: 'Mast A' },
      },
      {
        type: 'way',
        id: 2,
        center: { lat: -4.1, lon: 138.95 },
        tags: { 'tower:type': 'communication', operator: 'Telkomsel' },
      },
      { type: 'node', id: 3, tags: { name: 'no position' } },
    ],
  });
  assert.equal(sites.length, 2);
  assert.equal(sites[0].name, 'Mast A');
  assert.equal(sites[1].name, 'Telkomsel');
  for (const site of sites) {
    assert.deepEqual(site.cells, [], 'OSM knows masts, not cell ids');
    assert.equal(site.source, 'openstreetmap');
  }
});

test('the Overpass query asks only for communication masts in the box', () => {
  const query = overpassQuery(PAPUA_BBOX);
  assert.match(query, /"tower:type"="communication"/);
  assert.match(query, /-9\.5,130,1\.5,141\.5/);
  assert.match(query, /out center tags;/);
});
