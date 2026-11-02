/**
 * Test Suite — CCTV Enhanced + Phase C + Globe Integration
 * Run: node test-phase-c.mjs
 */

import {
  fetchCctvEnhanced,
  getCctvByType,
  getCctvByProvider,
  getCctvByCity,
  getCctvCount,
} from './cctv-enhanced.mjs';
import {
  compositeScore,
  detectAnomaly,
  generateHeatmap,
  trackMovement,
  exportGeoJSON,
  exportKML,
  exportCSV,
} from './phaseC.mjs';
import {
  generateFlyToCode,
  generateTargetMarker,
  generateCellTowerOverlay,
  generatePhoneLocationOverlay,
} from './globe-integration.mjs';
import { lookupCell } from './cell-tower.mjs';

let passed = 0,
  failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`❌ ${name}: ${e.message}`);
    failed++;
  }
}

// === CCTV Enhanced ===
await test('CCTV count total = 51', async () => {
  const c = getCctvCount();
  if (c.total !== 51) throw new Error(`Got ${c.total}`);
});

await test('CCTV fixed = 40', async () => {
  const c = getCctvCount();
  if (c.byType.fixed !== 40) throw new Error(`Got ${c.byType.fixed}`);
});

await test('CCTV phone = 8', async () => {
  const c = getCctvCount();
  if (c.byType.phone !== 8) throw new Error(`Got ${c.byType.phone}`);
});

await test('CCTV rtsp = 3', async () => {
  const c = getCctvCount();
  if (c.byType['ip-camera'] !== 3)
    throw new Error(`Got ${c.byType['ip-camera']}`);
});

await test('CCTV Papua = 26', async () => {
  const c = getCctvCount();
  if (c.papua !== 26) throw new Error(`Got ${c.papua}`);
});

await test('fetchCctvEnhanced Jayapura 50km', async () => {
  const r = await fetchCctvEnhanced(-2.5337, 140.7175, 50);
  if (r.count < 5) throw new Error(`Only ${r.count} cameras`);
});

await test('fetchCctvEnhanced phone type only', async () => {
  const r = await fetchCctvEnhanced(-2.5337, 140.7175, 50, { type: 'phone' });
  if (r.count !== 1) throw new Error(`Got ${r.count}, expected 1`);
});

await test('fetchCctvEnhanced rtsp only', async () => {
  const r = await fetchCctvEnhanced(-4.5326, 140.5066, 100, {
    type: 'ip-camera',
  });
  if (r.count < 1) throw new Error(`Got ${r.count}`);
});

await test('getCctvByCity Jayapura', async () => {
  const c = getCctvByCity('Jayapura');
  if (c.length < 3) throw new Error(`Got ${c.length}`);
});

await test('getCctvByProvider phone', async () => {
  const c = getCctvByProvider('phone');
  if (c.length !== 8) throw new Error(`Got ${c.length}`);
});

// === Phase C Scoring ===
await test('compositeScore default', async () => {
  const s = compositeScore({ market: 0.7, news: 0.8, osint: 0.6, vision: 0.9 });
  if (s.composite <= 0 || s.composite > 1)
    throw new Error(`Invalid: ${s.composite}`);
  if (!s.breakdown) throw new Error('No breakdown');
});

await test('compositeScore all 4 profiles', async () => {
  for (const p of ['default', 'security', 'market', 'vision']) {
    const s = compositeScore(
      { market: 0.5, news: 0.5, osint: 0.5, vision: 0.5 },
      p,
    );
    if (s.profile !== p) throw new Error(`Profile mismatch: ${s.profile}`);
  }
});

await test('compositeScore severity levels', async () => {
  const s1 = compositeScore({
    market: 0.9,
    news: 0.9,
    osint: 0.9,
    vision: 0.9,
  });
  const s2 = compositeScore({
    market: 0.1,
    news: 0.1,
    osint: 0.1,
    vision: 0.1,
  });
  if (s1.severity !== 'HIGH' && s1.severity !== 'CRITICAL')
    throw new Error(`Expected high, got ${s1.severity}`);
  if (s2.severity !== 'LOW')
    throw new Error(`Expected low, got ${s2.severity}`);
});

await test('detectAnomaly sensitive area entry', async () => {
  const target = { id: 't1', lat: -4.5, lon: 140.5 };
  const areas = [
    { name: 'Zone A', lat: -4.5, lon: 140.5, radius: 5, severity: 'HIGH' },
  ];
  const r = detectAnomaly(target, [], areas);
  if (!r.hasAnomaly) throw new Error('No anomaly detected');
  if (r.anomalies[0].type !== 'SENSITIVE_AREA_ENTRY')
    throw new Error(`Wrong type: ${r.anomalies[0].type}`);
});

await test('detectAnomaly speed anomaly', async () => {
  const target = { id: 't1', lat: -4.5, lon: 140.5, timestamp: Date.now() };
  const history = [{ lat: -4.0, lon: 140.0, timestamp: Date.now() - 60000 }];
  const r = detectAnomaly(target, history, []);
  if (r.anomalies.length === 0) throw new Error('No speed anomaly');
});

await test('generateHeatmap', async () => {
  const points = [
    { lat: -4.5, lon: 140.5 },
    { lat: -4.5, lon: 140.5 },
    { lat: -2.5, lon: 140.7 },
  ];
  const h = generateHeatmap(points);
  if (h.length !== 2) throw new Error(`Got ${h.length} cells`);
  if (h[0].count !== 2) throw new Error(`Count mismatch: ${h[0].count}`);
});

await test('trackMovement', async () => {
  const positions = [
    { lat: -4.5, lon: 140.5, timestamp: 1000 },
    { lat: -4.4, lon: 140.6, timestamp: 2000 },
    { lat: -4.3, lon: 140.7, timestamp: 3000 },
  ];
  const t = trackMovement('t1', positions);
  if (t.totalPoints !== 3) throw new Error(`Got ${t.totalPoints}`);
  if (t.segments.length !== 2)
    throw new Error(`Got ${t.segments.length} segments`);
  if (t.totalDistanceKm <= 0) throw new Error('No distance');
});

await test('exportGeoJSON', async () => {
  const data = {
    points: [{ id: 't1', lat: -4.5, lon: 140.5, name: 'Target1' }],
  };
  const g = exportGeoJSON(data);
  if (g.type !== 'FeatureCollection') throw new Error('Wrong type');
  if (g.features.length !== 1)
    throw new Error(`Got ${g.features.length} features`);
});

await test('exportKML', async () => {
  const data = {
    points: [{ id: 't1', lat: -4.5, lon: 140.5, name: 'Target1' }],
  };
  const k = exportKML(data);
  if (!k.includes('<kml')) throw new Error('No kml tag');
  if (!k.includes('Target1')) throw new Error('No name');
});

await test('exportCSV', async () => {
  const data = {
    points: [{ id: 't1', lat: -4.5, lon: 140.5, name: 'Target1' }],
  };
  const c = exportCSV(data);
  if (!c.includes('t1')) throw new Error('No data');
  if (!c.includes('id,lat,lon')) throw new Error('No header');
});

// === Globe Integration ===
await test('generateFlyToCode', async () => {
  const code = generateFlyToCode(-4.5, 140.5, 5000, 3);
  if (!code.includes('flyTo')) throw new Error('No flyTo');
  if (!code.includes('140.5')) throw new Error('No lon');
  if (!code.includes('-4.5')) throw new Error('No lat');
});

await test('generateTargetMarker', async () => {
  const code = generateTargetMarker(-4.5, 140.5, 'Target Papua', '#ff0000');
  if (!code.includes('entities.add')) throw new Error('No entity');
  if (!code.includes('Target Papua')) throw new Error('No label');
});

await test('generateCellTowerOverlay', async () => {
  const cell = await lookupCell(
    510,
    10,
    32751,
    142703337,
    process.env.OPENCELLID_API_KEY || '',
  );
  const code = generateCellTowerOverlay(cell);
  if (!code || code.length < 50) throw new Error('Empty overlay');
});

await test('generatePhoneLocationOverlay', async () => {
  const phone = { lat: -4.5, lon: 140.5, location: 'Papua', country: 'ID' };
  const code = generatePhoneLocationOverlay(phone);
  if (!code || !code.includes('flyTo')) throw new Error('No flyTo');
});

// === Cell Tower ===
await test('lookupCell returns estimated', async () => {
  const cell = await lookupCell(
    510,
    10,
    99999,
    99999,
    process.env.OPENCELLID_API_KEY || '',
  );
  if (!cell.estimated) throw new Error('Expected estimated');
  if (!cell.carrier) throw new Error('No carrier');
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
