/* ============================================================
   YOUTUBE API — By Egaa v6
   Search: Vamx API (bypass YouTube block)
   Download: Invidious multi-instance (stream ready)
   ============================================================ */

const axios = require('axios');

const VAMX_KEY = 'vamx_live_1bb188197b9ec7df7c75165aee481b59';
const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36";

/* ============================================================
   SEARCH — Via Vamx API
   ============================================================ */
async function search(query) {
  const api = `https://vamxapi.my.id/api/v1/search/youtube?q=${encodeURIComponent(query)}&limit=15&type=video&order=relevance`;

  const res = await axios.get(api, {
    timeout: 25000,
    headers: {
      'x-api-key': VAMX_KEY,
      'User-Agent': UA,
      'Accept': 'application/json'
    },
    validateStatus: () => true
  });

  if (res.status !== 200) throw new Error(`Vamx API HTTP ${res.status}`);
  
  // Handle response structure (kadang beda-beda formatnya)
  const json = res.data;
  let results = [];
  
  if (Array.isArray(json)) results = json;
  else if (json.data && Array.isArray(json.data)) results = json.data;
  else if (json.result && Array.isArray(json.result)) results = json.result;
  else if (json.videos && Array.isArray(json.videos)) results = json.videos;

  if (!results.length) throw new Error("Hasil tidak ditemukan / limit Vamx habis");

  // Normalisasi ke format kita
  const normalized = results.map(v => ({
    videoId: v.videoId || v.id || (v.url ? v.url.split('v=')[1] : null),
    title: v.title || 'Tanpa Judul',
    url: v.url || `https://www.youtube.com/watch?v=${v.videoId || v.id}`,
    duration: v.duration || v.timestamp || null,
    views: v.views || v.viewCount || null,
    channel: { name: v.channel || v.author?.name || 'Unknown' },
    thumbnail: v.thumbnail || v.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${v.videoId || v.id}/hqdefault.jpg`
  })).filter(v => v.videoId);

  if (!normalized.length) throw new Error("Data Vamx tidak valid");

  return { query, total: normalized.length, results: normalized };
}

/* ============================================================
   DOWNLOAD — Multi-instance Invidious / Cobalt
   ============================================================ */
const VIDEO_ID_REGEX = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/;

function extractVideoId(input) {
  const s = String(input).trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(VIDEO_ID_REGEX);
  return m ? m[1] : null;
}

async function download(url) {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error("Video ID tidak valid");

  // Endpoint Invidious publik (kita coba satu-satu)
  const instances = [
    'https://inv.nadeko.net',
    'https://invidious.nerdvpn.de',
    'https://yewtu.be',
    'https://invidious.f5.si',
    'https://iv.melmac.space',
    'https://invidious.privacyredirect.com'
  ];

  let data = null;
  let errors = [];

  for (const inst of instances) {
    try {
      const res = await axios.get(`${inst}/api/v1/videos/${videoId}`, {
        timeout: 15000,
        headers: { 'User-Agent': UA, 'Accept': 'application/json' },
        validateStatus: () => true
      });

      if (res.status === 200 && res.data && res.data.title) {
        data = res.data;
        break;
      }
      errors.push(`${inst.replace('https://','')}: ${res.status}`);
    } catch (err) {
      errors.push(`${inst.replace('https://','')}: ${err.message}`);
    }
  }

  if (!data) throw new Error(`Gagal download. Server: ${errors.join(' | ')}`);

  const title = data.title || 'Video';
  const author = data.author || null;
  const duration = data.lengthSeconds ? `${data.lengthSeconds}s` : null;
  const thumbnail = data.videoThumbnails?.[0]?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  const mp4 = [];
  const mp4v = [];
  const mp3 = [];

  // Format video+audio (progressive)
  (data.formatStreams || []).forEach(f => {
    if (!f.url) return;
    const hMatch = (f.qualityLabel || '').match(/(\d+)p/);
    const height = hMatch ? parseInt(hMatch[1]) : 0;
    mp4.push({
      quality: f.qualityLabel || 'Video',
      format: 'mp4',
      url: f.url,
      height,
      has_audio: true
    });
  });

  // Format video-only (adaptive)
  (data.adaptiveFormats || []).filter(f => f.type && f.type.startsWith('video')).forEach(f => {
    if (!f.url) return;
    const hMatch = (f.qualityLabel || '').match(/(\d+)p/);
    const height = hMatch ? parseInt(hMatch[1]) : 0;
    if (height < 144) return;
    
    // Skip kalau udah ada di progressive
    if (mp4.find(m => m.height === height)) return;
    
    mp4v.push({
      quality: f.qualityLabel + ' (video only)',
      format: 'mp4',
      url: f.url,
      height,
      has_audio: false
    });
  });

  // Format audio
  (data.adaptiveFormats || []).filter(f => f.type && f.type.startsWith('audio')).forEach(f => {
    if (!f.url) return;
    const bitrate = f.bitrate ? Math.round(f.bitrate / 1000) : 128;
    mp3.push({
      quality: `${bitrate}kbps`,
      format: 'mp3',
      url: f.url,
      bitrate
    });
  });

  // Sort & dedupe
  mp4.sort((a, b) => b.height - a.height);
  mp4v.sort((a, b) => b.height - a.height);
  mp3.sort((a, b) => b.bitrate - a.bitrate);

  const mp4u = [...new Map(mp4.map(m => [m.height, m])).values()];
  const mp4vu = [...new Map(mp4v.map(m => [m.height, m])).values()];
  const mp3u = [...new Map(mp3.map(m => [m.bitrate, m])).values()];

  if (!mp4u.length && !mp4vu.length && !mp3u.length) {
    throw new Error('Video ini tidak punya format yang bisa diunduh');
  }

  return {
    videoId, title, author, duration, thumbnail, url,
    source: 'invidious',
    mp4: mp4u.slice(0, 6),
    mp4video_only: mp4vu.slice(0, 4),
    mp3: mp3u.slice(0, 4)
  };
}

/* ============================================================
   HANDLER
   ============================================================ */
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, query, url } = req.body || {};

  try {
    if (action === 'search') {
      if (!query) return res.status(400).json({ error: 'Query wajib diisi' });
      return res.status(200).json(await search(query));
    }
    if (action === 'download') {
      if (!url) return res.status(400).json({ error: 'URL wajib diisi' });
      return res.status(200).json(await download(url));
    }
    return res.status(400).json({ error: 'Action tidak valid' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
