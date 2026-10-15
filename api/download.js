/* ============================================================
   DOWNLOAD API — By Egaa v9
   Primary: Nexa AIO API (nexadev.my.id)
   Fallback: tikwm.com (khusus TikTok)
   ============================================================ */

const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/* ============================================================
   DETECT PLATFORM
   ============================================================ */
function detectPlatform(url) {
  if (!url) return 'general';
  const pats = [
    { name: 'tiktok',    r: /tiktok\.com|vt\.tiktok|vm\.tiktok/i },
    { name: 'youtube',   r: /youtube\.com|youtu\.be/i },
    { name: 'instagram', r: /instagram\.com|instagr\.am/i },
    { name: 'facebook',  r: /facebook\.com|fb\.watch|fb\.com/i },
    { name: 'twitter',   r: /twitter\.com|x\.com/i },
    { name: 'spotify',   r: /spotify\.com/i },
    { name: 'soundcloud',r: /soundcloud\.com/i },
    { name: 'pinterest', r: /pinterest\.com|pin\.it/i },
    { name: 'reddit',    r: /reddit\.com|redd\.it/i },
    { name: 'threads',   r: /threads\.net/i },
    { name: 'snapchat',  r: /snapchat\.com/i }
  ];
  for (const p of pats) if (p.r.test(url)) return p.name;
  return 'general';
}

/* ============================================================
   API 1 — Nexa AIO (primary, universal)
   ============================================================ */
async function nexaDownload(url) {
  const api = `https://api.nexadev.my.id/api/aio?url=${encodeURIComponent(url)}`;

  const res = await axios.get(api, {
    timeout: 30000,
    headers: {
      'User-Agent': UA,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      'Connection': 'keep-alive'
    },
    validateStatus: () => true
  });

  if (res.status !== 200) throw new Error(`nexa HTTP ${res.status}`);

  const json = res.data;
  if (!json || json.status !== true || !Array.isArray(json.data)) {
    throw new Error(json?.message || 'nexa: invalid response');
  }

  const raw = json.data.filter(item => item && item.url);
  if (!raw.length) throw new Error('nexa: no media found');

  // Normalisasi ke format kita
  const medias = raw.map((item, i) => {
    const type = (item.type || 'mp4').toLowerCase();
    const isAudio = type === 'mp3' || type === 'm4a' || type === 'audio';
    const isImage = ['jpg', 'jpeg', 'png', 'webp', 'image'].includes(type);

    let kind = 'video';
    if (isAudio) kind = 'audio';
    else if (isImage) kind = 'image';

    let ext = type;
    if (ext === 'image') ext = 'jpg';
    if (ext === 'audio') ext = 'mp3';

    // Derive quality label dari filename atau index
    let quality = `Media ${i + 1}`;
    try {
      const u = new URL(item.url);
      const fn = decodeURIComponent(u.pathname.split('/').pop() || '');
      if (fn && fn.length < 60) quality = fn.replace(/\.[a-z0-9]+$/i, '').slice(0, 40);
    } catch {}

    return {
      type: kind,
      quality: kind === 'audio' ? 'Audio' : (kind === 'image' ? `Photo ${i + 1}` : quality),
      extension: ext,
      is_audio: isAudio,
      url: item.url
    };
  });

  return {
    ok: true,
    mode: 'download',
    api: 'nexa',
    source: detectPlatform(url),
    title: 'Media Download',
    thumbnail: null,
    url,
    medias
  };
}

/* ============================================================
   API 2 — tikwm (fallback khusus TikTok)
   ============================================================ */
async function tikwmDownload(url) {
  const api = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`;

  const res = await axios.get(api, {
    timeout: 25000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36',
      'Accept': 'application/json,text/plain,*/*',
      'Referer': 'https://www.tikwm.com/'
    },
    validateStatus: () => true
  });

  if (res.status !== 200) throw new Error(`tikwm HTTP ${res.status}`);
  const json = res.data;
  if (!json || json.code !== 0 || !json.data) throw new Error(json?.msg || 'tikwm invalid');

  const d = json.data;
  const medias = [];
  if (d.hdplay) medias.push({ type: 'video', quality: 'HD No Watermark', extension: 'mp4', is_audio: false, url: d.hdplay });
  if (d.play)   medias.push({ type: 'video', quality: 'No Watermark', extension: 'mp4', is_audio: false, url: d.play });
  if (d.wmplay) medias.push({ type: 'video', quality: 'With Watermark', extension: 'mp4', is_audio: false, url: d.wmplay });
  if (d.music)  medias.push({ type: 'audio', quality: 'MP3 Original', extension: 'mp3', is_audio: true, url: d.music });
  if (Array.isArray(d.images)) d.images.forEach((img, i) => medias.push({
    type: 'image', quality: `Photo ${i + 1}`, extension: 'jpg', is_audio: false, url: img
  }));
  if (!medias.length) throw new Error('tikwm no media');

  return {
    ok: true, mode: 'download', api: 'tikwm', source: 'tiktok',
    title: d.title || 'TikTok Video',
    author: d.author?.nickname || null,
    thumbnail: d.cover || d.origin_cover || null,
    url, medias
  };
}

/* ============================================================
   MASTER ROUTER — Nexa dulu, fallback tikwm kalau TikTok
   ============================================================ */
async function processDownload(url) {
  const platform = detectPlatform(url);
  const errors = [];

  // Try 1: Nexa AIO (universal)
  try {
    return await nexaDownload(url);
  } catch (err) {
    errors.push(`nexa: ${err.message}`);
  }

  // Try 2: kalau TikTok, coba tikwm sebagai backup
  if (platform === 'tiktok') {
    try {
      return await tikwmDownload(url);
    } catch (err) {
      errors.push(`tikwm: ${err.message}`);
    }
  }

  throw new Error(errors.join(' | '));
}

/* ============================================================
   HANDLER
   ============================================================ */
function isUrl(s) {
  if (/^https?:\/\//i.test(s)) return true;
  return /(?:tiktok|instagram|youtube|youtu\.be|facebook|fb\.watch|twitter|x\.com|spotify|pinterest|soundcloud|reddit|threads|twitch|capcut|snapchat)\.(?:com|be|space|org|net|co|tv)/i.test(s);
}

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
    const result = await processDownload(value);
    return res.status(200).json({ status: true, ...result });
  } catch (err) {
    return res.status(500).json({
      status: false,
      error: err.message || 'Gagal memproses media',
      detail: err.message
    });
  }
};
