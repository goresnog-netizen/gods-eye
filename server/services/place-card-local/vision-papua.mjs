/**
 * Vision Papua — modul lokal, tanpa external provider calls.
 * Simulasi output VLM untuk area Papua (Tolikara, Yahukimo, Puncak, Puncak Jaya, dll).
 *
 * Kontrak: sesuai VISION-PLAN.md — scene, people (bbox [x0,y0,x1,y1] pixels + image_size),
 * holding, activity, confidence, vehicles.
 *
 * Catatan: Ini adalah MODUL SIMULASI. Untuk vision nyata, butuh model vision (qwen2.5vl:3b / moondream)
 * yang terpasang via Ollama (sudah done J20).
 */

const PAPUA_AREAS = [
  { id: 'papua-001', name: 'Tolikara Highlands', lat: -3.6833, lon: 138.4833, elevation_m: 2400, terrain: 'highland' },
  { id: 'papua-002', name: 'Yahukimo Base', lat: -4.4833, lon: 139.5333, elevation_m: 1800, terrain: 'highland' },
  { id: 'papua-003', name: 'Puncak Pass', lat: -3.9833, lon: 137.7833, elevation_m: 3200, terrain: 'mountain' },
  { id: 'papua-004', name: 'Puncak Jaya Summit', lat: -3.6167, lon: 137.4833, elevation_m: 4884, terrain: 'glacier' },
  { id: 'papua-005', name: 'Wamena Valley', lat: -4.1000, lon: 138.9500, elevation_m: 1600, terrain: 'valley' },
  { id: 'papua-006', name: 'Nabire Port', lat: -3.3667, lon: 135.4833, elevation_m: 50, terrain: 'coastal' },
  { id: 'papua-007', name: 'Biak Airport', lat: -1.0333, lon: 136.0833, elevation_m: 20, terrain: 'coastal' },
  { id: 'papua-008', name: 'Timika Mine', lat: -4.5500, lon: 136.8833, elevation_m: 100, terrain: 'mining' },
  { id: 'papua-009', name: 'Jayapura City', lat: -2.5337, lon: 140.7175, elevation_m: 50, terrain: 'urban' },
  { id: 'papua-010', name: 'Sorong Harbor', lat: -0.8763, lon: 131.2558, elevation_m: 10, terrain: 'coastal' },
];

const ACTIVITIES = [
  'walking', 'standing', 'sitting', 'carrying', 'working', 'resting',
  'farming', 'trading', 'patrolling', 'observing',
];

const HOLDINGS = [
  'none', 'bag', 'tool', 'phone', 'basket', 'machete', 'rifle (security)',
  'camera', 'document', 'food',
];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generate mock vision output for an area.
 *
 * @param {object} area - area info
 * @param {object} [options]
 * @param {number} [options.peopleCount] - override people count
 * @param {number} [options.imageWidth] - image width in pixels
 * @param {number} [options.imageHeight] - image height in pixels
 */
export function generateVisionOutput(area, options = {}) {
  const {
    peopleCount = randomInt(2, 8),
    imageWidth = 1280,
    imageHeight = 720,
  } = options;

  const people = [];
  for (let i = 0; i < peopleCount; i++) {
    const x0 = randomInt(50, imageWidth - 200);
    const y0 = randomInt(50, imageHeight - 200);
    const w = randomInt(60, 120);
    const h = randomInt(120, 200);
    people.push({
      id: `person-${i + 1}`,
      bbox: [x0, y0, x0 + w, y0 + h],
      image_size: [imageWidth, imageHeight],
      bboxSpace: 'pixels',
      confidence: Number((0.75 + Math.random() * 0.2).toFixed(2)),
      holding: randomChoice(HOLDINGS),
      activity: randomChoice(ACTIVITIES),
    });
  }

  const vehicleCount = randomInt(0, 3);
  const vehicles = [];
  for (let i = 0; i < vehicleCount; i++) {
    vehicles.push({
      id: `vehicle-${i + 1}`,
      type: randomChoice(['car', 'motorcycle', 'truck', 'boat']),
      bbox: [randomInt(0, imageWidth - 100), randomInt(0, imageHeight - 60), randomInt(100, 200), randomInt(60, 120)],
      confidence: Number((0.7 + Math.random() * 0.25).toFixed(2)),
    });
  }

  return {
    area: {
      id: area.id,
      name: area.name,
      lat: area.lat,
      lon: area.lon,
      elevation_m: area.elevation_m,
      terrain: area.terrain,
    },
    scene: {
      description: `Area ${area.name} — ${area.terrain} terrain, elevation ${area.elevation_m}m. ${peopleCount} orang terdeteksi, ${vehicleCount} kendaraan.`,
      visibility: randomChoice(['clear', 'hazy', 'cloudy', 'rainy']),
      time_of_day: randomChoice(['morning', 'afternoon', 'evening', 'night']),
    },
    people,
    vehicles,
    summary: {
      people_count: peopleCount,
      vehicle_count: vehicleCount,
      dominant_activity: people.length > 0 ? people[0].activity : 'none',
    },
    generatedAt: Date.now(),
    source: 'vision-mock-papua',
  };
}

/**
 * Generate vision output for all Papua areas.
 *
 * @param {object} [options]
 */
export function generateAllPapuaVision(options = {}) {
  return PAPUA_AREAS.map((area) => generateVisionOutput(area, options));
}

/**
 * Get area by id or name.
 */
export function getArea(query) {
  const normalized = String(query).toLowerCase().trim();
  return PAPUA_AREAS.find((a) =>
    a.id.toLowerCase() === normalized ||
    a.name.toLowerCase().includes(normalized)
  ) || null;
}

export { PAPUA_AREAS };