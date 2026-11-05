/**
 * API: /api/bts — the tower registry.
 *
 * Reads the bundled registry artifact (a sweep writes it) so the globe layer
 * and the panel answer from one payload with no provider key and no credits.
 *
 *   ?catalog=1&sites=1   → the registry itself, for the globe layer
 *   ?catalog=1           → what the registry holds, by radio generation
 *   ?lat=&lon=&limit=    → the nearest sites to a point
 *   ?cells=a-b-c-d,...   → which sites carry those cells
 *
 * The registry is read once per cold start; a warm function reuses it.
 */

import { readFileSync } from 'node:fs';

const REGISTRY_URL = new URL('./bts-registry.json', import.meta.url);

let registry = null;

function loadRegistry() {
  if (registry) return registry;
  const raw = JSON.parse(readFileSync(REGISTRY_URL, 'utf8'));
  registry = {
    source: raw.source || 'local',
    // The top-level artifact has no `synthetic` key — only a response computes
    // it. Absent means a real sweep wrote this file.
    synthetic: Boolean(raw.synthetic),
    generatedAt: raw.generatedAt || null,
    attribution: raw.attribution || null,
    credits: raw.credits || null,
    cells: Array.isArray(raw.cells) ? raw.cells : [],
    sites: Array.isArray(raw.sites) ? raw.sites : [],
  };
  return registry;
}

/** Great-circle distance in kilometres. */
function distanceKm(aLat, aLon, bLat, bLon) {
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLon = (bLon - aLon) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function siteSummary(site) {
  return {
    id: site.id,
    name: site.name,
    lat: site.lat,
    lon: site.lon,
    tech: site.tech,
    rangeKm: site.rangeKm,
    cells: Array.isArray(site.cells) ? site.cells : [],
    samples: site.samples,
  };
}

function meta(reg) {
  return {
    source: reg.source,
    synthetic: reg.synthetic,
    generatedAt: reg.generatedAt,
    attribution: reg.attribution,
    credits: reg.credits,
  };
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).send('');
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  let reg;
  try {
    reg = loadRegistry();
  } catch (error) {
    return res
      .status(500)
      .json({ ok: false, error: 'registry_unreadable', detail: error?.message });
  }

  const q = req.query || {};
  const metaPayload = meta(reg);

  // ── The registry itself, for the globe layer ──────────────────────────────
  if (q.catalog === '1') {
    res.setHeader('Cache-Control', 'public, max-age=600, stale-while-revalidate=3600');

    if (q.sites === '1') {
      return res.status(200).json({
        ok: true,
        ...metaPayload,
        sites: reg.sites.map(siteSummary),
      });
    }

    const byTech = {};
    const byRadio = {};
    for (const site of reg.sites) {
      const techKey = site.tech || 'unknown';
      byTech[techKey] = (byTech[techKey] || 0) + 1;
      // `tech` is written as "4G" / "3G" / "2G" (and sometimes a radio name);
      // normalise both spellings onto one generation bucket.
      const tech = String(site.tech || '').toUpperCase();
      const generation = tech.includes('5G')
        ? '5G'
        : tech.includes('4G') || tech.includes('LTE')
          ? 'LTE'
          : tech.includes('3G') || tech.includes('UMTS') || tech.includes('WCDMA') || tech.includes('HSDPA')
            ? 'UMTS'
            : tech.includes('2G') || tech.includes('GSM')
              ? 'GSM'
              : 'unknown';
      byRadio[generation] = (byRadio[generation] || 0) + 1;
    }

    return res.status(200).json({
      ok: true,
      ...metaPayload,
      sites: reg.sites.length,
      // Cells live per site; the top-level array is only a cache and is often
      // empty, so count what the sites actually carry.
      cells:
        reg.cells.length ||
        reg.sites.reduce(
          (sum, site) => sum + (Array.isArray(site.cells) ? site.cells.length : 0),
          0,
        ),
      byTech,
      byRadio,
    });
  }

  // ── Nearest sites to a point ──────────────────────────────────────────────
  if (q.lat !== undefined && q.lon !== undefined) {
    const lat = Number(q.lat);
    const lon = Number(q.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({ ok: false, error: 'bad_coordinates' });
    }
    const limit = Math.min(Math.max(parseInt(q.limit, 10) || 5, 1), 50);
    const nearest = reg.sites
      .map((site) => ({
        ...siteSummary(site),
        distanceKm: Number(distanceKm(lat, lon, site.lat, site.lon).toFixed(3)),
      }))
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, limit);

    res.setHeader('Cache-Control', 'public, max-age=600');
    return res.status(200).json({
      ok: true,
      ...metaPayload,
      query: { lat, lon },
      nearest,
      sites: nearest.length,
    });
  }

  // ── Which sites carry these cells ─────────────────────────────────────────
  if (q.cells) {
    const wanted = String(q.cells)
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    const hits = [];
    for (const site of reg.sites) {
      const carried = (Array.isArray(site.cells) ? site.cells : []).filter((cell) => {
        const key = [cell.mcc, cell.mnc, cell.lac, cell.cellId]
          .filter((part) => part !== undefined && part !== null)
          .join('-');
        return wanted.some((w) => key === w || key.endsWith(w) || w.endsWith(key));
      });
      if (carried.length) hits.push({ ...siteSummary(site), matched: carried });
    }

    res.setHeader('Cache-Control', 'public, max-age=600');
    return res.status(200).json({
      ok: true,
      ...metaPayload,
      query: { cells: wanted },
      sites: hits,
      count: hits.length,
    });
  }

  // ── Default: what the registry holds ──────────────────────────────────────
  res.setHeader('Cache-Control', 'public, max-age=600');
  return res.status(200).json({
    ok: true,
    ...metaPayload,
    sites: reg.sites.length,
    cells:
      reg.cells.length ||
      reg.sites.reduce(
        (sum, site) => sum + (Array.isArray(site.cells) ? site.cells.length : 0),
        0,
      ),
  });
}
