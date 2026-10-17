/* ============================================================
   YOUTUBE API — By Egaa v8 (Fix Thumbnail & Filter Size)
   ============================================================ */

const axios = require('axios');

const VAMX_KEY = 'vamx_live_1bb188197b9ec7df7c75165aee481b59';
const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36";

const INVIDIOUS = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://yewtu.be',
  'https://invidious.f5.si',
  'https://iv.melmac.space'
];

async function searchViaVamx(query) {
  const api = `https://vamxapi.my.id/api/v1/search/youtube?q=${encodeURIComponent(query)}&limit=15&type=video&order=relevance`;
  const res = await axios.get(api, { timeout: 15000, headers: { 'x-api-key': VAMX_KEY, 'User-Agent': UA } });
  if (res.data?.status === false) throw new Error("Vamx limit");
  let results = res.data?.data || res.data?.result || res.data || [];
  if (!Array.isArray(results) || results.length === 0) throw new Error("Vamx kosong");

  return results.map(v => {
    const vid = v.videoId || v.id || (v.url ? v.url.split('v=')[1] : null);
    return {
      videoId: vid,
      title: v.title || 'Tanpa Judul',
      url: v.url || `https://www.youtube.com/watch?v=${vid}`,
      duration: v.duration || v.timestamp || null,
      views: v.views || v.viewCount || null,
      channel: { name: v.channel || v.author?.name || 'Unknown' },
      // FIX: Paksa pakai i.ytimg.com biar gak kena hotlink block
      thumbnail: vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : (v.thumbnail || '')
    };
  }).filter(v => v.videoId);
}

async function searchViaInvidious(query) {
  let errors = [];
  for (const inst of INVIDIOUS) {
    try {
      const res = await axios.get(`${inst}/api/v1/search?q=${encodeURIComponent(query)}&type=video`, { timeout: 15000, headers: { 'User-Agent': UA } });
      if (res.status === 200 && Array.isArray(res.data) && res.data.length > 0) {
        return res.data.map(v => ({
          videoId: v.videoId,
          title: v.title || 'Tanpa Judul',
          url: `https://www.youtube.com/watch?v=${v.videoId}`,
          duration: v.lengthSeconds ? `${v.lengthSeconds}s` : null,
          views: v.viewCount ? `${v.viewCount} views` : null,
          channel: { name: v.author || 'Unknown' },
          // FIX: Pakai i.ytimg.com
          thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`
        }));
      }
      errors.push(`${inst}: kosong`);
    } catch (e) { errors.push(`${inst}: err`); }
  }
  throw new Error("Semua server search gagal: " + errors.join(' | '));
}

async function search(query) {
  try {
    const res = await searchViaVamx(query);
    if (res.length > 0) return { query, total: res.length, results: res };
  } catch (err) { console.log("Vamx gagal, fallback ke Invidious..."); }
  const res = await searchViaInvidious(query);
  return { query, total: res.length, results: res };
}

function extractVideoId(input) {
  const s = String(input).trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

async function download(url) {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error("Video ID tidak valid");

  let data = null;
  let errors = [];

  for (const inst of INVIDIOUS) {
    try {
      const res = await axios.get(`${inst}/api/v1/videos/${videoId}`, { timeout: 15000, headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
      if (res.status === 200 && res.data && res.data.title) { data = res.data; break; }
    } catch (err) { errors.push(`${inst.replace('https://','')}`); }
  }

  if (!data) throw new Error(`Gagal download. Server Invidious sibuk.`);

  const title = data.title || 'Video';
  const author = data.author || null;
  const duration = data.lengthSeconds ? `${data.lengthSeconds}s` : null;
  const thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`; // PAKAI INI BIAR PASTI MUNCUL

  const mp4 = [];
  const mp4v = [];
  const mp3 = [];

  // PROGRESSIVE (Audio + Video)
  (data.formatStreams || []).forEach(f => {
    if (!f.url) return;
    const hMatch = (f.qualityLabel || '').match(/(\d+)p/);
    const height = hMatch ? parseInt(hMatch[1]) : 0;
    mp4.push({ quality: f.qualityLabel || 'Video', format: 'mp4', url: f.url, height, has_audio: true });
  });

  // ADAPTIVE VIDEO (Cuma Video) - FILTER MAX 1080p BIAR GAK TIMEOUT
  (data.adaptiveFormats || []).filter(f => f.type && f.type.startsWith('video')).forEach(f => {
    if (!f.url) return;
    const hMatch = (f.qualityLabel || '').match(/(\d+)p/);
    const height = hMatch ? parseInt(hMatch[1]) : 0;
    
    // Skip kalau di bawah 144p, atau di atas 1080p (biar gak berat di proxy)
    if (height < 144 || height > 1080) return;
    // Skip kalau resolusi sama udah ada di progressive (biar gak dobel)
    if (mp4.find(m => m.height === height)) return;
    
    mp4v.push({ quality: f.qualityLabel + ' (Tanpa Audio)', format: 'mp4', url: f.url, height, has_audio: false });
  });

  // ADAPTIVE AUDIO
  (data.adaptiveFormats || []).filter(f => f.type && f.type.startsWith('audio')).forEach(f => {
    if (!f.url) return;
    const bitrate = f.bitrate ? Math.round(f.bitrate / 1000) : 128;
    mp3.push({ quality: `${bitrate}kbps`, format: 'mp3', url: f.url, bitrate });
  });

  mp4.sort((a, b) => b.height - a.height);
  mp4v.sort((a, b) => b.height - a.height);
  mp3.sort((a, b) => b.bitrate - a.bitrate);

  return {
    videoId, title, author, duration, thumbnail, url,
    mp4: [...new Map(mp4.map(m => [m.height, m])).values()].slice(0, 6),
    mp4video_only: [...new Map(mp4v.map(m => [m.height, m])).values()].slice(0, 4),
    mp3: [...new Map(mp3.map(m => [m.bitrate, m])).values()].slice(0, 4)
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, query, url } = req.body || {};
  try {
    if (action === 'search') return res.status(200).json(await search(query));
    if (action === 'download') return res.status(200).json(await download(url));
    return res.status(400).json({ error: 'Action invalid' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
