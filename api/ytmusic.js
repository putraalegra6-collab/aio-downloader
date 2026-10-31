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

// Hasil: 'ok' (file audio), 'bad' (pasti bukan audio, mis. halaman web), 'unknown' (tidak bisa dicek)
async function isPlayableAudio(url) {
  try {
    const r = await axios.get(url, {
      headers: { 'User-Agent': UA, 'Range': 'bytes=0-1023', 'Accept': '*/*' },
      responseType: 'arraybuffer',
      timeout: 8000,
      maxRedirects: 5,
      validateStatus: () => true
    });
    if (r.status >= 400) return 'bad';
    const type = String(r.headers['content-type'] || '');
    if (/html|json/i.test(type)) return 'bad';
    const head = Buffer.from(r.data).slice(0, 64).toString('latin1').trimStart();
    if (head.startsWith('<') || head.startsWith('{')) return 'bad';
    return 'ok';
  } catch (e) {
    return 'unknown';
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

// Sumber audio untuk play: NanzMusify saja (Musicaly dan Jerexd tidak dipakai saat memutar)
async function getNanzCandidates(videoId) {
  try {
    const x = await Promise.race([
      nanz.extractAudio(videoId),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 20 detik')), 20000))
    ]);
    console.log('[ytmusic]', videoId, 'sumber: nanz', x.streamUrl ? 'ada link' : 'tanpa link');
    return { urls: x.streamUrl ? [x.streamUrl] : [], duration: x.duration || null };
  } catch (e) {
    console.log('[ytmusic] nanzmusify error:', e.message);
    return { urls: [], duration: null };
  }
}

// Cadangan kedua untuk play: Musicaly (Jerexd tidak dipakai)
async function getMusicalyCandidate(videoId) {
  try {
    const r = await axios.post(`${BASE}/api/ytplay`, { query: videoId }, {
      headers: browserHeaders, timeout: 10000, validateStatus: () => true
    });
    const u = r.data && r.data.result && r.data.result.download && r.data.result.download.audio;
    console.log('[ytmusic]', videoId, 'sumber: musicaly', u ? 'ada link' : 'tanpa link');
    return { urls: u ? [u] : [], duration: (r.data && r.data.result && r.data.result.duration) || null };
  } catch (e) {
    console.log('[ytmusic] musicaly error:', e.message);
    return { urls: [], duration: null };
  }
}

const NAA = 'https://naa-music.vercel.app';

// Pencarian lewat Naa Music (hasil dipetakan ke bentuk yang dipakai aplikasi)
async function searchNaa(query) {
  const r = await axios.get(NAA + '/api/search', { params: { q: query }, timeout: 15000, validateStatus: () => true });
  const d = r.data && r.data.data;
  if (!r.data || !r.data.success || !d) return null;
  const songs = (d.results || []).filter((x) => x.type === 'song' && x.id).map((x) => ({
    videoId: x.id,
    title: x.title || '',
    artist: x.artistName || '',
    album: (x.album && x.album.name) || '',
    thumbnail: x.thumbnail || '',
    duration: x.duration || ''
  }));
  return { status: true, creator: 'Naa Music', result: { query: query, songs: songs } };
}

// Link audio langsung dari Naa Music: stream dulu, lalu track sebagai cadangan
async function getNaaCandidate(videoId) {
  const id = encodeURIComponent(videoId);
  const pick = (u) => {
    const m = u ? String(u).match(/[?&]dur=([\d.]+)/) : null;
    return { url: u || null, duration: m ? Math.round(parseFloat(m[1])) : null };
  };
  try {
    const r = await axios.get(NAA + '/api/stream/' + id, { timeout: 15000, validateStatus: () => true });
    const got = pick(r.data && r.data.data && r.data.data.url);
    if (got.url) {
      console.log('[ytmusic]', videoId, 'sumber: naa stream ada link');
      return { urls: [got.url], duration: got.duration };
    }
    console.log('[ytmusic]', videoId, 'naa stream', r.status, String(JSON.stringify(r.data)).slice(0, 200));
  } catch (e) {
    console.log('[ytmusic] naa stream error:', e.message);
  }
  try {
    const r = await axios.get(NAA + '/api/track/' + id, { timeout: 15000, validateStatus: () => true });
    const d = (r.data && r.data.data) || {};
    const got = pick(d.streamUrl);
    console.log('[ytmusic]', videoId, 'naa track', r.status, got.url ? 'ada link' : 'tanpa link', String(JSON.stringify(r.data)).slice(0, 200));
    if (got.url) return { urls: [got.url], duration: got.duration || (d.duration && d.duration.seconds) || null };
  } catch (e) {
    console.log('[ytmusic] naa track error:', e.message);
  }
  return { urls: [], duration: null };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, query, videoId, title, artist } = req.method === 'POST' ? req.body : req.query;

  try {
    if (action === 'home') {
      try {
        const r = await axios.get(NAA + '/api/home', { timeout: 15000, validateStatus: () => true });
        const sections = (r.data && r.data.data && r.data.data.sections) || [];
        const songs = [];
        sections.forEach((sec) => (sec.items || []).forEach((x) => {
          if (x.type === 'song' && x.id) songs.push({ videoId: x.id, title: x.title || '', artist: x.artistName || '', thumbnail: x.thumbnail || '' });
        }));
        return res.status(200).json({ status: true, result: { songs: songs.slice(0, 30) } });
      } catch (e) {
        return res.status(200).json({ status: false, result: { songs: [] } });
      }
    }
    if (action === 'search') {
      try {
        const nr = await searchNaa(query);
        if (nr && nr.result.songs.length) return res.status(200).json(nr);
      } catch (e) {
        console.log('[ytmusic] search naa error:', e.message);
      }
      const r = await axios.get(`${BASE}/api/search?query=${encodeURIComponent(query)}&type=songs`, {
        headers: browserHeaders, timeout: 20000
      });
      return res.status(200).json(r.data);
    }

    if (action === 'play') {
      let { urls, duration } = await getNaaCandidate(videoId);
      if (urls.length) return res.status(200).json({ status: true, result: { duration: fmtDur(duration), download: { audio: urls[0] } } });
      if (!urls.length) {
        const nz = await getNanzCandidates(videoId);
        urls = nz.urls;
        duration = duration || nz.duration;
      }
      if (!urls.length) {
        const m = await getMusicalyCandidate(videoId);
        urls = m.urls;
        duration = duration || m.duration;
      }
      if (!urls.length) {
        return res.status(200).json({ status: false, message: 'Tidak ada sumber audio untuk lagu ini' });
      }
      const checks = await Promise.all(urls.map((u) => isPlayableAudio(u)));
      console.log('[ytmusic]', videoId, 'kandidat:', urls.length, 'hasil cek:', checks.join(','));
      let pick = checks.indexOf('ok');
      if (pick === -1) pick = checks.indexOf('unknown');
      if (pick === -1) {
        return res.status(200).json({
          status: false,
          message: 'Lagu ini belum bisa diputar. Semua sumber mengirim halaman web, bukan file musik.'
        });
      }
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
