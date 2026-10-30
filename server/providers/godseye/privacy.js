/**
 * Privacy guard untuk lane chat God's Eye.
 *
 * Aturan yang dijaga modul ini:
 *  - data gambar (data URL, base64 gambar, byte gambar, URL citra) tidak
 *    boleh keluar dari mesin pada lane remote;
 *  - bbox presisi, koordinat orang, dan lokasi target diganti JSON
 *    sintetis: jumlah orang, label aktivitas, zona relatif, id sintetis;
 *  - deskripsi vision diringkas menjadi deskripsi non-real.
 *
 * Modul ini deterministik: payload input tidak pernah diubah, dan hasil
 * sanitasi hanya bergantung pada payload itu sendiri. Efek samping audit
 * (append ke file JSONL lokal) lewat writer yang bisa di-inject, sehingga test
 * tidak pernah menyentuh disk.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Akar data lokal: <Gods Eye>/data.
 *
 * Modul ini pemilik path data lokal karena privacy guard adalah penulis
 * pertama yang butuh menulis file (audit), dan modul lain (skill library,
 * chat history) men-import path ini dari sini.
 */
export const DATA_DIR = path.resolve(
  MODULE_DIR,
  '..',
  '..',
  '..',
  '..',
  'data',
);

/** Berkas audit privasi lokal (JSONL, append). */
export const PRIVACY_AUDIT_PATH = path.join(DATA_DIR, 'privacy-audit.jsonl');

/** Kategori redaksi yang dilaporkan ke pemanggil dan ke audit. */
export const REDACTION = Object.freeze({
  IMAGE: 'image',
  PRECISE_LOCATION: 'precise_location',
  VISION_DESCRIPTION: 'vision_description',
});

/** Placeholder yang menggantikan data gambar pada lane remote. */
export const IMAGE_PLACEHOLDER = '[image removed before leaving the machine]';

/** Nama lane yang boleh menerima byte gambar (model lokal, mesin yang sama). */
export const LOCAL_LANE = 'local';

/**
 * Aturan privasi yang ikut ditanam ke system prompt.
 *
 * @type {ReadonlyArray<string>}
 */
export const PRIVACY_RULES = Object.freeze([
  'PRIVACY RULES:',
  '- Never invent or repeat precise coordinates, box coordinates or image bytes.',
  '- Describe a scene only through the synthetic descriptor: counts, activity labels, relative zone (left/center/right) and synthetic ids.',
  '- Do not guess data that a local-only module holds; say that it stays on this machine.',
  '- Work with the planted skill modules only; do not invent tools this console does not have.',
]);

/**
 * @typedef {object} Redaction
 * @property {string} category kategori redaksi
 * @property {number} count berapa banyak item yang kena
 */

/**
 * @typedef {object} SanitizeOptions
 * @property {string} [lane] lane tujuan; 'local' boleh membawa gambar
 * @property {string} [purpose] label tujuan untuk audit
 * @property {(record: object) => void} [writer] sink audit; null mematikan
 * @property {number} [now] jam deterministik untuk audit
 */

/**
 * Kunci payload yang isinya data gambar.
 *
 * Key dinormalisasi (huruf kecil, tanpa tanda baca) sebelum dicocokkan.
 */
const IMAGE_KEYS = new Set([
  'image',
  'images',
  'imageurl',
  'imagedata',
  'dataurl',
  'thumbnail',
  'thumbnailurl',
  'photo',
  'photourl',
  'picture',
  'screenshot',
  'frame',
  'frameurl',
  'media',
  'mediaurl',
  'base64',
]);

/** Kunci payload yang isinya geometri atau koordinat absolut. */
const LOCATION_KEYS = new Set([
  'bbox',
  'box',
  'boxes',
  'boundingbox',
  'rect',
  'rects',
  'lat',
  'lon',
  'lng',
  'latitude',
  'longitude',
  'coordinates',
  'coordinate',
  'coord',
  'coords',
  'gps',
  'geo',
  'geolocation',
  'position',
  'origin',
  'destination',
  'waypoint',
  'waypoints',
]);

/** Kunci payload yang isinya deskripsi vision. */
const DESCRIPTION_KEYS = new Set([
  'description',
  'caption',
  'summary',
  'notes',
  'note',
  'narrative',
  'alt',
  'alttext',
  'scenedescription',
  'visiondescription',
  'details',
]);

/** Kunci payload yang isinya daftar deteksi (orang, kendaraan, objek). */
const DETECTION_KEYS = new Set([
  'people',
  'persons',
  'vehicles',
  'detections',
  'objects',
  'subjects',
]);

/** Awalan id sintetis per jenis deteksi. */
const DETECTION_PREFIX = {
  people: 'person',
  persons: 'person',
  person: 'person',
  vehicles: 'vehicle',
  vehicle: 'vehicle',
  detections: 'detection',
  objects: 'object',
  subjects: 'subject',
};

/** Ekstensi URL yang menandai sebuah citra. */
const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp|bmp|svg|avif|heic|tiff?)$/i;

/** Magic byte beberapa format citra. */
const IMAGE_MAGIC = [
  [0x89, 0x50, 0x4e, 0x47], // PNG
  [0xff, 0xd8, 0xff], // JPEG
  [0x47, 0x49, 0x46, 0x38], // GIF
  [0x42, 0x4d], // BMP
];

/** Normalisasi kunci payload supaya perbandingan stabil. */
function normalizeKey(key) {
  return String(key || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Teks non-empty dari nilai apa pun. */
function textOf(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return text || '';
}

/** Apakah byte di depan adalah magic byte citra yang dikenal. */
function isImageBytes(bytes) {
  if (!bytes || bytes.length < 4) return false;
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes.length >= 12 &&
    bytes.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return true;
  }
  for (const magic of IMAGE_MAGIC) {
    if (magic.every((byte, index) => bytes[index] === byte)) return true;
  }
  return false;
}

/** Apakah string ini data URL citra (atau data URL lain yang isinya citra). */
function isImageDataUrl(text) {
  if (!/^data:/i.test(text)) return false;
  if (/^data:image\//i.test(text)) return true;
  const base64 = text.slice(text.indexOf(',') + 1);
  if (!base64) return false;
  try {
    const bytes = Buffer.from(base64, 'base64');
    if (isImageBytes(bytes)) return true;
    return bytes.toString('utf8', 0, 64).toLowerCase().includes('<svg');
  } catch {
    return false;
  }
}

/** Apakah string ini base64 yang berisi citra. */
function isImageBase64(text) {
  if (/\s/.test(text)) return false;
  const compact = text;
  if (compact.length < 32) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return false;
  try {
    const bytes = Buffer.from(compact, 'base64');
    if (isImageBytes(bytes)) return true;
    return bytes.toString('utf8', 0, 64).toLowerCase().includes('<svg');
  } catch {
    return false;
  }
}

/**
 * Apakah string ini URL citra.
 *
 * Cuma URL yang seluruhnya URL: kalimat yang memuat URL di dalamnya bukan
 * nilai gambar, dan memotongnya jadi placeholder akan menghapus pesan user.
 */
function isImageUrl(text) {
  if (/\s/.test(text)) return false;
  if (!/^(?:https?:)?\/\//i.test(text)) return false;
  const withoutQuery = text.split(/[?#]/)[0];
  return IMAGE_EXTENSION.test(withoutQuery);
}

/**
 * Baca kotak pembatas dari satu deteksi.
 *
 * Kontrak vision repo ini: kotak adalah [x, y, width, height] ternormalisasi
 * 0..1 terhadap gambar sumber.
 *
 * @param {object} detection
 * @returns {{x:number,y:number,width:number,height:number}|null}
 */
export function readBoundingBox(detection) {
  if (!detection || typeof detection !== 'object') return null;
  for (const key of ['bbox', 'box', 'boundingBox', 'bounding_box', 'rect']) {
    const value = detection[key];
    if (Array.isArray(value) && value.length === 4) {
      const [x, y, width, height] = value.map(Number);
      if ([x, y, width, height].every((number) => Number.isFinite(number))) {
        return { x, y, width, height };
      }
    }
    if (value && typeof value === 'object') {
      const left = Number(value.left ?? value.x);
      const top = Number(value.top ?? value.y);
      const width = Number(
        value.width ??
          value.w ??
          (Number.isFinite(Number(value.right))
            ? Number(value.right) - left
            : NaN),
      );
      const height = Number(
        value.height ??
          value.h ??
          (Number.isFinite(Number(value.bottom))
            ? Number(value.bottom) - top
            : NaN),
      );
      if ([left, top, width, height].every((n) => Number.isFinite(n))) {
        return { x: left, y: top, width, height };
      }
    }
  }
  return null;
}

/**
 * Zona relatif sebuah deteksi: kiri, tengah, atau kanan.
 *
 * Hanya kotak ternormalisasi yang bisa dipetakan ke zona; kotak piksel
 * tanpa ukuran gambar tidak bisa, jadi jatuh ke tengah.
 *
 * @param {object} detection
 * @returns {'left'|'center'|'right'}
 */
export function relativeZone(detection) {
  const box = readBoundingBox(detection);
  if (!box) return 'center';
  const normalized =
    box.x >= 0 &&
    box.y >= 0 &&
    box.width > 0 &&
    box.height > 0 &&
    box.x + box.width <= 1.0001;
  if (!normalized) return 'center';
  const center = box.x + box.width / 2;
  if (center < 1 / 3) return 'left';
  if (center < 2 / 3) return 'center';
  return 'right';
}

/**
 * Hitung ringkasan adegan sebelum payload ditransformasi.
 *
 * Dipakai untuk menulis deskripsi non-real yang deterministik, apa pun
 * urutan key di payload.
 *
 * @param {unknown} payload
 * @returns {{people:number, vehicles:number}}
 */
export function collectSceneSummary(payload) {
  const summary = { people: 0, vehicles: 0 };
  const scan = (value) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) scan(item);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const name = normalizeKey(key);
      if (name === 'people' || name === 'persons' || name === 'person') {
        summary.people += Array.isArray(child) ? child.length : 1;
        continue;
      }
      if (name === 'vehicles' || name === 'vehicle') {
        summary.vehicles += Array.isArray(child) ? child.length : 1;
        continue;
      }
      scan(child);
    }
  };
  scan(payload);
  return summary;
}

/**
 * Deskripsi non-real untuk deskripsi vision asli.
 *
 * @param {{people:number, vehicles:number}} summary
 * @returns {string}
 */
export function buildSceneSummary(summary) {
  const people = summary?.people || 0;
  const vehicles = summary?.vehicles || 0;
  return `Scene summary: ${people} people, ${vehicles} vehicles; real details withheld.`;
}

/** Penghitung redaksi per kategori. */
function createCounter() {
  const counts = new Map();
  return {
    count(category) {
      counts.set(category, (counts.get(category) || 0) + 1);
    },
    entries() {
      return [...counts.entries()].map(([category, count]) => ({
        category,
        count,
      }));
    },
  };
}

/**
 * Ganti satu deteksi dengan JSON sintetis.
 *
 * Yang tersisa: id sintetis, label aktivitas, zona relatif, dan confidence.
 * Yang hilang: id asli, bbox, dan setiap koordinat absolut.
 *
 * @param {object} detection
 * @param {string} prefix
 * @param {number} index
 * @param {{count:(category:string)=>void}} counter
 * @returns {object}
 */
function synthesizeDetection(detection, prefix, index, counter) {
  const entry = { id: `${prefix}-${index + 1}`, zone: relativeZone(detection) };
  const activity =
    textOf(detection.activity) ||
    textOf(detection.action) ||
    textOf(detection.pose);
  if (activity) entry.activity = activity;
  const type =
    textOf(detection.type) || textOf(detection.kind) || textOf(detection.label);
  if (type) entry.type = type;
  if (Array.isArray(detection.holding)) {
    const holding = detection.holding.map(textOf).filter(Boolean);
    if (holding.length) entry.holding = holding;
  }
  const confidence = Number(detection.confidence);
  if (Number.isFinite(confidence)) {
    entry.confidence = Math.round(confidence * 100) / 100;
  }
  counter.count(REDACTION.PRECISE_LOCATION);
  return entry;
}

/**
 * Nilai gambar: dibuang pada lane remote, dipertahankan pada lane lokal.
 *
 * @param {string} text
 * @param {{keepImages:boolean, count:(category:string)=>void}} context
 * @returns {string}
 */
function handleImageText(text, context) {
  context.count(REDACTION.IMAGE);
  if (context.keepImages) return text;
  return IMAGE_PLACEHOLDER;
}

/**
 * Apakah nilai ini data gambar (string, byte, atau URL citra).
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isImageValue(value) {
  if (typeof value === 'string') {
    return isImageDataUrl(value) || isImageBase64(value) || isImageUrl(value);
  }
  if (value instanceof Uint8Array) return isImageBytes(value);
  if (value instanceof ArrayBuffer) {
    return isImageBytes(Buffer.from(new Uint8Array(value)));
  }
  return false;
}

/**
 * Transformasi rekursif sebuah nilai.
 *
 * @param {unknown} value
 * @param {object} context
 * @param {string|null} key kunci payload saat ini
 * @param {{people:number, vehicles:number}} summary
 * @returns {unknown}
 */
function sanitizeValue(value, context, key, summary) {
  if (value === null || value === undefined) return value;

  const name = key === null ? '' : normalizeKey(key);

  if (typeof value === 'string') {
    if (IMAGE_KEYS.has(name) || isImageValue(value)) {
      return handleImageText(value, context);
    }
    if (LOCATION_KEYS.has(name)) {
      context.count(REDACTION.PRECISE_LOCATION);
      return null;
    }
    if (DESCRIPTION_KEYS.has(name)) {
      context.count(REDACTION.VISION_DESCRIPTION);
      return buildSceneSummary(summary);
    }
    return value;
  }

  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    if (isImageValue(value)) {
      context.count(REDACTION.IMAGE);
      if (context.keepImages) return value;
      return IMAGE_PLACEHOLDER;
    }
    return value;
  }

  if (Array.isArray(value)) {
    if (name && DETECTION_KEYS.has(name)) {
      const prefix = DETECTION_PREFIX[name] || 'detection';
      return value
        .filter((item) => item && typeof item === 'object')
        .map((item, index) =>
          synthesizeDetection(item, prefix, index, context),
        );
    }
    return value.map((item) => sanitizeValue(item, context, key, summary));
  }

  if (typeof value === 'object') {
    const output = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      const childName = normalizeKey(childKey);
      if (DETECTION_KEYS.has(childName) && Array.isArray(childValue)) {
        const prefix = DETECTION_PREFIX[childName] || 'detection';
        output[childKey] = childValue
          .filter((item) => item && typeof item === 'object')
          .map((item, index) =>
            synthesizeDetection(item, prefix, index, context),
          );
        continue;
      }
      if (LOCATION_KEYS.has(childName)) {
        context.count(REDACTION.PRECISE_LOCATION);
        output[childKey] = null;
        continue;
      }
      if (DESCRIPTION_KEYS.has(childName)) {
        context.count(REDACTION.VISION_DESCRIPTION);
        output[childKey] = buildSceneSummary(summary);
        continue;
      }
      output[childKey] = sanitizeValue(childValue, context, childKey, summary);
    }
    return output;
  }

  return value;
}

/**
 * Buat writer audit yang menambahkan satu baris JSONL ke berkas lokal.
 *
 * @param {string} [filePath]
 * @returns {(record: object) => void}
 */
export function createAuditWriter(filePath = PRIVACY_AUDIT_PATH) {
  return (record) => {
    mkdirSync(path.dirname(filePath), { recursive: true });
    appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');
  };
}

/**
 * Sanitasi payload sebelum keluar ke lane mana pun.
 *
 * @param {unknown} payload payload yang akan dikirim
 * @param {SanitizeOptions} [options]
 * @returns {{payload: unknown, redactions: Redaction[]}}
 */
export function sanitizeForOutbound(payload, options = {}) {
  const {
    lane = 'remote',
    purpose = 'chat',
    writer,
    now = Date.now(),
  } = options;
  const context = {
    lane,
    keepImages: lane === LOCAL_LANE,
    count: null,
  };
  const counter = createCounter();
  context.count = (category) => counter.count(category);
  const summary = collectSceneSummary(payload);
  const clean = sanitizeValue(payload, context, null, summary);
  const redactions = counter.entries();
  const sink =
    writer === undefined ? createAuditWriter(PRIVACY_AUDIT_PATH) : writer;
  if (sink) {
    try {
      sink({ at: now, lane, purpose, redactions });
    } catch {
      // Kegagalan audit tidak boleh menggagalkan chat; redaksi tetap berlaku.
    }
  }
  return { payload: clean, redactions };
}
