/* ============================================================
   DOWNLOAD API — By Egaa
   Fokus Downr.org dengan session management yang benar
   ============================================================ */

const axios = require('axios');

const DOWNR_BASE = 'https://downr.org';
const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36';

/* ---------- Detect platform ---------- */
function detectPlatform(url) {
  if (!url) return 'general';
  const patterns = [
    { name: 'tiktok',    r: /tiktok\.com|vt\.tiktok|vm\.tiktok/i },
    { name: 'youtube',   r: /youtube\.com|youtu\.be/i },
    { name: 'instagram', r: /instagram\.com|instagr\.am/i },
    { name: 'facebook',  r: /facebook\.com|fb\.watch|fb\.com/i },
    { name: 'twitter',   r: /twitter\.com|x\.com/i },
    { name: 'spotify',   r: /spotify\.com/i },
    { name: 'soundcloud',r: /soundcloud\.com/i },
    { name: 'pinterest', r: /pinterest\.com|pin\.it/i },
    { name: 'reddit',    r: /reddit\.com|redd\.it/i }
  ];
  for (const p of patterns) if (p.r.test(url)) return p.name;
  return 'general';
}

/* ---------- Fix URL relative ---------- */
function fixUrl(u, base) {
  if (!u || typeof u !== 'string') return null;
  if (u.startsWith('http')) return u;
  if (u.startsWith('/')) return base + u;
  return u;
}

/* ---------- Parse Flight chunk (kalau response Next.js) ---------- */
function parseFlightChunks(text, base) {
  const map = {};
  const rx = /([0-9a-f]+):T([0-9a-f]+),/g;
  let m;
  while ((m = rx.exec(text)) !== null) {
    const id = m[1];
    const len = parseInt(m[2], 16);
    const start = m.index + m[0].length;
    map['$' + id] = text.slice(start, start + len);
  }
  return map;
}

/* ---------- Downr: ambil cookie session ---------- */
async function downrSession() {
  try {
    const res = await axios.get(`${DOWNR_BASE}/.netlify/functions/analytics`, {
      timeout: 15000,
      headers: {
        'User-Agent': UA,
        'Accept': '*/*',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': `${DOWNR_BASE}/`,
        'Origin': DOWNR_BASE,
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin'
      },
      validateStatus: () => true
    });

    const setCookie = res.headers['set-cookie'] || [];
    const cookies = setCookie.map(c => c.split(';')[0]).join('; ');
    return cookies;
  } catch (err) {
    throw new Error(`session: ${err.message}`);
  }
}

/* ---------- Downr: convert URL ---------- */
async function downrConvert(url, cookie) {
  const res = await axios.post(
    `${DOWNR_BASE}/.netlify/functions/bbc`,
    { url },
    {
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': '*/*',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'Origin': DOWNR_BASE,
        'Referer': `${DOWNR_BASE}/`,
        'User-Agent': UA,
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        ...(cookie ? { 'Cookie': cookie } : {})
      },
      validateStatus: () => true
    }
  );
  return res;
}

/* ---------- Downr main ---------- */
async function downrDownload(url) {
  const cookie = await downrSession();
  let r = await downrConvert(url, cookie);

  // Retry kalau butuh cookie baru
  if (r.status === 403) {
    const text = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
    if (text.includes('user_retry_required')) {
      const cookie2 = await downrSession();
      r = await downrConvert(url, cookie2);
    }
  }

  if (r.status !== 200) {
    throw new Error(`downr HTTP ${r.status}`);
  }

  let json = r.data;
  if (typeof json === 'string') {
    // Coba parse Flight chunks dulu
    if (json.includes(':"$') || /[0-9a-f]+:T[0-9a-f]+,/.test(json)) {
      const chunks = parseFlightChunks(json, DOWNR_BASE);
      const idx = json.indexOf('{"success":');
      if (idx >= 0) {
        let depth = 0, end = -1;
        for (let i = idx; i < json.length; i++) {
          if (json[i] === '{') depth++;
          else if (json[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
        }
        if (end > 0) json = JSON.parse(json.slice(idx, end));
      }
    } else {
      json = JSON.parse(json);
    }
  }

  if (json.error) {
    throw new Error(typeof json.error === 'string' ? json.error : 'invalid url');
  }

  const medias = (json.medias || []).filter(m => m && m.url);
  if (!medias.length) throw new Error('no media found');

  return {
    ok: true,
    mode: 'download',
    api: 'downr',
    source: json.source || detectPlatform(url),
    title: json.title || null,
    thumbnail: fixUrl(json.thumbnail, DOWNR_BASE),
    url: json.url || url,
    medias: medias.map(m => ({
      type: m.type || (m.is_audio ? 'audio' : 'video'),
      quality: m.quality || 'Default',
      extension: m.extension || (m.is_audio ? 'mp3' : 'mp4'),
      is_audio: m.is_audio ?? false,
      url: fixUrl(m.url, DOWNR_BASE)
    }))
  };
}

/* ---------- isUrl ---------- */
function isUrl(input) {
  const s = String(input).trim();
  if (/^https?:\/\//i.test(s)) return true;
  return /(?:tiktok|instagram|youtube|youtu\.be|facebook|fb\.watch|twitter|x\.com|spotify|pinterest|soundcloud|reddit|threads|twitch|capcut)\.(?:com|be|space|org|net|co|tv)/i.test(s);
}

/* ============================================================
   HANDLER
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
  if (!isUrl(value)) {
    return res.status(400).json({ status: false, error: 'Masukkan link media yang valid' });
  }

  try {
    const result = await downrDownload(value);
    return res.status(200).json({ status: true, ...result });
  } catch (err) {
    return res.status(500).json({
      status: false,
      error: err.message || 'Gagal memproses media',
      detail: err.message
    });
  }
};
