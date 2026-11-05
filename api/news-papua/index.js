/**
 * API: /api/news-papua
 *
 * Papua headlines from Google News RSS — no key, no account.
 * Two feeds run in parallel: Indonesian domestic outlets (`hl=id&gl=ID`) and
 * world outlets (`hl=en-US&gl=US`), then merge, dedupe and sort newest-first.
 *
 * Query params
 *   scope=all|international|domestic   (default all)
 *   limit=<1..200>                     (default 60)
 *   topics=1                           → only the query list, no fetch
 *   q=<free text>                      → one ad-hoc query instead of the list
 *
 * Publisher classification reads `<source url="…">` in each RSS item. Google
 * News links always point at news.google.com, so the link host says nothing
 * about who published the story.
 */

// ─── Topics ──────────────────────────────────────────────────────────────────

const DOMESTIC_TOPICS = [
  'konflik papua',
  'kemerdekaan papua',
  'opm papua',
  'benny wenda',
  'bendera bintang kejora',
  'papua barat',
  'papua indonesia',
  'referendum papua',
  'ulpwp',
  'knpb',
  'separatisme papua',
  'pemberontakan papua',
];

const WORLD_TOPICS = [
  'west papua conflict',
  'papua independence movement',
  'opm papua',
  'free west papua',
  'indonesia papua human rights',
  'papua self-determination',
  'west papua separatist',
  'papua political prisoners',
  'papua autonomy',
  'west papua refugees',
];

// ─── Publisher classification ────────────────────────────────────────────────

/** Indonesian outlets. A host here is domestic; nothing else is. */
const DOMESTIC_HOSTS = [
  'antaranews.com',
  'kompas.com',
  'kompas.id',
  'detik.com',
  'cnnindonesia.com',
  'tribunnews.com',
  'tempo.co',
  'liputan6.com',
  'sindonews.com',
  'mediaindonesia.com',
  'republika.co.id',
  'jawapos.com',
  'kbr.id',
  'benarnews.com',
  'thejakartapost.com',
  'jakartaglobe.id',
  'katadata.co.id',
  'kumparan.com',
  'idntimes.com',
  'merdeka.com',
  'okezone.com',
  'viva.co.id',
  'bisnis.com',
  'kontan.co.id',
  'jpnn.com',
  'rmol.id',
  'rm.id',
  'beritasatu.com',
  'suara.com',
  'elshinta.com',
  'inilah.com',
  'analisadaily.com',
  'cenderawasihpos.co.id',
  'jubi.id',
  'papuakita.com',
  'tabloidjubi.com',
  'suarapapua.com',
  'westpapua.news',
];

/** Foreign outlets. Checked first, so a shared brand resolves internationally. */
const INTERNATIONAL_HOSTS = [
  'bbc.com',
  'bbc.co.uk',
  'reuters.com',
  'apnews.com',
  'theguardian.com',
  'aljazeera.com',
  'nytimes.com',
  'washingtonpost.com',
  'latimes.com',
  'usatoday.com',
  'npr.org',
  'cbsnews.com',
  'nbcnews.com',
  'cnn.com',
  'abcnews.go.com',
  'time.com',
  'bloomberg.com',
  'ft.com',
  'economist.com',
  'foreignpolicy.com',
  'scmp.com',
  'dw.com',
  'france24.com',
  'channelnewsasia.com',
  'japantimes.co.jp',
  'thediplomat.com',
  'lowyinstitute.org',
  'aspistrategist.org.au',
  'abc.net.au',
  'smh.com.au',
  'theage.com.au',
  'news.com.au',
  'theaustralian.com.au',
  'rnz.co.nz',
  'stuff.co.nz',
  'nzherald.co.nz',
  'thetimes.co.uk',
  'telegraph.co.uk',
  'hrw.org',
  'amnesty.org',
  'un.org',
  'ohchr.org',
];

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function hostMatches(host, list) {
  return list.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

function classifyOutlet(url) {
  const host = hostOf(url);
  if (!host) return 'other';
  if (hostMatches(host, INTERNATIONAL_HOSTS)) return 'international';
  if (hostMatches(host, DOMESTIC_HOSTS)) return 'domestic';
  return 'other';
}

function outletName(url) {
  const host = hostOf(url);
  if (!host) return 'unknown';
  return host
    .split('.')
    .slice(0, -1)
    .join(' ')
    .replace(/^(the|news|m|amp)$/i, '')
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// ─── RSS parsing ─────────────────────────────────────────────────────────────

function decodeEntities(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function tagValue(block, tag) {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
  if (!match) return '';
  return decodeEntities(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
}

function parseRss(xml) {
  const blocks = String(xml || '').match(/<item[\s\S]*?<\/item>/gi) || [];
  return blocks
    .map((block) => {
      const pubDate = tagValue(block, 'pubDate').trim();
      const published = pubDate ? Date.parse(pubDate) : Number.NaN;
      const link = tagValue(block, 'link').trim();

      // <source url="https://www.antaranews.com">ANTARA</source>
      const sourceBlock = /<source\b([^>]*)>([\s\S]*?)<\/source>/i.exec(block);
      const sourceUrl = sourceBlock
        ? (/url=["']([^"']+)["']/i.exec(sourceBlock[1]) || [])[1] || ''
        : '';
      const sourceName = sourceBlock
        ? decodeEntities(
            sourceBlock[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'),
          ).trim()
        : '';

      const publisher = sourceUrl || link;
      return {
        title: tagValue(block, 'title').trim(),
        link,
        source: sourceName || outletName(publisher),
        outlet: sourceName || outletName(publisher),
        outletType: classifyOutlet(publisher),
        publishedAt: Number.isFinite(published) ? published : null,
        published: pubDate || null,
      };
    })
    .filter((item) => item.title && item.link);
}

// ─── Fetching ────────────────────────────────────────────────────────────────

const FEED_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; GodsEye/1.0; +news desk)',
  Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
};

async function fetchTopic(query, lang, gl) {
  const ceid = `${gl}:${lang.slice(0, 2)}`;
  const url =
    'https://news.google.com/rss/search' +
    `?q=${encodeURIComponent(query)}&hl=${lang}&gl=${gl}&ceid=${ceid}`;
  const scope = gl === 'ID' ? 'domestic' : 'international';
  try {
    const response = await fetch(url, { headers: FEED_HEADERS });
    if (!response.ok) return [];
    const xml = await response.text();
    return parseRss(xml).map((item) => ({
      ...item,
      scope,
      // The feed's own language is the strongest signal for the long tail of
      // regional outlets (Radar Sorong, RRI, Koreri…) that no host list holds.
      // A known host still wins; only "other" falls back to the feed.
      outletType: item.outletType === 'other' ? scope : item.outletType,
      query,
    }));
  } catch {
    return [];
  }
}

function dedupeAndSort(items) {
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const key = item.title.toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  unique.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
  return unique;
}

// ─── Cache ───────────────────────────────────────────────────────────────────

const CACHE_TTL = 15 * 60 * 1000;
let cache = { at: 0, payload: null };

// ─── Handler ─────────────────────────────────────────────────────────────────

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

  const q = req.query || {};

  if (q.topics === '1') {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).json({
      ok: true,
      topics: [
        ...DOMESTIC_TOPICS.map((id) => ({ id, scope: 'domestic', query: id })),
        ...WORLD_TOPICS.map((id) => ({ id, scope: 'international', query: id })),
      ],
      domestic: DOMESTIC_TOPICS,
      world: WORLD_TOPICS,
      total: DOMESTIC_TOPICS.length + WORLD_TOPICS.length,
    });
  }

  const scope = ['all', 'international', 'domestic'].includes(String(q.scope))
    ? String(q.scope)
    : 'all';
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 60, 1), 200);
  const freeQuery = String(q.q || '').trim();

  const now = Date.now();
  const cacheable = !freeQuery;
  if (cacheable && cache.payload && now - cache.at < CACHE_TTL) {
    return res
      .status(200)
      .json(slicePayload(cache.payload, scope, limit));
  }

  try {
    let items;

    if (freeQuery) {
      const [domestic, world] = await Promise.all([
        fetchTopic(freeQuery, 'id', 'ID'),
        fetchTopic(freeQuery, 'en-US', 'US'),
      ]);
      items = dedupeAndSort([...domestic, ...world]);
    } else {
      const [domestic, world] = await Promise.all([
        Promise.all(DOMESTIC_TOPICS.map((topic) => fetchTopic(topic, 'id', 'ID'))),
        Promise.all(WORLD_TOPICS.map((topic) => fetchTopic(topic, 'en-US', 'US'))),
      ]);
      items = dedupeAndSort([...domestic.flat(), ...world.flat()]);
    }

    const payload = {
      ok: true,
      items,
      total: items.length,
      internationalCount: items.filter((i) => i.outletType === 'international').length,
      domesticCount: items.filter((i) => i.outletType === 'domestic').length,
      fetchedAt: now,
      scope: 'all',
      topics: {
        domestic: DOMESTIC_TOPICS,
        world: WORLD_TOPICS,
        total: DOMESTIC_TOPICS.length + WORLD_TOPICS.length,
      },
    };

    if (cacheable) cache = { at: now, payload };

    res.setHeader(
      'Cache-Control',
      'public, max-age=300, stale-while-revalidate=900',
    );
    return res.status(200).json(slicePayload(payload, scope, limit));
  } catch (error) {
    console.error('news-papua failed:', error);
    return res
      .status(500)
      .json({ ok: false, error: 'news_failed', detail: error?.message });
  }
}

/** Narrow a cached payload to the caller's scope and limit. */
function slicePayload(payload, scope, limit) {
  const items =
    scope === 'all'
      ? payload.items
      : payload.items.filter((item) => item.outletType === scope);
  return {
    ...payload,
    items: items.slice(0, limit),
    scope,
    total: items.length,
    returned: Math.min(items.length, limit),
  };
}
