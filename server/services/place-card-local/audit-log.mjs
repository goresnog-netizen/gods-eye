/**
 * An append-only record of every question this console answered.
 *
 * The point is not logging — it is being able to prove, later, that the log was
 * not edited. Each entry carries the hash of the one before it, so removing or
 * changing a line breaks every line after it:
 *
 *   entry.hash = sha256(seq, at, actor, action, queryHash, …, prevHash)
 *
 * Two decisions worth stating:
 *
 *   - **Queries are hashed, not stored.** A phone number is personal data; the
 *     audit needs to prove *which* query was run, not to keep the number. The
 *     hash is an HMAC with a local salt, because a plain SHA-256 of a phone
 *     number is brute-forceable in minutes (the space is only ~10¹⁰).
 *   - **The file is only ever appended to.** No update, no delete, no rewrite —
 *     verification is what detects tampering, and a system that can rewrite its
 *     own history cannot detect anything.
 */

import { createHash, createHmac, randomBytes } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

/** Resolved per call, so a test can point the log at a temporary directory. */
export function auditDir() {
  return process.env.GEV_AUDIT_DIR || path.join(ROOT, '.gev-cache/audit');
}

export function auditFile() {
  return path.join(auditDir(), 'audit.jsonl');
}

function saltFile() {
  return path.join(auditDir(), 'salt');
}

/** The bases a query can stand on. Free text would make the field decorative. */
export const LEGAL_BASES = Object.freeze([
  'consent',
  'contract',
  'legal-obligation',
  'vital-interest',
  'public-task',
  'legitimate-interest',
  'court-order',
]);

/** Bases that only make sense for a person-directed query. */
export const PERSON_BASES = Object.freeze([
  'consent',
  'court-order',
  'public-task',
  'vital-interest',
  'legal-obligation',
  'legitimate-interest',
  'contract',
]);

let cachedSalt = null;

/** The local HMAC salt: generated once, never leaves the machine. */
export function auditSalt() {
  if (cachedSalt) return cachedSalt;
  if (process.env.GEV_AUDIT_SALT) {
    cachedSalt = String(process.env.GEV_AUDIT_SALT);
    return cachedSalt;
  }
  try {
    if (existsSync(saltFile())) {
      cachedSalt = readFileSync(saltFile(), 'utf8').trim();
      if (cachedSalt) return cachedSalt;
    }
  } catch {
    /* fall through and create one */
  }
  cachedSalt = randomBytes(32).toString('hex');
  mkdirSync(auditDir(), { recursive: true });
  writeFileSync(saltFile(), `${cachedSalt}\n`, { mode: 0o600 });
  return cachedSalt;
}

/** The kind of thing a query is, so the log is useful without the value. */
export function queryKind(query) {
  const value = String(query || '').trim();
  if (/^\d{3}\D\d{1,3}\D\d+\D\d+$/.test(value)) return 'cell';
  if (/^\+?[\d\s\-()]{7,}$/.test(value)) return 'phone';
  if (value.startsWith('@') || /^[a-z0-9._]{3,}$/i.test(value)) return 'text';
  return 'text';
}

/** A stable, non-reversible handle for a query. */
export function hashQuery(query) {
  const normalized = String(query || '')
    .trim()
    .toLowerCase();
  return `q_${createHmac('sha256', auditSalt()).update(normalized).digest('hex').slice(0, 32)}`;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** The exact bytes that get hashed for one entry. */
function canonical(entry) {
  return JSON.stringify({
    seq: entry.seq,
    at: entry.at,
    actor: entry.actor,
    action: entry.action,
    queryHash: entry.queryHash,
    queryKind: entry.queryKind,
    mode: entry.mode,
    source: entry.source,
    legalBasis: entry.legalBasis,
    lat: entry.lat,
    lon: entry.lon,
    result: entry.result,
    prevHash: entry.prevHash,
  });
}

/** Every entry, in order. A missing file is an empty history, not an error. */
export function readEntries() {
  try {
    const text = readFileSync(auditFile(), 'utf8');
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { corrupt: true, raw: line.slice(0, 120) };
        }
      });
  } catch {
    return [];
  }
}

// Appends are serialised in-process: two writes racing would both read the same
// prevHash and produce two "next" entries.
let queue = Promise.resolve();

/**
 * Record one answered question.
 *
 * Returns the entry as written, so a caller can echo its hash back to the user.
 */
export function record(entry = {}) {
  queue = queue.then(() => {
    const entries = readEntries().filter((item) => !item.corrupt);
    const previous = entries[entries.length - 1] || null;
    const body = {
      seq: (previous?.seq || 0) + 1,
      at: new Date().toISOString(),
      actor: String(entry.actor || 'local').slice(0, 64),
      action: String(entry.action || 'query').slice(0, 32),
      queryHash:
        entry.queryHash || (entry.query ? hashQuery(entry.query) : null),
      queryKind:
        entry.queryKind || (entry.query ? queryKind(entry.query) : null),
      mode: entry.mode || null,
      source: entry.source || null,
      legalBasis: entry.legalBasis || null,
      lat: Number.isFinite(entry.lat)
        ? Math.round(entry.lat * 1e5) / 1e5
        : null,
      lon: Number.isFinite(entry.lon)
        ? Math.round(entry.lon * 1e5) / 1e5
        : null,
      result: entry.result || null,
      prevHash: previous?.hash || 'genesis',
    };
    const record = { ...body, hash: sha256(canonical(body)) };
    mkdirSync(auditDir(), { recursive: true });
    appendFileSync(auditFile(), `${JSON.stringify(record)}\n`);
    return record;
  });
  return queue;
}

/**
 * Recompute the chain.
 *
 * A single edited field, a deleted line or a reordered pair all show up here —
 * which is the whole reason the log exists.
 */
export function verifyChain(entries = readEntries()) {
  let previousHash = 'genesis';
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.corrupt) {
      return {
        ok: false,
        entries: entries.length,
        brokenAt: index + 1,
        reason: 'unparseable_line',
      };
    }
    if (entry.seq !== index + 1) {
      return {
        ok: false,
        entries: entries.length,
        brokenAt: index + 1,
        reason: 'sequence_gap',
      };
    }
    if (entry.prevHash !== previousHash) {
      return {
        ok: false,
        entries: entries.length,
        brokenAt: index + 1,
        reason: 'prev_hash_mismatch',
      };
    }
    const { hash, ...body } = entry;
    if (sha256(canonical(body)) !== hash) {
      return {
        ok: false,
        entries: entries.length,
        brokenAt: index + 1,
        reason: 'hash_mismatch',
      };
    }
    previousHash = hash;
  }
  return {
    ok: true,
    entries: entries.length,
    brokenAt: null,
    reason: null,
    head: previousHash,
  };
}

/** The last N entries, newest first — what the UI or an auditor asks for. */
export function tail(limit = 50) {
  const entries = readEntries();
  const size = Math.max(1, Math.min(500, Number(limit) || 50));
  return entries.slice(-size).reverse();
}
