/**
 * Skill library yang ditanam sebagai konteks sistem tiap chat.
 *
 * Isinya modul NYATA project ini: setiap entri menunjuk ke berkas yang
 * benar-benar ada di repo, supaya "skill" yang Offer ke model bukan daftar
 * hayalan. Pustaka ini juga menjadi memori yang persist: salinan JSON ditulis
 * sekali ke <Gods Eye>/data/skill-library.json dan dibaca dari sana.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './privacy.js';

/** Berkas salinan pustaka skill (JSON). */
export const SKILL_LIBRARY_PATH = path.join(DATA_DIR, 'skill-library.json');

/** Versi pustaka; naik kalau modul atau judulnya berubah. */
export const SKILL_LIBRARY_VERSION = 1;

/**
 * @typedef {object} SkillModule
 * @property {string} id pengenal stabil modul
 * @property {string} title judul satu baris (kunci i18n di sisi klien)
 * @property {string} capabilityapa yang dikerjakan modul, satu baris
 * @property {boolean} localOnly true = modul tidak boleh berjalan di lane remote
 * @property {boolean} remoteSafe true = konteks modul aman dikirim ke lane remote
 * @property {string[]} modules berkas nyata di project ini
 * @property {string[]} keywords kata kunci untuk mengenali task yang butuh modul
 */

/**
 * @type {ReadonlyArray<SkillModule>}
 */
export const SKILL_MODULES = Object.freeze([
  Object.freeze({
    id: 'vision-scene',
    title: 'Vision scene detection',
    capability:
      'Detect people, held objects and activity in a camera scene and draw the boxes.',
    localOnly: true,
    remoteSafe: false,
    modules: [
      'server/providers/openai/vision.js',
      'server/providers/openai/vision-contract.js',
      'src/ui/godseyePanel.js',
    ],
    keywords: [
      'vision',
      'scene',
      'camera',
      'image',
      'gambar',
      'orang',
      'person',
      'people',
      'activity',
      'aktivitas',
      'holding',
      'pegang',
      'deteksi',
      'detect',
    ],
  }),
  Object.freeze({
    id: 'gold-impact',
    title: 'Gold impact on XAUUSD',
    capability:
      'Score what moves XAUUSD right now: market series, headlines and world events.',
    localOnly: false,
    remoteSafe: true,
    modules: [
      'server/providers/godseye/gold-impact.js',
      'server/providers/godseye/market.js',
      'server/providers/godseye/drivers.js',
      'server/providers/godseye/news.js',
    ],
    keywords: [
      'gold',
      'xauusd',
      'emas',
      'price',
      'harga',
      'driver',
      'news',
      'berita',
      'market',
      'pasar',
      'impact',
      'dampak',
      'macro',
      'makro',
      'inflation',
      'inflasi',
      'dxy',
    ],
  }),
  Object.freeze({
    id: 'place-card',
    title: 'Place card and street photo',
    capability:
      'Build a place card for a place name: location, providers and a street-level photo.',
    localOnly: false,
    remoteSafe: true,
    modules: ['server/providers/godseye/place-card.js'],
    keywords: [
      'place card',
      'place-card',
      'alamat',
      'address',
      'lokasi',
      'location',
      'kota',
      'city',
      'street',
      'jalan',
      'koordinat',
      'coordinate',
      'photo',
      'foto',
    ],
  }),
  Object.freeze({
    id: 'osint-target',
    title: 'OSINT and target research',
    capability:
      'Collect open-source events and research a target from local feeds only.',
    localOnly: true,
    remoteSafe: false,
    modules: ['server/providers/godseye/osint.js'],
    keywords: [
      'osint',
      'target',
      'sasaran',
      'riset',
      'research',
      'sosmed',
      'social media',
      'profil',
      'profile',
      'investigasi',
      'investigate',
      'gempa',
      'earthquake',
    ],
  }),
  Object.freeze({
    id: 'web-search',
    title: 'Web search through local SearXNG',
    capability:
      'Search the web through the local SearXNG instance and read the results.',
    localOnly: true,
    remoteSafe: false,
    modules: ['plugins/dsh-searxng/src/searxng-client.ts'],
    keywords: [
      'search',
      'cari',
      'web',
      'internet',
      'searxng',
      'lookup',
      'google',
      'find',
      'sumber',
    ],
  }),
  Object.freeze({
    id: 'frontend-ui',
    title: 'Frontend and UI build',
    capability:
      'Build and wire the panels, templates and styles of the God Eye console.',
    localOnly: false,
    remoteSafe: true,
    modules: [
      'src/ui/godseyePanel.js',
      'src/ui/templates/context.html',
      'src/ui/styles/godseye.css',
    ],
    keywords: [
      'ui',
      'frontend',
      'panel',
      'css',
      'html',
      'component',
      'komponen',
      'layout',
      'tampilan',
      'design',
      'tombol',
      'button',
      'halaman',
      'page',
      'style',
    ],
  }),
  Object.freeze({
    id: 'local-memory',
    title: 'Local memory and audit',
    capability:
      'Keep the local memory, the privacy audit trail and the chat history on disk.',
    localOnly: true,
    remoteSafe: false,
    modules: [
      'server/providers/godseye/skill-library.js',
      'server/providers/godseye/privacy.js',
      'data/skill-library.json',
      'data/privacy-audit.jsonl',
    ],
    keywords: [
      'audit',
      'memori',
      'memory',
      'riwayat',
      'history',
      'redaction',
      'privasi',
      'privacy',
      'data lokal',
      'local data',
      'skill library',
      'chat history',
    ],
  }),
]);

/**
 * @typedef {object} SkillLibrary
 * @property {number} version versi pustaka
 * @property {SkillModule[]} modules modul yang ditanam
 */

/** Pustaka bawaan, tanpa efek samping disk. */
export function buildLibrary() {
  return {
    version: SKILL_LIBRARY_VERSION,
    modules: SKILL_MODULES.map((module) => ({
      id: module.id,
      title: module.title,
      capability: module.capability,
      localOnly: module.localOnly,
      remoteSafe: module.remoteSafe,
      modules: [...module.modules],
      keywords: [...module.keywords],
    })),
  };
}

/** Escape regex untuk kata kunci. */
function escapeKeyword(keyword) {
  return String(keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Cocokkan kata kunci di dalam teks task.
 *
 * Kata kunci dicocokkan dengan batas kata supaya "ui" tidak ikut cocok
 * dengan kata lain, dan teks dicari tanpainals.
 */
function keywordMatcher(keywords) {
  const patterns = keywords.map((keyword) => {
    const escaped = escapeKeyword(keyword);
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu');
  });
  return (text) => patterns.some((pattern) => pattern.test(text));
}

/** Matcher yang sudah dikompilasi per modul, dipakai ulang antar permintaan. */
const matcherCache = new Map();

/**
 * Matcher satu modul.
 *
 * @param {SkillModule} module
 * @returns {(text: string) => boolean}
 */
function matcherFor(module) {
  const cached = matcherCache.get(module.id);
  if (cached) return cached;
  const matcher = keywordMatcher(module.keywords);
  matcherCache.set(module.id, matcher);
  return matcher;
}

/**
 * Modul-modul yang butuh task ini.
 *
 * @param {string} text pesan user
 * @param {SkillLibrary} [library]
 * @returns {SkillModule[]}
 */
export function matchSkills(text, library = buildLibrary()) {
  const haystack = String(text || '');
  if (!haystack.trim()) return [];
  return library.modules.filter((module) => matcherFor(module)(haystack));
}

/**
 * Modul yang tidak boleh dijalankan di lane remote.
 *
 * @param {SkillLibrary} [library]
 * @returns {SkillModule[]}
 */
export function localOnlySkills(library = buildLibrary()) {
  return library.modules.filter((module) => module.localOnly);
}

/**
 * Blok konteks skill untuk system prompt.
 *
 * Ringkas: satu baris per modul, supaya prompt tidak meledak.
 *
 * @param {SkillLibrary} [library]
 * @returns {string}
 */
export function renderSkillContext(library = buildLibrary()) {
  const lines = library.modules.map((module) => {
    const flags = [
      module.localOnly ? 'localOnly' : 'remote-ok',
      module.remoteSafe ? 'remote-safe' : 'not-remote-safe',
    ].join(',');
    return `- ${module.id} | ${module.title} | ${flags} | ${module.capability}`;
  });
  return ['PLANTED SKILL MODULES:', ...lines].join('\n');
}

/**
 * Baca pustaka dari berkas; null kalau belum ada atau rusak.
 *
 * @param {string} filePath
 * @returns {SkillLibrary|null}
 */
function parseLibrary(text) {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.modules)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Muat pustaka skill dan pastikan salinan JSON ada di disk.
 *
 * Berkas ditulis sekali: kalau sudah ada dengan versi yang sama, isinya
 * dipakai apa adanya. Versi yang lebih lama ditulis ulang supaya pustaka
 * yang dibaca selalu sama dengan yang diTanam.
 *
 * @param {object} [options]
 * @param {string} [options.filePath]
 * @param {boolean} [options.write] false = jangan sentuh disk
 * @returns {Promise<SkillLibrary>}
 */
export async function loadSkillLibrary(options = {}) {
  const { filePath = SKILL_LIBRARY_PATH, write = true } = options;
  let existing = null;
  try {
    existing = parseLibrary(await readFile(filePath, 'utf8'));
  } catch {
    existing = null;
  }
  if (existing && existing.version === SKILL_LIBRARY_VERSION) return existing;
  const library = buildLibrary();
  if (write) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(library, null, 2)}\n`, 'utf8');
  }
  return library;
}

/**
 * Versi sinkron dari {@link loadSkillLibrary}, untuk jalur yang tidak async.
 *
 * @param {object} [options]
 * @param {string} [options.filePath]
 * @param {boolean} [options.write]
 * @returns {SkillLibrary}
 */
export function getSkillLibrarySync(options = {}) {
  const { filePath = SKILL_LIBRARY_PATH, write = true } = options;
  let existing = null;
  try {
    existing = parseLibrary(readFileSync(filePath, 'utf8'));
  } catch {
    existing = null;
  }
  if (existing && existing.version === SKILL_LIBRARY_VERSION) return existing;
  const library = buildLibrary();
  if (write) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(library, null, 2)}\n`, 'utf8');
  }
  return library;
}
