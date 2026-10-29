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

// Cek apakah link benar-benar file audio (bukan halaman web / JSON)
async function isPlayableAudio(url) {
  try {
    const r = await axios.get(url, {
      headers: { 'User-Agent': UA, 'Range': 'bytes=0-1023', 'Accept': '*/*' },
      responseType: 'arraybuffer',
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: () => true
    });
    if (r.status >= 400) return false;
    const type = String(r.headers['content-type'] || '');
    if (/html|json/i.test(type)) return false;
    const head = Buffer.from(r.data).slice(0, 64).toString('latin1').trimStart();
    if (head.startsWith('<') || head.startsWith('{')) return false;
    return true;
  } catch (e) {
    return false;
  }
}

// Kumpulkan kandidat link audio dari beberapa sumber
async function getCandidates(videoId) {
  const urls = [];
  let duration = null;

  try {
    const r = await axios.post(`${BASE}/api/ytplay`, { query: videoId }, {
      headers: browserHeaders, timeout: 20000, validateStatus: () => true
    });
    const u = r.data?.result?.download?.audio;
    if (u) urls.push(u);
    duration = r.data?.result?.duration || null;
  } catch (e) {
    console.log('[ytmusic] musicaly error:', e.message);
  }

  try {
    const r = await axios.get('https://api.jerexd.my.id/api/downloader/aiov2', {
      params: { apikey: JEREXD_KEY, url: 'https://www.youtube.com/watch?v=' + videoId },
      timeout: 30000,
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      validateStatus: () => true
    });
    const j = r.data;
    if (j && j.status === true && j.result) {
      for (const m of (j.result.medias || [])) {
        const isAudio = m.type === 'audio' || /^(mp3|m4a|opus|aac|wav)$/i.test(m.extension || '');
        if (isAudio && m.url) urls.push(m.url);
      }
      if (!duration) duration = j.result.duration || null;
    }
  } catch (e) {
    console.log('[ytmusic] jerexd error:', e.message);
  }

  return { urls: [...new Set(urls)], duration };
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
      const { urls, duration } = await getCandidates(videoId);
      for (const u of urls) {
        if (await isPlayableAudio(u)) {
          return res.status(200).json({
            status: true,
            result: { duration, download: { audio: u } }
          });
        }
      }
      return res.status(200).json({
        status: false,
        message: 'Semua sumber audio gagal untuk lagu ini'
      });
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
