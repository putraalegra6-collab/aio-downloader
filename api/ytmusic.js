const axios = require('axios');
const nanz = require('../lib/nanz');
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
      timeout: 8000,
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

// Kumpulkan kandidat link audio dari dua sumber (paralel)
async function getCandidates(videoId) {
  const musicaly = axios.post(`${BASE}/api/ytplay`, { query: videoId }, {
    headers: browserHeaders, timeout: 10000, validateStatus: () => true
  }).then((r) => ({
    urls: r.data?.result?.download?.audio ? [r.data.result.download.audio] : [],
    duration: r.data?.result?.duration || null
  })).catch(() => ({ urls: [], duration: null }));

  const jerexd = axios.get('https://api.jerexd.my.id/api/downloader/aiov2', {
    params: { apikey: JEREXD_KEY, url: 'https://www.youtube.com/watch?v=' + videoId },
    timeout: 12000,
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    validateStatus: () => true
  }).then((r) => {
    const j = r.data;
    if (!j || j.status !== true || !j.result) return { urls: [], duration: null };
    const urls = (j.result.medias || [])
      .filter((m) => (m.type === 'audio' || /^(mp3|m4a|opus|aac|wav)$/i.test(m.extension || '')) && m.url)
      .map((m) => m.url);
    return { urls, duration: j.result.duration || null };
  }).catch(() => ({ urls: [], duration: null }));

  const nanzSrc = Promise.race([
    nanz.extractAudio(videoId).then((x) => ({ urls: x.streamUrl ? [x.streamUrl] : [], duration: x.duration || null })),
    new Promise((r) => setTimeout(() => r({ urls: [], duration: null }), 15000))
  ]).catch((e) => {
    console.log('[ytmusic] nanzmusify error:', e.message);
    return { urls: [], duration: null };
  });

  const [a, b, c] = await Promise.all([musicaly, jerexd, nanzSrc]);
  return {
    urls: [...new Set([...a.urls, ...c.urls, ...b.urls])],
    duration: a.duration || c.duration || b.duration || null
  };
}

function fmtDur(d) {
  if (typeof d === 'number' && isFinite(d)) {
    return Math.floor(d / 60) + ':' + String(Math.floor(d % 60)).padStart(2, '0');
  }
  return d || null;
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
      if (!urls.length) {
        return res.status(200).json({ status: false, message: 'Tidak ada sumber audio untuk lagu ini' });
      }
      const checks = await Promise.all(urls.map((u) => isPlayableAudio(u)));
      const idx = checks.indexOf(true);
      console.log('[ytmusic]', videoId, 'kandidat:', urls.length, 'lolos cek:', checks.filter(Boolean).length);
      // Kalau pengecekan gagal semua, tetap kirim kandidat pertama.
      const pick = idx !== -1 ? idx : 0;
      return res.status(200).json({
        status: true,
        result: { duration: fmtDur(duration), download: { audio: urls[pick] } }
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
