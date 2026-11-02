/**
 * Lane model untuk chat God's Eye.
 *
 * Tiga lane:
 *  - local: Ollama native (POST {root}/api/chat) di mesin ini sendiri;
 *  - kilo:  Kilo Gateway keyless (tanpa header Authorization);
 *  - zen:   OpenCode Zen (Authorization: Bearer public).
 *
 * Transport memakai socket node:http/node:https sendiri, bukan fetch bawaan:
 * fetch membawa default undici (headers timeout 300 s) dan model lambat
 * mati dengan "fetch failed" sebelum jawabannya arrive.
 *
 * Socket/fetch di-inject lewat opsi `transport`, jadi test jalan offline.
 */

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { postJson, readStreamedAnswer } from '../openai/vision-request.js';

/** Katalog model gratis Kilo. */
export const KILO_MODELS_URL = 'https://api.kilo.ai/api/gateway/models';
/** Endpoint chat Kilo. */
export const KILO_CHAT_URL = 'https://api.kilo.ai/api/gateway/chat/completions';
/** Katalog model gratis OpenCode Zen. */
export const ZEN_MODELS_URL = 'https://opencode.ai/zen/v1/models';
/** Endpoint chat OpenCode Zen. */
export const ZEN_CHAT_URL = 'https://opencode.ai/zen/v1/chat/completions';

/** Base URL default lane lokal (env GEV_VISION_BASE_URL). */
export const LOCAL_BASE_URL_DEFAULT = 'http://127.0.0.1:11434/v1';
/** Model default lane lokal (env GEV_CHAT_MODEL, lalu GEV_VISION_MODEL). */
export const LOCAL_MODEL_DEFAULT = 'qwen2.5vl:3b';

/** Deadline default satu panggilan lane: model lokal butuh waktu lama. */
export const DEFAULT_TIMEOUT_MS = 900_000;
/** Batas ukuran respons lane. */
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
/** Umur cache penemuan model. */
export const DISCOVERY_TTL_MS = 5 * 60_000;

/**
 * Daftar model gratis yang dicatat dari README vendor kilo-zen2dsh
 * (packages/plugin/src/adapter/catalog.ts): dipakai saat penemuan model
 * gagal, jadi lane remote tetap punya model yang bisa dicoba.
 */
export const FALLBACK_FREE_MODELS = Object.freeze({
  kilo: Object.freeze(['kilo-auto/free', 'openrouter/free']),
  zen: Object.freeze([
    'big-pickle',
    'hy3-free',
    'mimo-v2.5-free',
    'ling-3.0-flash-fin-free',
    'nemotron-3-ultra-free',
    'nemotron-3.5-lightning-free',
    'muse-spark-1.2-contributor-free',
  ]),
});

/**
 * @typedef {object} LaneDescriptor
 * @property {string} id pengenal lane
 * @property {string} label nama untuk ditampilkan
 * @property {boolean} local true = lane berjalan di mesin ini
 * @property {string} auth cara otentikasi lane
 */

/** @type {ReadonlyArray<LaneDescriptor>} */
export const LANES = Object.freeze([
  Object.freeze({
    id: 'local',
    label: 'Local Ollama',
    local: true,
    auth: 'none',
  }),
  Object.freeze({
    id: 'kilo',
    label: 'Kilo Gateway',
    local: false,
    auth: 'keyless',
  }),
  Object.freeze({
    id: 'zen',
    label: 'OpenCode Zen',
    local: false,
    auth: 'public',
  }),
]);

/**
 * Semua lane yang bisa dipilih.
 *
 * @returns {LaneDescriptor[]}
 */
export function listLanes() {
  return LANES.map((lane) => ({ ...lane }));
}

/**
 * @typedef {object} Transport
 * @property {(url: string, options: object) => Promise<{status:number, body:string}>} request
 */

/**
 * @typedef {object} ChatAnswer
 * @property {boolean} ok true kalau lane menjawab
 * @property {string} text isi jawaban
 * @property {string|null} model model yang dipakai
 * @property {object|null} usage pemakaian token
 * @property {string} [error] kode kesalahan
 * @property {number} [status] HTTP status lane
 * @property {string} [detail] detail kesalahan
 */

/** Error pembatalan yang mengikuti pola AbortError bawaan. */
function abortError() {
  const error = new Error('lane request aborted');
  error.name = 'AbortError';
  return error;
}

/**
 * Panggilan socket dengan dukungan GET, POST, dan pembatalan.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {Record<string, string>} [options.headers]
 * @param {object} [options.body]
 * @param {number} [options.timeoutMs]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{status:number, body:string}>}
 */
export function socketRequest(url, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
  } = options;
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch (error) {
      reject(error);
      return;
    }
    const payload =
      body === undefined ? null : Buffer.from(JSON.stringify(body));
    const requester = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = requester(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method,
        headers: {
          Accept: 'application/json',
          ...(payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': payload.length,
              }
            : {}),
          ...headers,
        },
      },
      (response) => {
        const chunks = [];
        let length = 0;
        response.on('data', (chunk) => {
          length += chunk.length;
          if (length > MAX_RESPONSE_BYTES) {
            request.destroy();
            reject(new Error('lane response is too large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          resolve({
            status: response.statusCode || 502,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    request.setTimeout(timeoutMs, () => {
      request.destroy();
      reject(new Error(`lane timed out after ${timeoutMs} ms`));
    });
    request.on('error', reject);
    if (signal) {
      if (signal.aborted) {
        request.destroy();
        reject(abortError());
        return;
      }
      const onAbort = () => {
        request.destroy();
        reject(abortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      request.on('close', () => signal.removeEventListener('abort', onAbort));
    }
    if (payload) request.end(payload);
    else request.end();
  });
}

/**
 * Transport bawaan: POST pakai postJson milik repo, GET dan POST yang punya
 * signal pakai socketRequest (postJson tidak bisa dibatalkan).
 *
 * @type {Transport}
 */
export const defaultTransport = {
  async request(url, options = {}) {
    const { method = 'GET', headers = {}, body, timeoutMs, signal } = options;
    if (method === 'POST' && !signal) {
      return postJson(url, body, { headers, timeoutMs });
    }
    return socketRequest(url, { method, headers, body, timeoutMs, signal });
  },
};

/** Cache penemuan model per lane. */
const discoveryCache = new Map();

/** Buang cache penemuan model (dipakai test dan saat start ulang). */
export function clearModelCache() {
  discoveryCache.clear();
}

/**
 * Header lane.
 *
 * Kilo keyless: TIDAK ada header Authorization sama sekali.
 * Zen: placeholder publik `Bearer public` seperti klien OpenCode.
 *
 * @param {string} lane
 * @returns {Record<string, string>}
 */
export function laneHeaders(lane) {
  if (lane === 'zen') {
    return {
      'Content-Type': 'application/json',
      Authorization: 'Bearer public',
      'User-Agent': 'opencode/gods-eye/1.0/cli',
    };
  }
  if (lane === 'kilo') {
    return {
      'Content-Type': 'application/json',
      'X-KILOCODE-EDITORNAME': 'gods-eye',
      'X-KILOCODE-TASKID': 'gods-eye-chat',
      'X-KILOCODE-PROJECTID': 'gods-eye',
    };
  }
  return { 'Content-Type': 'application/json' };
}

/**
 * Base URL lane lokal (env GEV_VISION_BASE_URL).
 *
 * @param {Record<string, string|undefined>} [environment]
 * @returns {string}
 */
export function localBaseUrl(environment = process.env) {
  const configured = String(environment?.GEV_VISION_BASE_URL || '')
    .trim()
    .replace(/\/+$/, '');
  return configured || LOCAL_BASE_URL_DEFAULT;
}

/**
 * Akar server Ollama: base OpenAI-compatible berakhiran /v1, sedangkan
 * endpoint native /api/chat hidup di akar server.
 *
 * @param {string} base
 * @returns {string}
 */
export function localRootUrl(base) {
  return String(base || '').replace(/\/v\d+$/, '');
}

/**
 * URL chat native lane lokal.
 *
 * @param {Record<string, string|undefined>} [environment]
 * @returns {string}
 */
export function localChatUrl(environment = process.env) {
  return `${localRootUrl(localBaseUrl(environment))}/api/chat`;
}

/**
 * Model lane lokal untuk **chat teks**.
 *
 * `GEV_CHAT_MODEL` didahulukan. Sebelum ini lane chat meminjam
 * `GEV_VISION_MODEL`, jadi obrolan teks dijawab model vision 3B — lambat dan
 * jawabannya melenceng ("tower terdekat ada di sebelah kiri"). `GEV_VISION_MODEL`
 * tetap dibaca sebagai cadangan supaya pemasangan lama tidak rusak, tapi
 * pemasangan baru sebaiknya mengisi keduanya.
 *
 * @param {Record<string, string|undefined>} [environment]
 * @returns {string}
 */
export function localModel(environment = process.env) {
  const chat = String(environment?.GEV_CHAT_MODEL || '').trim();
  if (chat) return chat;
  const vision = String(environment?.GEV_VISION_MODEL || '').trim();
  return vision || LOCAL_MODEL_DEFAULT;
}

/**
 * Apakah sebuah model masuk lane gratis.
 *
 * Aturan mengikuti vendor: flag eksplisit (isFree/is_free) authoritative,
 * lalu sufiks nama untuk deployment lama.
 *
 * @param {string} id
 * @param {object} [row] baris katalog
 * @param {string} [lane]
 * @returns {boolean}
 */
export function isFreeModel(id, row = null, lane = 'kilo') {
  const name = String(id || '').trim();
  if (!name) return false;
  if (row && typeof row === 'object') {
    if (row.deprecated === true) return false;
    for (const flag of [row.isFree, row.is_free]) {
      if (typeof flag === 'boolean') return flag;
    }
  }
  const lower = name.toLowerCase();
  if (lane === 'zen') {
    return (
      lower === 'big-pickle' ||
      lower.endsWith(':free') ||
      lower.endsWith('-free')
    );
  }
  return (
    lower === 'kilo-auto/free' ||
    lower === 'openrouter/free' ||
    lower.endsWith(':free') ||
    lower.endsWith('-free')
  );
}

/**
 * Baca daftar model dari respons katalog.
 *
 * @param {string} body
 * @param {string} lane
 * @returns {string[]}
 */
export function parseModelIds(body, lane) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.data)
      ? parsed.data
      : Array.isArray(parsed?.models)
        ? parsed.models
        : [];
  const ids = [];
  for (const row of rows) {
    const id =
      typeof row === 'string' ? row : typeof row?.id === 'string' ? row.id : '';
    if (!id) continue;
    if (!isFreeModel(id, typeof row === 'object' ? row : null, lane)) continue;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Penemuan model per lane, dengan cache TTL.
 *
 * @param {string} lane
 * @param {object} [options]
 * @param {Transport} [options.transport]
 * @param {number} [options.now]
 * @returns {Promise<{at:number, models:string[]}>}
 */
export async function discoverModels(lane, options = {}) {
  const { transport = defaultTransport, now = Date.now() } = options;
  const cached = discoveryCache.get(lane);
  if (cached && now - cached.at < DISCOVERY_TTL_MS) return cached;
  const url = lane === 'kilo' ? KILO_MODELS_URL : ZEN_MODELS_URL;
  const response = await transport.request(url, {
    method: 'GET',
    headers: laneHeaders(lane),
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `lane ${lane} model discovery failed with HTTP ${response.status}`,
    );
  }
  const entry = { at: now, models: parseModelIds(response.body, lane) };
  discoveryCache.set(lane, entry);
  return entry;
}

/**
 * Model yang dipakai satu lane.
 *
 * @param {string} lane
 * @param {object} [options]
 * @param {string} [options.model] model eksplisit dari pemanggil
 * @param {Transport} [options.transport]
 * @param {Record<string, string|undefined>} [options.environment]
 * @param {number} [options.now]
 * @returns {Promise<{lane:string, model:string|null, models:string[], source:string}>}
 */
export async function resolveModel(lane, options = {}) {
  const { model, transport, environment, now } = options;
  if (model) return { lane, model, models: [], source: 'request' };
  if (lane === 'local') {
    return {
      lane,
      model: localModel(environment),
      models: [],
      source: 'environment',
    };
  }
  const fallback = FALLBACK_FREE_MODELS[lane]?.[0] || null;
  try {
    const discovery = await discoverModels(lane, { transport, now });
    if (discovery.models.length) {
      return {
        lane,
        model: discovery.models[0],
        models: discovery.models,
        source: 'discovery',
      };
    }
  } catch {
    // Penemuan gagal: pakai daftar model gratis dari README vendor.
  }
  return { lane, model: fallback, models: [], source: 'fallback' };
}

/**
 * Ambil teks dari satu chunk OpenAI-shaped.
 *
 * @param {object} chunk
 * @returns {{text:string}|null}
 */
function fromOpenAiChunk(chunk) {
  const choice = chunk?.choices?.[0];
  const content =
    choice?.message?.content ?? choice?.delta?.content ?? choice?.text;
  if (typeof content === 'string') return content ? { text: content } : null;
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (typeof part === 'string' ? part : part?.text || ''))
      .join('');
    return text ? { text } : null;
  }
  return null;
}

/**
 * Baca jawaban OpenAI-shaped: JSON utuh, NDJSON, atau SSE.
 *
 * @param {string} body
 * @returns {{text:string, usage:object|null}}
 */
export function readOpenAiAnswer(body) {
  const raw = String(body || '').trim();
  if (!raw) return { text: '', usage: null };
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (parsed && typeof parsed === 'object') {
    const answer = fromOpenAiChunk(parsed);
    if (answer) return { text: answer.text, usage: parsed.usage || null };
  }
  let text = '';
  let usage = null;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === '[DONE]') continue;
    const payload = trimmed.startsWith('data:')
      ? trimmed.slice(5).trim()
      : trimmed;
    if (!payload) continue;
    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      continue;
    }
    const answer = fromOpenAiChunk(chunk);
    if (answer) text += answer.text;
    if (chunk?.usage) usage = chunk.usage;
  }
  return { text, usage };
}

/**
 * Baca pemakaian token dari jawaban Ollama.
 *
 * @param {string} body
 * @returns {object|null}
 */
export function readOllamaUsage(body) {
  let usage = null;
  for (const line of String(body || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let chunk;
    try {
      chunk = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const prompt = Number(chunk?.prompt_eval_count);
    const completion = Number(chunk?.eval_count);
    if (Number.isFinite(prompt) || Number.isFinite(completion)) {
      usage = {
        prompt_tokens: Number.isFinite(prompt) ? prompt : 0,
        completion_tokens: Number.isFinite(completion) ? completion : 0,
        total_tokens:
          (Number.isFinite(prompt) ? prompt : 0) +
          (Number.isFinite(completion) ? completion : 0),
      };
    }
  }
  return usage;
}

/**
 * Ubah pesan OpenAI-shaped menjadi format native Ollama.
 *
 * @param {Array<object>} messages
 * @returns {Array<object>}
 */
export function toOllamaMessages(messages) {
  return messages.map((message) => {
    const images = [];
    let text = '';
    const content = message?.content;
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part?.type === 'text') {
          text += part.text || '';
          continue;
        }
        const url = String(part?.image_url?.url || part?.image || '');
        // Ollama native hanya menerima base64, bukan URL.
        if (/^data:[^;]+;base64,/i.test(url)) {
          images.push(url.replace(/^data:[^;]+;base64,/i, ''));
        }
      }
    }
    if (Array.isArray(message?.images)) images.push(...message.images);
    const next = { role: message?.role || 'user', content: text };
    if (images.length) next.images = images;
    return next;
  });
}

/**
 * Jawab satu chat di lane yang dipilih.
 *
 * @param {object} options
 * @param {string} [options.lane]
 * @param {string} [options.model]
 * @param {Array<object>} [options.messages]
 * @param {AbortSignal} [options.signal]
 * @param {Transport} [options.transport]
 * @param {Record<string, string|undefined>} [options.environment]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<ChatAnswer>}
 */
export async function chatComplete(options = {}) {
  const {
    lane = 'local',
    model,
    messages = [],
    signal,
    transport = defaultTransport,
    environment = process.env,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;
  const resolved = await resolveModel(lane, {
    model,
    transport,
    environment,
  });
  const target = resolved.model;
  if (!target) {
    return {
      ok: false,
      text: '',
      model: null,
      usage: null,
      error: 'no_model',
      detail: `lane ${lane} has no model available`,
    };
  }
  try {
    if (lane === 'local') {
      const response = await transport.request(localChatUrl(environment), {
        method: 'POST',
        headers: laneHeaders(lane),
        body: {
          model: target,
          messages: toOllamaMessages(messages),
          stream: false,
        },
        signal,
        timeoutMs,
      });
      if (response.status < 200 || response.status >= 300) {
        return {
          ok: false,
          text: '',
          model: target,
          usage: null,
          error: 'lane_error',
          status: response.status,
          detail: response.body.slice(0, 400),
        };
      }
      const streamed = readStreamedAnswer(response.body);
      return {
        ok: true,
        text: streamed.deltas || streamed.cumulative || '',
        model: target,
        usage: readOllamaUsage(response.body) || streamed.usage || null,
      };
    }
    const url = lane === 'kilo' ? KILO_CHAT_URL : ZEN_CHAT_URL;
    const response = await transport.request(url, {
      method: 'POST',
      headers: laneHeaders(lane),
      body: { model: target, messages, stream: false },
      signal,
      timeoutMs,
    });
    if (response.status < 200 || response.status >= 300) {
      return {
        ok: false,
        text: '',
        model: target,
        usage: null,
        error: 'lane_error',
        status: response.status,
        detail: response.body.slice(0, 400),
      };
    }
    const answer = readOpenAiAnswer(response.body);
    return {
      ok: true,
      text: answer.text,
      model: target,
      usage: answer.usage || null,
    };
  } catch (error) {
    return {
      ok: false,
      text: '',
      model: target,
      usage: null,
      error: error?.name === 'AbortError' ? 'aborted' : 'lane_unreachable',
      detail: error?.message || 'the lane did not answer',
    };
  }
}
