/**
 * Scene-analysis contract for vision models.
 *
 * A model may answer with prose, with a fenced block, or with the JSON this
 * module defines. The reply is parsed into a fixed shape so every caller
 * (the app route, the CLI pipeline) reads the same fields.
 *
 * The model is asked for PIXEL CORNERS [x0, y0, x1, y1] from the top-left,
 * together with the image size. The normalised box is [x, y, width, height]
 * in 0..1, and the space it came from is reported: a model that forgets the
 * image size gets `unverified` instead of a silent clamp.
 */

/** The prompt that asks for the contract below. */
export const SCENE_PROMPT =
  'You are a careful scene analyst. Look for people in this image. Report the image pixel size and, for each person, a bounding box as pixel corners [x0, y0, x1, y1] measured from the top-left, the things they visibly hold (empty list if nothing), their visible activity, and your confidence between 0 and 1. If nothing is legible, say so instead of guessing.';

/** The shape the model is asked to answer with. */
export const SCENE_SHAPE =
  '{"image_size": [width, height], "scene": string, "people": [{"bbox": [x0, y0, x1, y1], "holding": string[], "activity": string, "confidence": number}], "vehicles": [{"bbox": [x0, y0, x1, y1], "type": string, "confidence": number}], "notes": string}';

/** The instruction that turns a scene prompt into a JSON request. */
export const JSON_INSTRUCTION = `Answer with JSON only, using this shape: ${SCENE_SHAPE}. Bounding boxes are pixel corners [x0, y0, x1, y1] measured from the top-left of the image; also report image_size as [width, height] in pixels.`;

/** Clamp a number into 0..1. */
export function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, number));
}

/**
 * Pull the first JSON object out of a model reply.
 *
 * Models wrap the object in prose or in a code fence, and a few add a
 * trailing sentence, so the object is located by its braces.
 *
 * @param {string} text
 * @returns {object|null}
 */
export function extractJson(text) {
  const source = String(text || '');
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : source;
  const start = candidate.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let index = start; index < candidate.length; index += 1) {
    const character = candidate[index];
    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Normalise a bounding box to [x, y, width, height] in 0..1.
 *
 * @param {unknown} box pixel corners or a normalised box
 * @param {[number, number]|null} imageSize
 * @returns {{box: number[], space: 'pixels'|'normalized'|'unverified'}|null}
 */
export function normalizeBox(box, imageSize) {
  if (!Array.isArray(box) || box.length !== 4) return null;
  const values = box.map((value) => Number(value));
  if (values.some((value) => !Number.isFinite(value))) return null;

  const looksNormalized = values.every(
    (value) => value >= 0 && value <= 1.0001,
  );
  if (looksNormalized) {
    return {
      box: [values[0], values[1], values[2], values[3]],
      space: 'normalized',
    };
  }
  if (Array.isArray(imageSize) && imageSize.length === 2) {
    const width = Number(imageSize[0]);
    const height = Number(imageSize[1]);
    if (
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
    ) {
      const [x0, y0, x1, y1] = values;
      const left = Math.min(x0, x1);
      const top = Math.min(y0, y1);
      const right = Math.max(x0, x1);
      const bottom = Math.max(y0, y1);
      return {
        box: [
          clamp01(left / width),
          clamp01(top / height),
          clamp01((right - left) / width),
          clamp01((bottom - top) / height),
        ],
        space: 'pixels',
      };
    }
  }
  // Out of range and no image size: keep the numbers but flag them instead of
  // silently clamping them into a wrong box.
  return { box: values.map((value) => clamp01(value)), space: 'unverified' };
}

/**
 * Normalise a parsed model answer into the scene contract.
 *
 * @param {object} parsed
 * @returns {{scene:string, imageSize:number[]|null, people:Array<object>, vehicles:Array<object>, notes:string}}
 */
export function normalizeResult(parsed) {
  const imageSize = Array.isArray(parsed?.image_size)
    ? parsed.image_size.map((value) => Number(value))
    : null;
  const result = {
    scene: String(parsed?.scene || '').trim(),
    imageSize:
      imageSize && imageSize.every((value) => Number.isFinite(value))
        ? imageSize
        : null,
    people: [],
    vehicles: [],
    notes: String(parsed?.notes || '').trim(),
  };
  for (const person of Array.isArray(parsed?.people) ? parsed.people : []) {
    const normalized = normalizeBox(person?.bbox, result.imageSize);
    if (!normalized) continue;
    result.people.push({
      bbox: normalized.box,
      bboxSpace: normalized.space,
      holding: Array.isArray(person?.holding)
        ? person.holding.map((item) => String(item).trim()).filter(Boolean)
        : [],
      activity: String(person?.activity || 'unclear').trim() || 'unclear',
      confidence: clamp01(person?.confidence ?? 0.5),
    });
  }
  for (const vehicle of Array.isArray(parsed?.vehicles)
    ? parsed.vehicles
    : []) {
    const normalized = normalizeBox(vehicle?.bbox, result.imageSize);
    if (!normalized) continue;
    result.vehicles.push({
      bbox: normalized.box,
      bboxSpace: normalized.space,
      type: String(vehicle?.type || 'object').trim() || 'object',
      confidence: clamp01(vehicle?.confidence ?? 0.5),
    });
  }
  return result;
}

/**
 * Parse a model reply into the scene contract.
 *
 * A reply that is not JSON is kept as the note, so the caller can show what
 * the model said instead of an empty result.
 *
 * @param {string} text
 * @returns {ReturnType<typeof normalizeResult> & {parsed: boolean}}
 */
export function parseSceneReply(text) {
  const parsed = extractJson(text);
  if (!parsed) {
    return {
      scene: '',
      imageSize: null,
      people: [],
      vehicles: [],
      notes: String(text || '').trim(),
      parsed: false,
    };
  }
  return { ...normalizeResult(parsed), parsed: true };
}
