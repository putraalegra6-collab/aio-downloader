const axios = require('axios');
const BASE = 'https://musicaly.maspaizz.web.id';
const JEREXD_KEY = process.env.JEREXD_KEY || 's2tQZgBEIaX4t3K7';
const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36';

const browserHeaders = {
  'User-Agent': UA,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
  'Content-Type': 'application/json',
  'Origin': BASE,
  'Referer': BASE + '/'
};

async function playFallback(videoId) {
  const r = await axios.get('https://api.jerexd.my.id/api/downloader/aiov2', {
    params: { apikey: JEREXD_KEY, url: 'https://www.youtube.com/watch?v=' + videoId },
    timeout: 30000,
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    validateStatus: () => true
  });
  const j = r.data;
  if (!j || j.status !== true || !j.result) throw new Error(j?.error || j?.message || 'fallback gagal');
  const medias = j.result.medias || [];
  const a = medias.find((m) => m.type === 'audio' || /^(mp3|m4a|opus|aac|wav)$/i.test(m.extension || ''));
  if (!a || !a.url) throw new Error('fallback tidak punya audio');
  return {
    status: true,
    result: {
      title: j.result.title,
      duration: j.result.duration,
      download: { audio: a.url }
    }
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, query, videoId, title, artist } = req.method === 'POST' ? req.body : req.query;

  try {
    if (action === 'search') {
      const r = await axios.get(`${BASE}/api/search?query=${encodeURIComponent(query)}&type=songs`, {
        headers: browserHeaders, timeout: 20000
      });
      return res.status(200).json(r.data);
    }
    if (action === 'play') {
      try {
        const r = await axios.post(`${BASE}/api/ytplay`, { query: videoId }, {
          headers: browserHeaders, timeout: 20000, validateStatus: () => true
        });
        if (r.status < 400 && r.data?.status && r.data?.result?.download?.audio) {
          return res.status(200).json(r.data);
        }
        throw new Error('musicaly tidak mengembalikan audio (status ' + r.status + ')');
      } catch (e1) {
        console.log('[ytmusic] musicaly gagal:', e1.message, '-> fallback');
        const fb = await playFallback(videoId);
        return res.status(200).json(fb);
      }
    }
    if (action === 'lyrics') {
      const r = await axios.get(`${BASE}/api/lyrics?id=${videoId}&title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`, {
        headers: browserHeaders, timeout: 20000
      });
      return res.status(200).json(r.data);
    }
    return res.status(400).json({ status: false, message: 'Action invalid' });
  } catch (err) {
    return res.status(500).json({ status: false, message: err.message });
  }
};
