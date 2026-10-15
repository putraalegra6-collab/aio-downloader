/* ============================================================
   DOWNLOAD API — API 1 (downr.org) + API 2 (getdl.space)
   Sistem fallback otomatis: kalau API 1 gagal → API 2 dipakai.
   ============================================================ */

const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

/* ============================================================
   API 1 — downr.org (universal downloader)
   ============================================================ */
const DOWNR_BASE = 'https://downr.org';
const DOWNR_UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36';

async function downrSession() {
  const res = await fetch(`${DOWNR_BASE}/.netlify/functions/analytics`, {
    headers: { 'User-Agent': DOWNR_UA, 'Referer': `${DOWNR_BASE}/` },
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`session init gagal (${res.status})`);
  const raw = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  return raw.map(c => c.split(';')[0]).join('; ');
}

function downrConvert(url, cookie) {
  return fetch(`${DOWNR_BASE}/.netlify/functions/bbc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': DOWNR_BASE,
      'Referer': `${DOWNR_BASE}/`,
      'User-Agent': DOWNR_UA,
      ...(cookie ? { 'Cookie': cookie } : {})
    },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(20000)
  });
}

async function downrDownload(url) {
  let cookie = await downrSession();
  let r = await downrConvert(url, cookie);

  if (r.status === 403) {
    const text = await r.text();
    if (text.trim() !== 'user_retry_required') throw new Error('access forbidden');
    cookie = await downrSession();
    r = await downrConvert(url, cookie);
    if (r.status === 403) throw new Error('access forbidden');
  }
  if (r.status === 429) throw new Error('rate limited');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);

  const json = await r.json();
  if (json.error) throw new Error(typeof json.error === 'string' && json.error.trim() ? json.error : 'invalid url');

  const medias = (json.medias || []).filter(m => m && m.url);
  if (!medias.length) throw new Error('no media');

  return {
    ok: true,
    mode: 'download',
    api: 'downr',
    source: json.source || null,
    title: json.title || null,
    thumbnail: json.thumbnail || null,
    url: json.url || url,
    medias: medias.map(m => ({
      type: m.type || null,
      quality: m.quality || null,
      extension: m.extension || null,
      is_audio: m.is_audio ?? null,
      url: m.url
    }))
  };
}

/* ============================================================
   API 2 — getdl.space (TikTok search)
   ============================================================ */
const GETDL_BASE = 'https://getdl.space';
const GETDL_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer': 'https://getdl.space/id/search/tiktok',
  'Origin': 'https://getdl.space'
};

async function getdlSearch(query, count = 12, region = 'ID') {
  const jar = new CookieJar();
  const client = wrapper(axios.create({ jar, withCredentials: true, timeout: 15000 }));

  const sess = await client.get(`${GETDL_BASE}/api/session`, { headers: GETDL_HEADERS });
  if (!sess.data?.success || !sess.data.sessionId) {
    throw new Error('session init gagal');
  }

  const res = await client.post(
    `${GETDL_BASE}/api/search/tiktok`,
    { query, count, cursor: 0, region, sessionId: sess.data.sessionId, sortType: 0 },
    { headers: { ...GETDL_HEADERS, 'Content-Type': 'application/json' } }
  );

  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  if (!res.data?.success) throw new Error('api error');

  const { totalResults, videos } = res.data.data || {};
  const results = (videos || []).map((v, i) => ({
    index: i + 1,
    title: v.title,
    duration: v.duration,
    play_url: v.playUrl,
    cover_url: v.cover,
    created_at: new Date(v.createdAt).toLocaleString('id-ID')
  }));

  if (!results.length) throw new Error('no results');

  return {
    ok: true,
    mode: 'search',
    api: 'getdl',
    query,
    total_results: totalResults,
    data: results
  };
}

/* ============================================================
   AUTO-DETECT: URL vs keyword
   ============================================================ */
function isUrl(input) {
  const s = String(input).trim();
  if (/^https?:\/\//i.test(s)) return true;
  return /(?:tiktok|instagram|youtube|youtu\.be|facebook|fb\.watch|twitter|x\.com|spotify|pinterest|soundcloud)\.(?:com|be|space|org|net|co)/i.test(s);
}

/* ============================================================
   HANDLER dengan FALLBACK otomatis
   - URL     → API 1 (downr) utama | API 2 (getdl) fallback
   - Keyword → API 2 (getdl) utama  | API 1 (downr) fallback
   ============================================================ */
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ status: false, error: 'Method not allowed' });
  }

  const { input } = req.body || {};
  if (!input || !String(input).trim()) {
    return res.status(400).json({ status: false, error: 'Input wajib diisi' });
  }

  const value = String(input).trim();
  const urlMode = isUrl(value);

  const errors = [];

  /* --- Tentukan urutan API berdasarkan input --- */
  const apiChain = urlMode
    ? [
        { name: 'downr', fn: () => downrDownload(value) },
        { name: 'getdl', fn: () => getdlSearch(value, 12, 'ID') }
      ]
    : [
        { name: 'getdl', fn: () => getdlSearch(value, 12, 'ID') },
        { name: 'downr', fn: () => downrDownload(value) }
      ];

  /* --- Coba API satu per satu sampai ada yang berhasil --- */
  for (let i = 0; i < apiChain.length; i++) {
    const api = apiChain[i];
    try {
      const result = await api.fn();
      if (result && result.ok) {
        // Tandai kalau ini hasil fallback (bukan API utama)
        if (i > 0) {
          result.fallback = true;
          result.primary_api = apiChain[0].name;
        } else {
          result.fallback = false;
        }
        return res.status(200).json({ status: true, ...result });
      }
    } catch (err) {
      errors.push(`${api.name}: ${err.message}`);
    }
  }

  /* --- Semua API gagal --- */
  return res.status(500).json({
    status: false,
    error: 'Semua server tidak merespons',
    detail: errors.join(' | ')
  });
};
