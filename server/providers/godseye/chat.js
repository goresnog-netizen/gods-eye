/**
 * Handler chat God's Eye.
 *
 * Alur satu permintaan:
 *  1. task dicocokkan ke modul skill yang ditanam;
 *  2. task yang butuh modul localOnly TIDAK boleh jalan di lane remote:
 *     jawabannya jelas, tanpa mengirim data apa pun;
 *  3. payload outbound disanitasi privacy guard (gambar keluar, bbox jadi
 *     JSON sintetis) sebelum request ke lane;
 *  4. lane menjawab, riwayatnya ditulis lokal sebagai JSONL.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { readRequestBody } from '../common/request.js';
import { DATA_DIR, PRIVACY_RULES, sanitizeForOutbound } from './privacy.js';
import {
  loadSkillLibrary,
  matchSkills,
  renderSkillContext,
} from './skill-library.js';
import { chatComplete, listLanes } from './llm-lanes.js';

/** Berkas riwayat chat lokal (JSONL, append). */
export const CHAT_HISTORY_PATH = path.join(DATA_DIR, 'chat-history.jsonl');

/** Batas ukuran body request. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** Lane yang dikenal; anything else jatuh ke lane privat lokal. */
const KNOWN_LANES = new Set(listLanes().map((lane) => lane.id));

/**
 * @typedef {object} ChatRequestBody
 * @property {string} [message] pesan user
 * @property {string} [lane] lane tujuan
 * @property {string} [model] model eksplisit
 * @property {object} [scene] adegan vision dari klien
 */

/**
 * @typedef {object} ChatOptions
 * @property {object} [transport] transport lane yang di-inject (test)
 * @property {Record<string, string|undefined>} [environment] env yang di-inject
 * @property {(record: object) => void} [writer] writer audit yang di-inject
 * @property {string} [historyPath] berkas riwayat yang di-inject
 * @property {string} [libraryPath] berkas pustaka skill yang di-inject
 * @property {AbortSignal} [signal]
 */

/** Balas JSON dengan header cache yang sama seperti route lain. */
function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

/**
 * Lane yang diminta; nilai tak dikenal memakai lane privat lokal.
 *
 * @param {unknown} lane
 * @returns {string}
 */
export function normalizeLane(lane) {
  const name = String(lane || '')
    .trim()
    .toLowerCase();
  if (KNOWN_LANES.has(name)) return name;
  return 'local';
}

/**
 * Bentuk publik pustaka skill: yang dikirim ke klien.
 *
 * @param {object} library
 * @returns {Array<object>}
 */
export function publicSkills(library) {
  return library.modules.map((module) => ({
    id: module.id,
    title: module.title,
    capability: module.capability,
    localOnly: module.localOnly,
    remoteSafe: module.remoteSafe,
  }));
}

/**
 * Deskripsi adegan sintetis: jumlah orang, label aktivitas, zona relatif.
 *
 * @param {object|null} scene adegan yang sudah disanitasi
 * @returns {object|null}
 */
export function sceneDescriptor(scene) {
  if (!scene || typeof scene !== 'object') return null;
  const detections =
    scene.detections && typeof scene.detections === 'object'
      ? scene.detections
      : scene;
  const people = Array.isArray(detections.people) ? detections.people : [];
  const vehicles = Array.isArray(detections.vehicles)
    ? detections.vehicles
    : [];
  if (!people.length && !vehicles.length) return null;
  return {
    personCount: people.length,
    vehicleCount: vehicles.length,
    people: people.map((person) => ({
      id: person?.id || '',
      activity: person?.activity || '',
      zone: person?.zone || 'center',
    })),
    vehicles: vehicles.map((vehicle) => ({
      id: vehicle?.id || '',
      type: vehicle?.type || '',
      zone: vehicle?.zone || 'center',
    })),
  };
}

/**
 * What the console can and cannot do, stated plainly for the model.
 *
 * A small local model with no facts about its host will confabulate: asked for
 * the nearest tower it answers with a direction, because "direction" is the
 * shape of the question. These lines are the boundary it must answer inside.
 */
export const CONSOLE_FACTS = [
  'CONSOLE FACTS (answer inside these, and say so when a question falls outside):',
  '- A phone number carries no position. The console reads the operator from the Indonesian numbering prefix; it never turns a number into coordinates.',
  '- A cell id (mcc-mnc-lac-cellid) resolves against a local registry of ~2,300 towers and returns a real tower position with an accuracy radius.',
  '- Metre accuracy needs an operator feed (timing advance), which this console does not have and cannot obtain on its own.',
  '- Terrain range comes from a DEM viewshed; land cover comes from ESA WorldCover. Coverage is a fraction of a province box, not a promise.',
  '- If you do not know a number, say you do not know. Never invent a coordinate, a distance or a bearing.',
].join('\n');

/**
 * System prompt: skill yang ditanam, aturan privasi, dan deskripsi adegan.
 *
 * @param {object} options
 * @param {object} options.library pustaka skill
 * @param {object|null} [options.scene] adegan yang sudah disanitasi
 * @returns {string}
 */
export function buildSystemPrompt({ library, scene = null } = {}) {
  const parts = [
    'You are the chat assistant of the God Eye console, a local research console for open-source situational awareness.',
    // The console's own facts. Without these a small model invents answers
    // about what the console can do — it once replied that the nearest tower
    // to Waena was "on the left", which is not a thing a registry can say.
    CONSOLE_FACTS,
    renderSkillContext(library),
    ...PRIVACY_RULES,
  ];
  const descriptor = sceneDescriptor(scene);
  if (descriptor) {
    parts.push(
      `SYNTHETIC SCENE DESCRIPTOR (no real coordinates, no image bytes): ${JSON.stringify(descriptor)}`,
    );
  }
  return parts.join('\n');
}

/**
 * Isi pesan user; gambar hanya ikut kalau masih ada setelah sanitasi.
 *
 * @param {string} message
 * @param {object|null} scene adegan yang sudah disanitasi
 * @returns {string|Array<object>}
 */
export function buildUserContent(message, scene) {
  const image = String(scene?.image || '');
  if (!image.startsWith('data:image/')) return message;
  return [
    { type: 'text', text: message },
    { type: 'image_url', image_url: { url: image } },
  ];
}

/**
 * Tambahkan satu baris riwayat ke berkas JSONL lokal.
 *
 * @param {object} entry
 * @param {string} [filePath]
 */
export function appendHistory(entry, filePath = CHAT_HISTORY_PATH) {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // Riwayat adalah pelengkap; kegagalannya tidak boleh menggagalkan chat.
  }
}

/**
 * Handler POST /api/godseye/chat.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {ChatOptions} [options]
 * @returns {Promise<void>}
 */
export async function handleChat(req, res, options = {}) {
  const {
    transport,
    environment = process.env,
    writer,
    historyPath = CHAT_HISTORY_PATH,
    libraryPath,
    signal,
  } = options;
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  }
  let body = null;
  try {
    const raw = await readRequestBody(req, MAX_BODY_BYTES);
    body = raw ? JSON.parse(raw) : {};
  } catch (error) {
    return sendJson(res, 400, {
      ok: false,
      error: 'invalid_json',
      detail: error?.message || 'the body is not valid JSON',
    });
  }
  const message = String(body?.message || '').trim();
  if (!message) {
    return sendJson(res, 400, { ok: false, error: 'message_required' });
  }
  const lane = normalizeLane(body?.lane);
  const model = body?.model ? String(body.model) : undefined;
  const scene =
    body?.scene && typeof body.scene === 'object' && !Array.isArray(body.scene)
      ? body.scene
      : null;

  const library = await loadSkillLibrary(
    libraryPath ? { filePath: libraryPath } : undefined,
  );
  const skills = publicSkills(library);
  const required = matchSkills(message, library);
  const blocked =
    lane === 'local' ? [] : required.filter((module) => module.localOnly);

  if (blocked.length) {
    const names = blocked.map((module) => module.id).join(', ');
    const reply =
      `This task needs the local-only skill ${names}, and that skill cannot run on the "${lane}" lane. ` +
      'Its data stays on this machine: switch to the local lane to run it.';
    appendHistory(
      { at: Date.now(), role: 'assistant', lane, model: null, text: reply },
      historyPath,
    );
    return sendJson(res, 200, {
      ok: true,
      reply,
      lane,
      model: null,
      redactions: [],
      skills,
      required: required.map((module) => module.id),
      blocked: blocked.map((module) => module.id),
      error: 'local_only_skill',
    });
  }

  const sanitized = sanitizeForOutbound(
    { message, scene },
    { lane, purpose: 'chat', writer },
  );
  const safeScene = sanitized.payload?.scene || null;
  const safeMessage = String(sanitized.payload?.message ?? message);
  const system = buildSystemPrompt({ library, scene: safeScene });
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: buildUserContent(safeMessage, safeScene) },
  ];

  appendHistory(
    { at: Date.now(), role: 'user', lane, model: model || null, text: message },
    historyPath,
  );

  const answer = await chatComplete({
    lane,
    model,
    messages,
    transport,
    environment,
    signal,
  });

  if (!answer.ok) {
    return sendJson(res, 502, {
      ok: false,
      error: answer.error || 'lane_unreachable',
      detail: answer.detail || 'the lane did not answer',
      lane,
      model: answer.model || null,
      redactions: sanitized.redactions,
      skills,
      required: required.map((module) => module.id),
    });
  }

  const reply = String(answer.text || '').trim();
  appendHistory(
    {
      at: Date.now(),
      role: 'assistant',
      lane,
      model: answer.model || null,
      text: reply,
      redactions: sanitized.redactions,
    },
    historyPath,
  );
  return sendJson(res, 200, {
    ok: true,
    reply,
    lane,
    model: answer.model || null,
    redactions: sanitized.redactions,
    skills,
    required: required.map((module) => module.id),
    usage: answer.usage || null,
  });
}
