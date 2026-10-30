import { enforceRateLimit, openAiRateLimiter } from './rate-limit.js';
import { readRequestBody } from '../common/request.js';
import {
  hasVisionGateway,
  visionApiKey,
  visionBaseUrl,
  visionModel,
} from './base-url.js';
import {
  JSON_INSTRUCTION,
  parseSceneReply,
  SCENE_PROMPT,
} from './vision-contract.js';
import { postJson, readStreamedAnswer } from './vision-request.js';

/**
 * @module vision
 * @description Vision analysis through an OpenAI-compatible gateway.
 *
 * The gateway can be a free local model server (Ollama), a free-tier cloud
 * endpoint (Groq, OpenRouter free models, Cloudflare Workers AI) or the
 * OpenAI API itself. With no gateway configured the route answers 503
 * no_gateway and never calls out.
 *
 * Ollama is called through its native /api/chat endpoint: the OpenAI-compatible
 * endpoint ignores per-request context settings (a full street photo needs
 * ~4300 tokens, more than the 4096 default) and would try to offload to a GPU
 * that may be too small, which crashes the local model server mid-request.
 *
 * Request:  POST /api/openai/vision
 *   { imageUrl: string, prompt?: string, maxTokens?: number }
 * imageUrl accepts an http(s) URL or a data: URL.
 *
 * Response: 200 { ok, model, gateway, text, usage } on success; 4xx/5xx with
 * { error, hint? } otherwise.
 */

const DEFAULT_PROMPT =
  'Describe this image in one short sentence. If people are visible, say what they appear to be holding and what they appear to be doing. If nothing is clear, say so.';
const MAX_BODY_BYTES = 256 * 1024;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const IMAGE_FETCH_TIMEOUT_MS = 30000;
/**
 * A local model on a busy CPU can take minutes to answer, and the default
 * headers timeout of fetch is 300 s: the request would die with "fetch
 * failed" while the model is still working. The vision call gets its own,
 * longer deadline.
 */
const GATEWAY_TIMEOUT_MS = 900_000;
const DEFAULT_MAX_TOKENS = 120;
const MAX_TOKENS_CEILING = 400;
/** A scene answer is JSON with one entry per person, so it needs room. */
const SCENE_DEFAULT_MAX_TOKENS = 700;
const SCENE_MAX_TOKENS_CEILING = 1600;
const PRIVATE_HOST_PATTERN =
  /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/i;

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

/** Pull the assistant text out of a chat-completions style response. */
function extractChatCompletionText(data) {
  const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
  const message = choice?.message || choice?.delta || null;
  const content = message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => part?.text || part?.content || '')
      .join(' ')
      .trim();
  }
  if (typeof data?.output_text === 'string') return data.output_text.trim();
  return '';
}

/** Fetch a public image and return { base64, mime }. Private hosts are refused. */
async function fetchRemoteImage(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('only http(s) image URLs are supported');
  }
  if (PRIVATE_HOST_PATTERN.test(parsed.hostname)) {
    throw new Error('private and loopback hosts are not allowed');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(parsed.href, { signal: controller.signal });
    if (!response.ok) throw new Error(`image HTTP ${response.status}`);
    const type = (response.headers.get('content-type') || 'image/jpeg').split(
      ';',
    )[0];
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new Error('image is larger than the allowed size');
    }
    return { base64: buffer.toString('base64'), mime: type };
  } finally {
    clearTimeout(timer);
  }
}

/** Split a data URL into { base64, mime }. */
function parseDataUrl(value) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(value);
  if (!match) return null;
  const mime = match[1] || 'image/jpeg';
  if (!match[2]) {
    return {
      base64: Buffer.from(decodeURIComponent(match[3]), 'utf8').toString(
        'base64',
      ),
      mime,
    };
  }
  return { base64: match[3], mime };
}

async function handleVisionAnalyze(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'method_not_allowed' });
  }
  if (!hasVisionGateway()) {
    return sendJson(res, 503, {
      error: 'no_gateway',
      hint: 'Set GEV_VISION_BASE_URL (or GEV_OPENAI_BASE_URL) to an OpenAI-compatible gateway, e.g. http://127.0.0.1:11434/v1 for a local Ollama server.',
    });
  }
  // Reuse the OpenAI cost-endpoint limiter: a gateway can be a local GPU, and
  // an unbounded loop of vision calls would starve it.
  if (!enforceRateLimit(openAiRateLimiter(), req, res)) return;

  let context = {};
  try {
    const body = await readRequestBody(req, MAX_BODY_BYTES);
    context = JSON.parse(body || '{}');
  } catch (error) {
    return sendJson(res, 400, {
      error: 'bad_request',
      detail: error?.message || 'invalid json body',
    });
  }

  const image = String(context.imageUrl || context.image || '').trim();
  if (!image) {
    return sendJson(res, 400, {
      error: 'image_required',
      hint: 'Provide imageUrl (an http(s) URL or a data: URL).',
    });
  }

  const scene = context.scene === true || context.mode === 'scene';
  const prompt = scene
    ? `${SCENE_PROMPT}\n\n${JSON_INSTRUCTION}`
    : String(context.prompt || DEFAULT_PROMPT);
  // A scene answer is JSON, so the instruction lives in the system message
  // and the user message only asks for the analysis.
  const userText = scene ? 'Analyze this image.' : prompt;
  const model = visionModel();
  const gateway = visionBaseUrl();
  const key = visionApiKey();
  const requestedTokens = Number(context.maxTokens);
  const ceiling = scene ? SCENE_MAX_TOKENS_CEILING : MAX_TOKENS_CEILING;
  const maxTokens = Number.isFinite(requestedTokens)
    ? Math.min(ceiling, Math.max(16, requestedTokens))
    : scene
      ? SCENE_DEFAULT_MAX_TOKENS
      : DEFAULT_MAX_TOKENS;
  const ollama = /:11434\b/.test(gateway);

  try {
    let text = '';
    let usage = null;
    /** Every reading of the answer, most complete first. */
    const answerCandidates = [];
    if (ollama) {
      // Ollama takes base64 images and honours the context and GPU settings.
      let payload = parseDataUrl(image);
      if (!payload) {
        if (!/^https?:/i.test(image)) {
          return sendJson(res, 400, {
            error: 'image_required',
            hint: 'Provide an http(s) URL or a data: URL.',
          });
        }
        payload = await fetchRemoteImage(image);
      }
      const { status, body: raw } = await postJson(
        `${gateway.replace(/\/v1$/, '')}/api/chat`,
        {
          model,
          messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: userText, images: [payload.base64] },
          ],
          // Stream: a CPU-only vision pass takes minutes, and a client that
          // waits for the full answer gets its connection closed first.
          stream: true,
          options: {
            num_ctx: Number(process.env.GEV_VISION_NUM_CTX || 8192),
            num_gpu: Number(process.env.GEV_VISION_NUM_GPU ?? 0),
            temperature: 0.2,
            num_predict: maxTokens,
          },
        },
        { timeoutMs: GATEWAY_TIMEOUT_MS },
      );
      if (status < 200 || status >= 300) {
        return sendJson(res, status || 502, {
          error: 'upstream_error',
          gateway,
          model,
          detail: raw.slice(0, 300) || `gateway HTTP ${status}`,
        });
      }
      const streamed = readStreamedAnswer(raw);
      text = streamed.cumulative || streamed.deltas;
      usage = streamed.usage;
      answerCandidates.push(streamed.cumulative, streamed.deltas);
    } else {
      const { status, body: raw } = await postJson(
        `${gateway}/chat/completions`,
        {
          model,
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: prompt },
            {
              role: 'user',
              content: [
                { type: 'text', text: userText },
                { type: 'image_url', image_url: { url: image } },
              ],
            },
          ],
        },
        { headers: key ? { Authorization: `Bearer ${key}` } : {} },
      );
      if (status < 200 || status >= 300) {
        const data = (() => {
          try {
            return JSON.parse(raw || '{}');
          } catch {
            return {};
          }
        })();
        return sendJson(res, status || 502, {
          error: 'upstream_error',
          gateway,
          model,
          detail:
            data?.error?.message ||
            data?.message ||
            raw.slice(0, 300) ||
            'gateway rejected the request',
        });
      }
      const data = (() => {
        try {
          return JSON.parse(raw || '{}');
        } catch {
          return {};
        }
      })();
      text = extractChatCompletionText(data);
      usage = data?.usage || null;
      answerCandidates.push(text);
    }
    let detections = null;
    if (scene) {
      // The stream carries deltas or the cumulative message, depending on the
      // build: the one that parses as the contract is the real answer.
      for (const candidate of answerCandidates.filter(Boolean)) {
        const attempt = parseSceneReply(candidate);
        if (attempt.parsed) {
          detections = attempt;
          text = candidate;
          break;
        }
        if (!detections) detections = attempt;
      }
    }
    return sendJson(res, 200, {
      ok: true,
      model,
      gateway,
      text,
      usage,
      ...(scene ? { detections } : {}),
    });
  } catch (error) {
    const blocked = String(error?.message || '').includes('not allowed');
    return sendJson(res, blocked ? 400 : 502, {
      error: blocked ? 'image_fetch_failed' : 'gateway_unreachable',
      gateway,
      model,
      detail: error?.message || 'gateway request failed',
    });
  }
}

export { handleVisionAnalyze, DEFAULT_PROMPT };
