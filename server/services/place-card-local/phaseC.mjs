/**
 * Phase C — Composite Scoring Model (Market + News + OSINT + Vision)
 *
 * Adaptive weighted scoring for target areas.
 * All data local, no external calls.
 */

// Weight profiles (adaptive based on context)
const WEIGHT_PROFILES = {
  default: { market: 0.2, news: 0.25, osint: 0.25, vision: 0.3 },
  security: { market: 0.1, news: 0.3, osint: 0.4, vision: 0.2 },
  market: { market: 0.4, news: 0.2, osint: 0.1, vision: 0.3 },
  vision: { market: 0.1, news: 0.15, osint: 0.15, vision: 0.6 },
};

// Severity levels
const SEVERITY = {
  CRITICAL: 0.8,
  HIGH: 0.6,
  MEDIUM: 0.4,
  LOW: 0.2,
};

/**
 * Composite score for an area
 * @param {object} data - { market, news, osint, vision }
 * @param {string} profile - weight profile name
 * @returns {object} score breakdown
 */
export function compositeScore(data, profile = 'default') {
  const weights = WEIGHT_PROFILES[profile] || WEIGHT_PROFILES.default;

  const marketScore = normalizeScore(data.market || 0);
  const newsScore = normalizeScore(data.news || 0);
  const osintScore = normalizeScore(data.osint || 0);
  const visionScore = normalizeScore(data.vision || 0);

  const composite =
    marketScore * weights.market +
    newsScore * weights.news +
    osintScore * weights.osint +
    visionScore * weights.vision;

  return {
    composite: Math.round(composite * 1000) / 1000,
    breakdown: {
      market: {
        score: marketScore,
        weight: weights.market,
        contribution: Math.round(marketScore * weights.market * 1000) / 1000,
      },
      news: {
        score: newsScore,
        weight: weights.news,
        contribution: Math.round(newsScore * weights.news * 1000) / 1000,
      },
      osint: {
        score: osintScore,
        weight: weights.osint,
        contribution: Math.round(osintScore * weights.osint * 1000) / 1000,
      },
      vision: {
        score: visionScore,
        weight: weights.vision,
        contribution: Math.round(visionScore * weights.vision * 1000) / 1000,
      },
    },
    profile,
    severity: getSeverity(composite),
  };
}

/**
 * Normalize score to 0-1 range
 */
function normalizeScore(score) {
  if (typeof score === 'number') {
    // If already 0-1, return; if 0-100, divide by 100
    if (score > 1) return Math.min(score / 100, 1);
    return Math.max(0, Math.min(1, score));
  }
  if (score === 'high' || score === 'critical') return 0.9;
  if (score === 'medium') return 0.6;
  if (score === 'low') return 0.3;
  return 0.5;
}

/**
 * Get severity level
 */
function getSeverity(score) {
  if (score >= SEVERITY.CRITICAL) return 'CRITICAL';
  if (score >= SEVERITY.HIGH) return 'HIGH';
  if (score >= SEVERITY.MEDIUM) return 'MEDIUM';
  return 'LOW';
}

/**
 * Anomaly detection — target bergerak ke area sensitif
 */
export function detectAnomaly(target, history, sensitiveAreas = []) {
  const anomalies = [];

  // Check if target moved to sensitive area
  for (const area of sensitiveAreas) {
    const dist = haversineKm(target.lat, target.lon, area.lat, area.lon);
    if (dist <= area.radius) {
      anomalies.push({
        type: 'SENSITIVE_AREA_ENTRY',
        target: target.id,
        area: area.name,
        distance: Math.round(dist * 100) / 100,
        severity: area.severity || 'HIGH',
      });
    }
  }

  // Check sudden movement (speed anomaly)
  if (history && history.length >= 1) {
    const prev = history[history.length - 1];
    const speed = calculateSpeed(prev, target);
    if (speed > 100) {
      // > 100 km/h
      anomalies.push({
        type: 'SPEED_ANOMALY',
        target: target.id,
        speed: Math.round(speed * 10) / 10,
        severity: 'MEDIUM',
      });
    }
  }

  // Check area density change
  if (history && history.length >= 3) {
    const densityChange = calculateDensityChange(history);
    if (densityChange > 0.5) {
      anomalies.push({
        type: 'DENSITY_CHANGE',
        target: target.id,
        change: Math.round(densityChange * 100) / 100,
        severity: 'LOW',
      });
    }
  }

  return {
    hasAnomaly: anomalies.length > 0,
    anomalies,
    target: target.id,
    timestamp: Date.now(),
  };
}

/**
 * Haversine distance
 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculate speed between two points (km/h)
 */
function calculateSpeed(prev, curr) {
  const dist = haversineKm(prev.lat, prev.lon, curr.lat, curr.lon);
  const timeDiff = (curr.timestamp - prev.timestamp) / 3600000; // hours
  if (timeDiff <= 0) return 0;
  return dist / timeDiff;
}

/**
 * Calculate density change
 */
function calculateDensityChange(history) {
  if (history.length < 3) return 0;
  const recent = history.slice(-3);
  const densities = recent.map((h, i) => {
    if (i === 0) return 1;
    const dist = haversineKm(
      recent[i - 1].lat,
      recent[i - 1].lon,
      h.lat,
      h.lon,
    );
    return dist < 1 ? 2 : 1; // closer = higher density
  });
  return densities[densities.length - 1] - densities[0];
}

/**
 * Heatmap density — visualisasi kepadatan target/orang di peta
 */
export function generateHeatmap(points, options = {}) {
  const { gridDegrees = 0.5, minCount = 1 } = options;

  const grid = {};

  for (const point of points) {
    const gridLat = Math.floor(point.lat / gridDegrees) * gridDegrees;
    const gridLon = Math.floor(point.lon / gridDegrees) * gridDegrees;
    const key = `${gridLat.toFixed(1)},${gridLon.toFixed(1)}`;

    if (!grid[key]) {
      grid[key] = { lat: gridLat, lon: gridLon, count: 0, points: [] };
    }
    grid[key].count++;
    grid[key].points.push(point);
  }

  return Object.values(grid)
    .filter((g) => g.count >= minCount)
    .map((g) => ({
      lat: g.lat,
      lon: g.lon,
      weight: Math.min(g.count / 10, 1), // normalize to 0-1
      count: g.count,
      intensity: g.count > 5 ? 'high' : g.count > 2 ? 'medium' : 'low',
    }));
}

/**
 * Time-series tracking — movement target over time
 */
export function trackMovement(targetId, positions, options = {}) {
  const { maxPoints = 100 } = options;

  const sorted = [...positions].sort((a, b) => a.timestamp - b.timestamp);
  const trimmed = sorted.slice(-maxPoints);

  const segments = [];
  for (let i = 1; i < trimmed.length; i++) {
    const prev = trimmed[i - 1];
    const curr = trimmed[i];
    const dist = haversineKm(prev.lat, prev.lon, curr.lat, curr.lon);
    const timeDiff = (curr.timestamp - prev.timestamp) / 1000; // seconds
    const speed = timeDiff > 0 ? (dist / timeDiff) * 3600 : 0; // km/h

    segments.push({
      from: { lat: prev.lat, lon: prev.lon, ts: prev.timestamp },
      to: { lat: curr.lat, lon: curr.lon, ts: curr.timestamp },
      distanceKm: Math.round(dist * 100) / 100,
      durationSec: timeDiff,
      speedKmh: Math.round(speed * 10) / 10,
      bearing: calculateBearing(prev.lat, prev.lon, curr.lat, curr.lon),
    });
  }

  return {
    targetId,
    totalPoints: trimmed.length,
    totalDistanceKm:
      Math.round(segments.reduce((s, seg) => s + seg.distanceKm, 0) * 100) /
      100,
    avgSpeedKmh:
      segments.length > 0
        ? Math.round(
            (segments.reduce((s, seg) => s + seg.speedKmh, 0) /
              segments.length) *
              10,
          ) / 10
        : 0,
    maxSpeedKmh:
      segments.length > 0 ? Math.max(...segments.map((s) => s.speedKmh)) : 0,
    segments,
    positions: trimmed,
  };
}

/**
 * Calculate bearing between two points
 */
function calculateBearing(lat1, lon1, lat2, lon2) {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos((lat2 * Math.PI) / 180);
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.cos(dLon);
  let bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

/**
 * Export to GeoJSON
 */
export function exportGeoJSON(data, options = {}) {
  const { name = 'GodsEye Export', description = '' } = options;

  const features = [];

  if (data.points) {
    for (const p of data.points) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { ...p, __type: 'point' },
      });
    }
  }

  if (data.tracks) {
    for (const track of data.tracks) {
      const coords = track.positions.map((p) => [p.lon, p.lat]);
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: { id: track.targetId, __type: 'track' },
      });
    }
  }

  if (data.heatmap) {
    for (const h of data.heatmap) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [h.lon, h.lat] },
        properties: {
          weight: h.weight,
          count: h.count,
          intensity: h.intensity,
          __type: 'heatmap',
        },
      });
    }
  }

  return {
    type: 'FeatureCollection',
    metadata: {
      name,
      description,
      generated: new Date().toISOString(),
      source: 'GodsEye Local',
    },
    features,
  };
}

/**
 * Export to KML
 */
export function exportKML(data, options = {}) {
  const { name = 'GodsEye Export' } = options;

  let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>${escapeXml(name)}</name>
  <description>Generated by God's Eye View — Local</description>
`;

  if (data.points) {
    for (const p of data.points) {
      kml += `  <Placemark>
    <name>${escapeXml(p.name || p.id || 'Point')}</name>
    <Point><coordinates>${p.lon},${p.lat},0</coordinates></Point>
  </Placemark>
`;
    }
  }

  if (data.tracks) {
    for (const track of data.tracks) {
      const coords = track.positions
        .map((p) => `${p.lon},${p.lat},0`)
        .join(' ');
      kml += `  <Placemark>
    <name>${escapeXml(track.targetId || 'Track')}</name>
    <LineString><coordinates>${coords}</coordinates></LineString>
  </Placemark>
`;
    }
  }

  kml += `</Document>
</kml>`;

  return kml;
}

/**
 * Export to CSV
 */
export function exportCSV(data, options = {}) {
  const { columns = ['id', 'lat', 'lon', 'timestamp', 'name'] } = options;

  const rows = [columns.join(',')];

  const points = data.points || [];
  for (const p of points) {
    const row = columns.map((col) => {
      const val = p[col] !== undefined ? p[col] : '';
      return escapeCsv(String(val));
    });
    rows.push(row.join(','));
  }

  return rows.join('\n');
}

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeCsv(str) {
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * CLI
 */
async function main() {
  const args = process.argv.slice(2);
  let mode = 'score';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode' && args[i + 1]) {
      mode = args[i + 1];
      i++;
    }
  }

  console.log(`Phase C module loaded. Mode: ${mode}`);
  console.log(
    'Available exports: compositeScore, detectAnomaly, generateHeatmap, trackMovement, exportGeoJSON, exportKML, exportCSV',
  );
}

if (process.argv[1] && process.argv[1].endsWith('phaseC.mjs')) {
  main().catch((e) => {
    console.error('Error:', e.message);
    process.exit(1);
  });
}

export { WEIGHT_PROFILES, SEVERITY };
