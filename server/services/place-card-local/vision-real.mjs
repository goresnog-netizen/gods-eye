#!/usr/bin/env node
/**
 * Vision Real — analisis foto nyata via Ollama lokal (qwen2.5vl:3b / moondream).
 *
 * Kontrak output: sesuai VISION-PLAN.md + vision-contract.js:
 *   { image_size: [w,h], scene, people: [{bbox:[x0,y0,x1,y1], holding, activity, confidence}],
 *     vehicles: [...], notes }
 *
 * Tanpa external provider calls — Ollama jalan lokal di 127.0.0.1:11434.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname, extname } from 'path';

const OLLAMA_BASE = process.env.OLLAMA_BASE || 'http://127.0.0.1:11434';
const DEFAULT_MODEL = process.env.VISION_MODEL || 'qwen2.5vl:3b';
const FALLBACK_MODEL = process.env.VISION_FALLBACK || 'moondream:latest';

const SCENE_PROMPT = `You are a careful scene analyst. Look for people in this image. Report the image pixel size and, for each person, a bounding box as pixel corners [x0, y0, x1, y1] measured from the top-left, the things they visibly hold (empty list if nothing), their visible activity, and your confidence between 0 and 1. If nothing is legible, say so instead of guessing. Answer with JSON only.`;

const SCENE_SHAPE =
  '{"image_size": [width, height], "scene": "string", "people": [{"bbox": [x0, y0, x1, y1], "holding": ["item"], "activity": "string", "confidence": 0.0}], "vehicles": [{"bbox": [x0, y0, x1, y1], "type": "string", "confidence": 0.0}], "notes": "string"}';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith('--') ? true : value;
}

function toBase64(filePath) {
  return readFileSync(resolve(filePath)).toString('base64');
}

async function callOllama(imagePath, model, prompt) {
  const imageBase64 = toBase64(imagePath);
  const payload = {
    model,
    prompt: `${prompt}\n\nAnswer with JSON only, using this shape: ${SCENE_SHAPE}. Bounding boxes are pixel corners [x0, y0, x1, y1] measured from the top-left.`,
    images: [imageBase64],
    stream: false,
    options: { temperature: 0.1 },
  };
  const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = await res.json();
  return data.response || '';
}

function parseJson(raw) {
  // Try direct parse, then extract fenced block, then find first { ... }
  try {
    return JSON.parse(raw);
  } catch {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {}
  }
  return null;
}

function normalizeResult(parsed, imagePath) {
  if (!parsed) return null;
  const imageSize = Array.isArray(parsed.image_size)
    ? parsed.image_size
    : [0, 0];
  const people = (parsed.people || []).map((p, i) => ({
    id: `person-${i + 1}`,
    bbox: Array.isArray(p.bbox) ? p.bbox : [0, 0, 0, 0],
    image_size: imageSize,
    bboxSpace: 'pixels',
    holding: Array.isArray(p.holding)
      ? p.holding
      : p.holding
        ? [p.holding]
        : [],
    activity: p.activity || 'unknown',
    confidence: Number(p.confidence) || 0.5,
  }));
  const vehicles = (parsed.vehicles || []).map((v, i) => ({
    id: `vehicle-${i + 1}`,
    type: v.type || 'unknown',
    bbox: Array.isArray(v.bbox) ? v.bbox : [0, 0, 0, 0],
    confidence: Number(v.confidence) || 0.5,
  }));
  return {
    image: imagePath,
    model: DEFAULT_MODEL,
    scene: {
      description: parsed.scene || 'No scene description',
      notes: parsed.notes || '',
    },
    people,
    vehicles,
    summary: {
      people_count: people.length,
      vehicle_count: vehicles.length,
      dominant_activity: people.length > 0 ? people[0].activity : 'none',
    },
    generatedAt: Date.now(),
    source: 'ollama-vision-real',
  };
}

export async function analyzeImage(imagePath, model = DEFAULT_MODEL) {
  let raw;
  try {
    raw = await callOllama(imagePath, model, SCENE_PROMPT);
  } catch (e) {
    if (model !== FALLBACK_MODEL) {
      console.warn(
        `Model ${model} gagal: ${e.message}, coba ${FALLBACK_MODEL}...`,
      );
      raw = await callOllama(imagePath, FALLBACK_MODEL, SCENE_PROMPT);
      model = FALLBACK_MODEL;
    } else throw e;
  }
  const parsed = parseJson(raw);
  const result = normalizeResult(parsed, imagePath);
  if (!result) {
    return {
      image: imagePath,
      model,
      scene: { description: raw.slice(0, 500), notes: 'JSON parse failed' },
      people: [],
      vehicles: [],
      summary: { people_count: 0, vehicle_count: 0, dominant_activity: 'none' },
      generatedAt: Date.now(),
      source: 'ollama-vision-real-fallback',
      rawOutput: raw,
    };
  }
  result.model = model;
  return result;
}

async function main() {
  const imagePath = arg('image', null);
  const model = arg('model', DEFAULT_MODEL);
  const json = Boolean(arg('json', false));
  const output = arg('output', null);

  if (!imagePath) {
    console.log(
      'Usage: node vision-real.mjs --image <path> [--model qwen2.5vl:3b] [--json] [--output file.json]',
    );
    console.log(`Default model: ${DEFAULT_MODEL}`);
    console.log(`Fallback: ${FALLBACK_MODEL}`);
    console.log(`Ollama: ${OLLAMA_BASE}`);
    process.exit(0);
  }

  console.log(`Analyzing ${imagePath} with ${model}...`);
  const t0 = Date.now();
  const result = await analyzeImage(imagePath, model);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `Done in ${elapsed}s — ${result.summary.people_count} orang, ${result.summary.vehicle_count} kendaraan`,
  );

  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Scene: ${result.scene.description}`);
    for (const p of result.people) {
      console.log(
        `  Person ${p.id}: bbox=${p.bbox}, holding=${p.holding.join(',') || 'none'}, activity=${p.activity}, conf=${p.confidence}`,
      );
    }
    for (const v of result.vehicles) {
      console.log(`  Vehicle ${v.id}: type=${v.type}, conf=${v.confidence}`);
    }
  }

  if (output) {
    mkdirSync(dirname(resolve(output)), { recursive: true });
    writeFileSync(resolve(output), JSON.stringify(result, null, 2));
    console.log(`Saved to: ${resolve(output)}`);
  }
}

// Only run main() when executed directly, not when imported
if (process.argv[1] && process.argv[1].endsWith('vision-real.mjs')) {
  main().catch((e) => {
    console.error(`GAGAL: ${e?.message || e}`);
    process.exit(1);
  });
}
