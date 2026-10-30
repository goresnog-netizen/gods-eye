import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

/**
 * POST JSON to a gateway and read the whole answer.
 *
 * The built-in fetch carries undici's defaults: a 300 s headers timeout and
 * a 300 s body timeout. A local vision model on a busy CPU needs longer than
 * that to produce its first byte, and the request then dies with a bare
 * "fetch failed" while the model is still working. A plain socket request has
 * no such cap, so the deadline is ours.
 */

/** The default deadline for a gateway call: long enough for a CPU model. */
export const DEFAULT_GATEWAY_TIMEOUT_MS = 900_000;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

/**
 * @param {string} url
 * @param {object} payload
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @param {Record<string, string>} [options.headers]
 * @returns {Promise<{status: number, body: string}>}
 */
export function postJson(url, payload, options = {}) {
  const { timeoutMs = DEFAULT_GATEWAY_TIMEOUT_MS, headers = {} } = options;
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch (error) {
      reject(error);
      return;
    }
    const body = Buffer.from(JSON.stringify(payload));
    const requester = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = requester(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body.length,
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
            reject(new Error('gateway response is too large'));
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
      reject(new Error(`gateway timed out after ${timeoutMs} ms`));
    });
    request.on('error', reject);
    request.end(body);
  });
}

/**
 * Read a streamed answer.
 *
 * Ollama streams either the deltas of the message or the cumulative message,
 * and the builds differ. Both readings are returned: `deltas` is every piece
 * joined in order, `cumulative` is the last full message. A caller that wants
 * a JSON answer tries both, because only one of them is the whole text.
 *
 * @param {string} body newline-delimited JSON
 * @returns {{deltas: string, cumulative: string, usage: object|null, done: boolean}}
 */
export function readStreamedAnswer(body) {
  const lines = String(body || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  let deltas = '';
  let cumulative = '';
  let usage = null;
  let done = false;
  for (const line of lines) {
    let chunk;
    try {
      chunk = JSON.parse(line);
    } catch {
      continue;
    }
    const content = chunk?.message?.content;
    if (typeof content === 'string' && content) {
      deltas += content;
      cumulative = content;
    }
    if (chunk?.usage) usage = chunk.usage;
    if (chunk?.done) done = true;
  }
  return { deltas, cumulative, usage, done };
}
