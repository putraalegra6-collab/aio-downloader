const axios = require('axios');
const nanz = require('../lib/nanz');
const musicfyrik = require('../lib/musicfyrik'); // API baru yang stabil
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

// Cek apakah link beneran audio atau cuma halaman HTML
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

// 1. Musicfyrik (Prioritas Utama - Stabil)
async function getMusicfyrikCandidate(videoId) {
  try {
    const res = await musicfyrik.play(videoId);
    const url = res.downloadUrl || res.proxyStreamUrl;
    console.log('[ytmusic]', videoId, 'sumber: musicfyrik', url ? 'ada link' : 'tanpa link');
    return { urls: url ? [url] : [], duration: res.duration || null };
  } catch (e) {
    console.log('[ytmusic] musicfyrik error:', e.message);
    return { urls: [], duration: null };
  }
}

// 2. Naa Music
async function getNaaCandidate(videoId) {
  const NAA = 'https://naa-music.vercel.app';
  const id = encodeURIComponent(videoId);
  const pick = (u) => {
    const m = u ? String(u).match(/[?&]dur=([\d.]+)/) : null;
    return { url: u || null, duration: m ? Math.round(parseFloat(m[1])) : null };
  };
  try {
    const r = await axios.get(NAA + '/api/stream/' + id, { timeout: 15000, validateStatus: () => true });
    const got = pick(r.data && r.data.data && r.data.data.url);
    if (got.url) return { urls: [got.url], duration: got.duration };
  } catch (e) {
    console.log('[ytmusic] naa stream error:', e.message);
  }
  try {
    const r = await axios.get(NAA + '/api/track/' + id, { timeout: 15000, validateStatus: () => true });
    const d = (r.data && r.data.data) || {};
    const got = pick(d.streamUrl);
    if (got.url) return { urls: [got.url], duration: got.duration || (d.duration && d.duration.seconds) || null };
  } catch (e) {
    console.log('[ytmusic] naa track error:', e.message);
  }
  return { urls: [], duration: null };
}

// 3. Jerexd AIO (API Downloader punya lo)
async function getJerexdCandidate(videoId) {
  try {
    const r = await axios.get('https://api.jerexd.my.id/api/downloader/aiov2', {
      params: { apikey: JEREXD_KEY, url: 'https://www.youtube.com/watch?v=' + videoId },
      timeout: 12000,
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      validateStatus: () => true
    });
    const j = r.data;
    if (!j || j.status !== true || !j.result) return { urls: [], duration: null };
    const urls = (j.result.medias || [])
      .filter((m) => (m.type === 'audio' || /^(mp3|m4a|opus|aac|wav)$/i.test(m.extension || '')) && m.url)
      .map((m) => m.url);
    console.log('[ytmusic]', videoId, 'sumber: jerexd', urls.length ? 'ada link' : 'tanpa link');
    return { urls, duration: j.result.duration || null };
  } catch (e) {
    console.log('[ytmusic] jerexd error:', e.message);
    return { urls: [], duration: null };
  }
}

// 4. Nanz
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

// 5. Musicaly
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
    if (action === 'home') {
      try {
        const r = await axios.get('https://naa-music.vercel.app/api/home', { timeout: 15000, validateStatus: () => true });
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
        const r = await axios.get('https://naa-music.vercel.app/api/search', { params: { q: query }, timeout: 15000, validateStatus: () => true });
        const d = r.data && r.data.data;
        if (d && d.results) {
          const songs = d.results.filter((x) => x.type === 'song' && x.id).map((x) => ({
            videoId: x.id,
            title: x.title || '',
            artist: x.artistName || '',
            album: (x.album && x.album.name) || '',
            thumbnail: x.thumbnail || '',
            duration: x.duration || ''
          }));
          if(songs.length) return res.status(200).json({ status: true, creator: 'Naa Music', result: { query: query, songs } });
        }
      } catch (e) {
        console.log('[ytmusic] search naa error:', e.message);
      }
      const r = await axios.get(`${BASE}/api/search?query=${encodeURIComponent(query)}&type=songs`, {
        headers: browserHeaders, timeout: 20000
      });
      return res.status(200).json(r.data);
    }

    if (action === 'play') {
      let urls = [], duration = null;

      // ALUR PENCARIAN AUDIO (FALLBACK BERANTAI)
      
      // 1. Coba Musicfyrik
      let res = await getMusicfyrikCandidate(videoId);
      urls = res.urls; duration = res.duration;

      // 2. Kalau gagal, coba Naa
      if (!urls.length) {
        res = await getNaaCandidate(videoId);
        urls = res.urls; duration = duration || res.duration;
      }
      
      // 3. Kalau gagal, coba Jerexd (API punya lo)
      if (!urls.length) {
        res = await getJerexdCandidate(videoId);
        urls = res.urls; duration = duration || res.duration;
      }

      // 4. Kalau gagal, coba Nanz
      if (!urls.length) {
        res = await getNanzCandidates(videoId);
        urls = res.urls; duration = duration || res.duration;
      }
      
      // 5. Kalau gagal, coba Musicaly
      if (!urls.length) {
        res = await getMusicalyCandidate(videoId);
        urls = res.urls; duration = duration || res.duration;
      }

      if (!urls.length) {
        return res.status(200).json({ status: false, message: 'Tidak ada sumber audio untuk lagu ini' });
      }

      // Validasi link (pastikan bukan HTML)
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
      try {
        const l = await musicfyrik.lyrics(videoId, artist);
        if (l && l.lines && l.lines.length > 0) {
          return res.status(200).json({ status: true, result: { lyrics: l } });
        }
      } catch (e) {
        console.log('[ytmusic] musicfyrik lyrics error:', e.message);
      }

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
