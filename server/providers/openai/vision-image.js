/**
 * Normalise an image before it reaches a vision model.
 *
 * Two things were wrong with the old path, and both were invisible from the
 * response: a 2592×1936 photograph went to a 3B model untouched (minutes of
 * prefill for detail the model cannot use), and the fixtures used for testing
 * were 200×113 thumbnails — so "the model cannot see people" was really "there
 * were 113 pixels of street to look at".
 *
 * So this module does the boring, necessary work:
 *
 *   - cap the long edge (default 1024 px) so latency is bounded and predictable;
 *   - never enlarge, because interpolation invents no detail;
 *   - re-encode as JPEG only when it actually resized;
 *   - report the original size, and say out loud when the input was too small
 *     to resolve a person.
 *
 * The cap is a *latency* budget, not a quality one: a 3B model on CPU spends
 * minutes on anything bigger, and a larger model has its own limits.
 */

import sharp from 'sharp';

/** Long edge sent to the model, in pixels. */
export const VISION_MAX_EDGE_DEFAULT = 1024;

/**
 * Below this, a person is a handful of pixels and no model will find them.
 * 320 is the point where a 1.7 m person standing 10 m away is still ~30 px tall.
 */
export const VISION_MIN_USEFUL_EDGE = 320;

/** The configured long edge, resolved per call so tests can override it. */
export function visionMaxEdge(environment = process.env) {
  const configured = Number(environment?.GEV_VISION_MAX_EDGE);
  return Number.isFinite(configured) && configured >= 256
    ? Math.round(configured)
    : VISION_MAX_EDGE_DEFAULT;
}

/**
 * Scale an image down to the vision budget and describe what happened.
 *
 * @param {Buffer} buffer raw image bytes
 * @param {{maxEdge?: number, minUsefulEdge?: number}} [options]
 * @returns {Promise<{buffer: Buffer, mime: string, width: number, height: number,
 *   originalWidth: number, originalHeight: number, scaled: boolean,
 *   warning: string|null}>}
 */
export async function normaliseImage(buffer, options = {}) {
  const maxEdge = options.maxEdge || visionMaxEdge();
  const minUseful = options.minUsefulEdge || VISION_MIN_USEFUL_EDGE;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('image: empty buffer');
  }

  // `rotate()` with no argument applies the EXIF orientation, so a phone photo
  // is not sent sideways.
  const meta = await sharp(buffer, { failOn: 'none' }).rotate().metadata();
  const originalWidth = Number(meta.width) || 0;
  const originalHeight = Number(meta.height) || 0;
  if (!originalWidth || !originalHeight) {
    throw new Error('image: no dimensions');
  }

  const longEdge = Math.max(originalWidth, originalHeight);
  const scaled = longEdge > maxEdge;
  let out = buffer;
  let mime = meta.format ? `image/${meta.format}` : 'image/jpeg';
  let width = originalWidth;
  let height = originalHeight;

  if (scaled) {
    const ratio = maxEdge / longEdge;
    width = Math.max(1, Math.round(originalWidth * ratio));
    height = Math.max(1, Math.round(originalHeight * ratio));
    out = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize({ width, height, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    mime = 'image/jpeg';
  }

  const warning =
    longEdge < minUseful
      ? `image is ${originalWidth}×${originalHeight}; below ${minUseful} px on the long edge a person is a few pixels and no model can resolve them — send a larger frame`
      : null;

  return {
    buffer: out,
    mime,
    width,
    height,
    originalWidth,
    originalHeight,
    scaled,
    warning,
  };
}
