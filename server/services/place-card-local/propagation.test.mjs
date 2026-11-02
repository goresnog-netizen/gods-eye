import assert from 'node:assert/strict';
import test from 'node:test';

import {
  budgetRangeKm,
  destination,
  freeSpaceLossDb,
  fresnelRadiusM,
  knifeEdgeLossDb,
  pathLossDb,
  radialRange,
  terrainClutterDb,
  verticalPatternLossDb,
  TECH_PROFILES,
  viewshed,
} from './propagation.mjs';

/** Flat ground: every sample is sea level. */
const flat = async () => 0;

/** A ridge 550 m north of the site, 300 m high; flat everywhere else. */
function ridgeNorth(siteLat) {
  return async (lat) => (lat > siteLat + 0.004 ? 300 : 0);
}

test('free-space loss matches the textbook value', () => {
  // 1 km at 1800 MHz: 32.44 + 20log10(1) + 20log10(1800) = 97.5 dB
  assert.ok(Math.abs(freeSpaceLossDb(1, 1800) - 97.55) < 0.1);
  // Doubling the distance adds 6 dB.
  assert.ok(
    Math.abs(freeSpaceLossDb(2, 1800) - freeSpaceLossDb(1, 1800) - 6.02) < 0.05,
  );
  assert.equal(freeSpaceLossDb(0, 1800), 0);
});

test('the link budget closes far beyond any real cell', () => {
  // This is why the planning cap exists: physics alone would allow 1000+ km.
  assert.ok(budgetRangeKm(TECH_PROFILES['4G']) > 500);
  assert.ok(budgetRangeKm(TECH_PROFILES['5G']) > 100);
});

test('a clear path has no diffraction loss', () => {
  const terrain = new Array(10).fill(0);
  const result = pathLossDb({
    terrain,
    stepKm: 0.3,
    antennaM: 30,
    freqMhz: 1800,
  });
  assert.equal(result.lossDb, 0);
});

test('a wall between the ends produces diffraction loss', () => {
  const terrain = new Array(10).fill(0);
  terrain[5] = 120; // 120 m of rock halfway along
  const result = pathLossDb({
    terrain,
    stepKm: 0.3,
    antennaM: 30,
    freqMhz: 1800,
  });
  assert.ok(result.lossDb > 10, `loss ${result.lossDb}`);
  assert.ok(
    result.atKm > 1 && result.atKm < 2,
    'the obstacle is where it was put',
  );
});

test('knife-edge loss grows with the obstruction and stops when clear', () => {
  assert.equal(knifeEdgeLossDb(-1), 0);
  assert.equal(knifeEdgeLossDb(-0.79), 0);
  const graze = knifeEdgeLossDb(0);
  const blocked = knifeEdgeLossDb(3);
  assert.ok(graze > 5 && graze < 7, `grazing loss ${graze}`);
  assert.ok(blocked > graze + 10, 'a deep obstruction costs more');
});

test('the Fresnel radius shrinks with frequency and is widest mid-path', () => {
  const at900 = fresnelRadiusM(1, 1, 900);
  const at2100 = fresnelRadiusM(1, 1, 2100);
  assert.ok(at900 > at2100);
  const nearEnd = fresnelRadiusM(0.1, 1.9, 1800);
  const middle = fresnelRadiusM(1, 1, 1800);
  assert.ok(middle > nearEnd);
});

test('a destination is where a compass bearing says it is', () => {
  const north = destination(0, 0, 0, 111.32);
  assert.ok(Math.abs(north.lat - 1) < 0.01, `lat ${north.lat}`);
  const east = destination(0, 0, 90, 111.32);
  assert.ok(Math.abs(east.lon - 1) < 0.01, `lon ${east.lon}`);
});

test('flat ground reaches the planning cap', async () => {
  const ring = await radialRange({
    site: { lat: -4, lon: 138, heightM: 30 },
    azimuthDeg: 0,
    profile: TECH_PROFILES['4G'],
    elevationAt: flat,
  });
  assert.equal(
    ring.rangeKm,
    TECH_PROFILES['4G'].capKm,
    'the cap, not a circle',
  );
  assert.equal(ring.obstructionDb, 0);
});

test('a ridge cuts the range on its side only', async () => {
  const site = { lat: -4, lon: 138, heightM: 30 };
  const north = await radialRange({
    site,
    azimuthDeg: 0,
    profile: TECH_PROFILES['4G'],
    elevationAt: ridgeNorth(site.lat),
  });
  const south = await radialRange({
    site,
    azimuthDeg: 180,
    profile: TECH_PROFILES['4G'],
    elevationAt: ridgeNorth(site.lat),
  });
  assert.ok(north.rangeKm < 1, `blocked side reached ${north.rangeKm} km`);
  assert.equal(
    south.rangeKm,
    TECH_PROFILES['4G'].capKm,
    'the open side is untouched',
  );
  assert.ok(north.obstructionDb > 10);
});

test('a viewshed returns a closed ring with one radius per azimuth', async () => {
  const result = await viewshed({
    site: { id: 'test', lat: -4.1, lon: 138.95, heightM: 30 },
    profile: TECH_PROFILES['4G'],
    azimuths: 12,
    elevationAt: flat,
  });
  assert.equal(result.ok, true);
  assert.equal(result.rings.length, 12);
  assert.equal(result.polygon.length, 13, 'the ring is closed');
  assert.deepEqual(
    result.polygon[0],
    result.polygon[result.polygon.length - 1],
  );
  assert.equal(result.stats.maxKm, TECH_PROFILES['4G'].capKm);
  for (const ring of result.rings) {
    assert.ok(ring.azimuthDeg >= 0 && ring.azimuthDeg < 360);
    assert.ok(Number.isFinite(ring.rangeKm));
  }
});

test('without an elevation source a viewshed refuses rather than guesses', async () => {
  const result = await viewshed({ site: { lat: -4, lon: 138 } });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'elevation_required');
});

test('roughness clutter is zero on flat ground and grows with the grade', () => {
  
  assert.equal(terrainClutterDb(new Array(10).fill(0), 0.3), 0);
  assert.equal(terrainClutterDb([], 0.3), 0);
  assert.equal(terrainClutterDb([0], 0.3), 0);
  assert.equal(terrainClutterDb([0, 1], 0), 0, 'no step means no grade');

  // A 10 % grade over 300 m steps is 30 m per step: RMS 10 → 0.25 × 10 = 2.5 dB.
  const ten = [];
  for (let i = 0; i < 10; i += 1) ten.push(i * 30);
  assert.equal(terrainClutterDb(ten, 0.3), 2.5);
  // A 50 % grade is capped at 10 dB, never allowed to dominate the link.
  const steep = [];
  for (let i = 0; i < 10; i += 1) steep.push(i * 150);
  assert.equal(terrainClutterDb(steep, 0.3), 10);
  // A 2 % grade costs half a decibel — rolling, not mountainous.
  const rolling = [];
  for (let i = 0; i < 10; i += 1) rolling.push(i * 6);
  assert.equal(terrainClutterDb(rolling, 0.3), 0.5);
});

test('the vertical pattern is 3GPP-shaped and only ever a loss', () => {
  
  assert.equal(verticalPatternLossDb(0, 10), 0);
  assert.ok(Math.abs(verticalPatternLossDb(5, 10) + 3) < 0.01, '-3 dB at half beam');
  assert.equal(verticalPatternLossDb(10, 10), -12);
  assert.equal(verticalPatternLossDb(45, 10), -12, 'capped beyond the beam');
  assert.equal(verticalPatternLossDb(-5, 10), verticalPatternLossDb(5, 10));
  assert.equal(verticalPatternLossDb(Number.NaN, 10), 0);
});

test('roughness shortens the range where the ground is broken', async () => {
  
  const site = { id: 'test', lat: -4.1, lon: 138.95, groundM: 0, heightM: 30 };
  // Broken ground: ±30 m every 300 m (10 % grade) on every azimuth.
  let step = 0;
  const broken = async () => {
    step += 1;
    return step % 2 === 0 ? 30 : -30;
  };
  const rough = await radialRange({
    site,
    azimuthDeg: 90,
    profile: TECH_PROFILES['4G'],
    elevationAt: broken,
    clutterModel: 'roughness',
  });
  const flatModel = await radialRange({
    site,
    azimuthDeg: 90,
    profile: TECH_PROFILES['4G'],
    elevationAt: async () => 0,
    clutterModel: 'roughness',
  });
  assert.ok(rough.clutterDb > 2, `roughness charged ${rough.clutterDb} dB`);
  assert.ok(
    rough.rangeKm < flatModel.rangeKm,
    `rough ${rough.rangeKm} vs flat ${flatModel.rangeKm}`,
  );
  assert.equal(flatModel.rangeKm, TECH_PROFILES['4G'].capKm);
});

test('a downtilted beam spends the fade margin a ridge needs', async () => {
  // Flat ground with one 30 m ridge 2 km north of a 120 m mast. Untilted the
  // ridge diffracts ~11 dB, inside the 12 dB margin, so the beam reaches the
  // cap. Tilted 12° the pattern costs ~9 dB at that distance, the margin is
  // gone, and the same ridge stops the link — the hole under the mast, stated
  // as a range instead of a picture.
  const ridgeAt2km = async (lat) => (lat > -4.1 + 2 / 111.32 ? 30 : 0);
  const site = { id: 'test', lat: -4.1, lon: 138.95, heightM: 120 };
  const untilted = await viewshed({
    site,
    profile: TECH_PROFILES['4G'],
    azimuths: 4,
    elevationAt: ridgeAt2km,
  });
  const tilted = await viewshed({
    site,
    profile: TECH_PROFILES['4G'],
    azimuths: 4,
    elevationAt: ridgeAt2km,
    tiltDeg: 12,
  });
  const untiltedNorth = untilted.rings.find((ring) => ring.azimuthDeg === 0);
  const tiltedNorth = tilted.rings.find((ring) => ring.azimuthDeg === 0);
  assert.equal(untiltedNorth.rangeKm, TECH_PROFILES['4G'].capKm);
  assert.ok(
    tiltedNorth.rangeKm < 5,
    `tilted north stopped at ${tiltedNorth.rangeKm} km`,
  );
  assert.ok(
    tilted.stats.patternDbMin <= -9,
    `pattern ${tilted.stats.patternDbMin}`,
  );
  assert.ok(
    tiltedNorth.marginDb < untiltedNorth.marginDb,
    `margin ${tiltedNorth.marginDb} vs ${untiltedNorth.marginDb}`,
  );
  assert.equal(tilted.profile.tiltDeg, 12);
  assert.equal(tilted.profile.vBeamDeg, 10);
  assert.equal(untilted.profile.tiltDeg, 0);
});

test('the flat model is the default and is reported as such', async () => {
  
  const result = await viewshed({
    site: { id: 'test', lat: -4.1, lon: 138.95, heightM: 30 },
    profile: TECH_PROFILES['4G'],
    azimuths: 4,
    elevationAt: flat,
  });
  assert.equal(result.profile.clutterModel, 'flat');
  assert.equal(result.profile.clutterBasis, 'flat');
  assert.equal(result.profile.vBeamDeg, null);
  assert.equal(result.stats.clutterDbMax, 0);
  for (const ring of result.rings) {
    assert.equal(ring.clutterDb, 0);
    assert.equal(ring.patternDb, 0);
  }
});


test('a flat path through canopy pays clutter that flat ground does not', async () => {
  const site = { lat: -4, lon: 138, heightM: 30 };
  const forest = async () => ({ key: 'tree-cover', cluttered: true });
  const water = async () => ({ key: 'water', cluttered: false });
  const base = {
    site,
    azimuthDeg: 0,
    profile: TECH_PROFILES['4G'],
    elevationAt: ridgeNorth(site.lat),
    // The ridge costs ~45 dB; 50 leaves room for clutter to decide the walk.
    toleranceDb: 50,
  };

  const openRing = await radialRange({ ...base, clutterModel: 'flat' });
  const waterRing = await radialRange({
    ...base,
    clutterModel: 'landcover',
    landCoverAt: water,
  });
  const forestRing = await radialRange({
    ...base,
    clutterModel: 'landcover',
    landCoverAt: forest,
  });

  assert.equal(openRing.rangeKm, TECH_PROFILES['4G'].capKm);
  assert.equal(waterRing.clutterDb, 0, 'open water is not clutter');
  assert.equal(waterRing.rangeKm, openRing.rangeKm);
  assert.equal(forestRing.clutterDb, TECH_PROFILES['4G'].clutterDb);
  assert.ok(
    forestRing.rangeKm < 1,
    `canopy spent the margin the ridge needed: ${forestRing.rangeKm} km`,
  );
  assert.equal(forestRing.landCover.dominant, 'tree-cover');
  assert.equal(forestRing.landCover.clutteredFraction, 1);
});

test('a land-cover ring refuses rather than falling back to flat', async () => {
  const result = await viewshed({
    site: { lat: -4, lon: 138 },
    elevationAt: flat,
    clutterModel: 'landcover',
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'landcover_required');
});

test('a land-cover viewshed reports what the ring actually crossed', async () => {
  const result = await viewshed({
    site: { lat: -4, lon: 138, heightM: 30 },
    elevationAt: flat,
    azimuths: 4,
    stepM: 600,
    clutterModel: 'landcover',
    landCoverAt: async (_lat, lon) =>
      lon > 138
        ? { key: 'tree-cover', cluttered: true }
        : { key: 'water', cluttered: false },
  });
  assert.equal(result.ok, true);
  assert.equal(result.profile.clutterBasis, 'worldcover-2021-class-codes');
  assert.ok(result.landCover.samples > 0);
  assert.ok(result.landCover.clutteredFraction > 0);
  assert.ok(
    result.landCover.clutteredFraction < 1,
    'one azimuth walked out to sea',
  );
});

test('a land-cover tile that will not load is an error, not a quiet ring', async () => {
  const result = await viewshed({
    site: { lat: -4, lon: 138, heightM: 30 },
    elevationAt: flat,
    azimuths: 4,
    clutterModel: 'landcover',
    landCoverAt: async () => {
      throw new Error('worldcover: HTTP 503');
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'landcover_unavailable');
  assert.match(result.detail, /HTTP 503/);
});
