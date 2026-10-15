/* ============================================================
   DOWNLOAD API — By Egaa v7
   Primary: tikwm.com (TikTok) + cobalt.tools (universal)
   ============================================================ */

const axios = require('axios');

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
    { name: 'snapchat',  r: /snapchat\.com/i },
    { name: 'threads',   r: /threads\.net/i }
  ];
  for (const p of pats) if (p.r.test(url)) return p.name;
  return 'general';
}

/* ============================================================
   API 1 — tikwm.com (khusus TikTok)
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
  if (!json || json.code !== 0 || !json.data) {
    throw new Error(json?.msg || 'tikwm: invalid response');
  }

  const d = json.data;
  const medias = [];

  // Video no watermark (HD kalau ada)
  if (d.hdplay) medias.push({
    type: 'video', quality: 'HD No Watermark', extension: 'mp4',
    is_audio: false, url: d.hdplay
  });
  if (d.play) medias.push({
    type: 'video', quality: 'No Watermark', extension: 'mp4',
    is_audio: false, url: d.play
  });
  if (d.wmplay) medias.push({
    type: 'video', quality: 'With Watermark', extension: 'mp4',
    is_audio: false, url: d.wmplay
  });

  // Audio
  if (d.music) medias.push({
    type: 'audio', quality: 'MP3 Original', extension: 'mp3',
    is_audio: true, url: d.music
  });

  // Foto/slideshow (kalau TikTok foto post)
  if (Array.isArray(d.images) && d.images.length) {
    d.images.forEach((img, i) => medias.push({
      type: 'image', quality: `Photo ${i + 1}`, extension: 'jpg',
      is_audio: false, url: img
    }));
  }

  if (!medias.length) throw new Error('tikwm: no media');

  return {
    ok: true,
    mode: 'download',
    api: 'tikwm',
    source: 'tiktok',
    title: d.title || 'TikTok Video',
    author: d.author?.nickname || d.author?.unique_id || null,
    duration: d.duration ? `${d.duration}s` : null,
    thumbnail: d.cover || d.origin_cover || null,
    url,
    medias
  };
}

/* ============================================================
   API 2 — cobalt.tools (universal)
   Instance publik yang gak butuh API key
   ============================================================ */
const COBALT_INSTANCES = [
  'https://co.wuk.sh/api/json',
  'https://api.cobalt.tools/api/json',
  'https://cobalt-api.kwiatekmiki.com/api/json'
];

async function cobaltDownload(url) {
  const payload = { url, vQuality: '720' };
  const errors = [];

  for (const api of COBALT_INSTANCES) {
    try {
      const res = await axios.post(api, payload, {
        timeout: 25000,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36'
        },
        validateStatus: () => true
      });

      if (res.status !== 200) {
        errors.push(`${api}: HTTP ${res.status}`);
        continue;
      }

      const json = res.data;

      // Format baru: { status: 'stream'|'redirect'|'picker', url | picker: [...] }
      // Format lama: { status: 'stream'|'redirect', url }
      if (json.status === 'error') {
        errors.push(`${api}: ${json.error?.code || 'error'}`);
        continue;
      }

      let medias = [];

      if (json.status === 'picker' && Array.isArray(json.picker)) {
        // Instagram/FB post dengan multiple media
        medias = json.picker.map((item, i) => ({
          type: item.type === 'photo' ? 'image' : 'video',
          quality: `Media ${i + 1}`,
          extension: item.type === 'photo' ? 'jpg' : 'mp4',
          is_audio: false,
          url: item.url
        }));
      } else if (json.url) {
        // Single media
        medias = [{
          type: 'video',
          quality: json.filename ? 'Original' : 'Default',
          extension: 'mp4',
          is_audio: false,
          url: json.url
        }];
      }

      if (!medias.length) {
        errors.push(`${api}: no media`);
        continue;
      }

      return {
        ok: true,
        mode: 'download',
        api: 'cobalt',
        source: detectPlatform(url),
        title: json.filename || 'Media',
        thumbnail: null,
        url,
        medias
      };
    } catch (err) {
      errors.push(`${api}: ${err.message}`);
    }
  }

  throw new Error(errors.join(' | '));
}

/* ============================================================
   ROUTER — pilih API berdasarkan platform
   ============================================================ */
async function processDownload(url) {
  const platform = detectPlatform(url);
  const errors = [];

  // TikTok → tikwm dulu (paling cepat & lengkap)
  if (platform === 'tiktok') {
    try { return await tikwmDownload(url); }
    catch (e) { errors.push(`tikwm: ${e.message}`); }
  }

  // Universal → cobalt
  try { return await cobaltDownload(url); }
  catch (e) { errors.push(`cobalt: ${e.message}`); }

  // Fallback terakhir: kalau bukan TikTok, coba tikwm juga (siapa tau bisa)
  if (platform !== 'tiktok') {
    try { return await tikwmDownload(url); }
    catch (e) { errors.push(`tikwm: ${e.message}`); }
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
      error: 'Gagal memproses media',
      detail: err.message
    });
  }
};
