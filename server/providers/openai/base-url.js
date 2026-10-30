/**
 * @module base-url
 * @description Resolve the API base URL for OpenAI-compatible traffic.
 *
 * The default is the OpenAI API. Point GEV_OPENAI_BASE_URL at any
 * OpenAI-compatible gateway to route the same calls elsewhere:
 *
 *   - Ollama (local, free, vision-capable models):
 *     GEV_OPENAI_BASE_URL=http://127.0.0.1:11434/v1
 *   - LiteLLM proxy (self-hosted router over many providers):
 *     GEV_OPENAI_BASE_URL=http://127.0.0.1:4000/v1
 *   - OpenRouter free models / Groq / Cloudflare Workers AI:
 *     GEV_OPENAI_BASE_URL=https://openrouter.ai/api/v1
 *
 * The base URL may or may not end in /v1; the version segment is added when it
 * is missing, so http://127.0.0.1:11434 and http://127.0.0.1:11434/v1 resolve
 * to the same endpoints.
 */

const OPENAI_BASE_URL_DEFAULT = 'https://api.openai.com';

/** Trim whitespace and any trailing slashes. */
function trimTrailingSlash(value) {
  return String(value || '')
    .trim()
    .replace(/\/+$/, '');
}

function readEnv(name, environment) {
  return String((environment || process.env)?.[name] || '').trim();
}

/** Base URL for OpenAI-protocol calls, without a trailing slash. */
function openAiBaseUrl(environment) {
  return (
    trimTrailingSlash(readEnv('GEV_OPENAI_BASE_URL', environment)) ||
    OPENAI_BASE_URL_DEFAULT
  );
}

/** Base URL including the API version segment (/v1) when it is missing. */
function openAiVersionedBaseUrl(environment) {
  const base = openAiBaseUrl(environment);
  return /\/v\d+$/.test(base) ? base : `${base}/v1`;
}

/** The vision gateway base URL; falls back to the OpenAI-compatible base. */
function visionBaseUrl(environment) {
  const configured = trimTrailingSlash(
    readEnv('GEV_VISION_BASE_URL', environment),
  );
  if (configured)
    return /\/v\d+$/.test(configured) ? configured : `${configured}/v1`;
  return openAiVersionedBaseUrl(environment);
}

/**
 * Model id for the vision gateway. An explicit GEV_VISION_MODEL always wins;
 * otherwise a local Ollama server gets a vision model and everything else gets
 * a small hosted one.
 */
function visionModel(environment) {
  const configured = readEnv('GEV_VISION_MODEL', environment);
  if (configured) return configured;
  return /:11434\b/.test(visionBaseUrl(environment))
    ? 'qwen2.5vl:3b'
    : 'gpt-4o-mini';
}

/** API key for the vision gateway; empty means an unauthenticated local server. */
function visionApiKey(environment) {
  return (
    readEnv('GEV_VISION_API_KEY', environment) ||
    readEnv('OPENAI_API_KEY', environment)
  );
}

/** True when a gateway is configured, so the route can answer instead of 503. */
function hasVisionGateway(environment) {
  return Boolean(
    readEnv('GEV_VISION_BASE_URL', environment) ||
    readEnv('GEV_OPENAI_BASE_URL', environment),
  );
}

export {
  OPENAI_BASE_URL_DEFAULT,
  openAiBaseUrl,
  openAiVersionedBaseUrl,
  visionBaseUrl,
  visionModel,
  visionApiKey,
  hasVisionGateway,
};
