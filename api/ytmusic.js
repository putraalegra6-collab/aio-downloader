const axios = require('axios');
const nanz = require('../lib/nanz');
const musicfyrik = require('../lib/musicfyrik');
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

// Validasi apakah link beneran file audio
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

// 1. Musicfyrik (Paling Stabil)
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

// 2. Jerexd AIO (API Punya Lo)
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

// 3. Nanz
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

// 4. Musicaly
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
    // ==========================================
    // 1. ACTION HOME (Lagu Populer)
    // ==========================================
    if (action === 'home') {
      try {
        // Pakai Musicfyrik untuk cari lagu populer default
        const sr = await musicfyrik.search('Top Hits Indonesia');
        return res.status(200).json({ status: true, result: { songs: sr.songs.slice(0, 30) } });
      } catch (e) {
        // Fallback kalau Musicfyrik error, pakai Musicaly
        try {
          const r = await axios.get(`${BASE}/api/search?query=top+indonesia&type=songs`, { headers: browserHeaders, timeout: 15000 });
          return res.status(200).json(r.data);
        } catch (err) {
          return res.status(200).json({ status: false, result: { songs: [] } });
        }
      }
    }
    
    // ==========================================
    // 2. ACTION SEARCH (Pencarian Lagu)
    // ==========================================
    if (action === 'search') {
      try {
        // Utamakan Musicfyrik
        const sr = await musicfyrik.search(query);
        if (sr && sr.songs && sr.songs.length > 0) {
          return res.status(200).json({ status: true, result: { query: query, songs: sr.songs } });
        }
      } catch (e) {
        console.log('[ytmusic] Search musicfyrik error:', e.message);
      }

      // Fallback ke Musicaly kalau Musicfyrik error
      try {
        const r = await axios.get(`${BASE}/api/search?query=${encodeURIComponent(query)}&type=songs`, {
          headers: browserHeaders, timeout: 20000
        });
        // Pastikan yang dibalikin beneran JSON
        if (r.data && r.data.result) {
          return res.status(200).json(r.data);
        }
      } catch (e) {
        console.log('[ytmusic] Search musicaly error:', e.message);
      }

      return res.status(200).json({ status: false, message: 'Gagal mencari lagu' });
    }

    // ==========================================
    // 3. ACTION PLAY (Putar Lagu)
    // ==========================================
    if (action === 'play') {
      let urls = [], duration = null;

      // 1. Musicfyrik
      let res = await getMusicfyrikCandidate(videoId);
      urls = res.urls; duration = res.duration;

      // 2. Jerexd (API lo)
      if (!urls.length) {
        res = await getJerexdCandidate(videoId);
        urls = res.urls; duration = duration || res.duration;
      }

      // 3. Nanz
      if (!urls.length) {
        res = await getNanzCandidates(videoId);
        urls = res.urls; duration = duration || res.duration;
      }
      
      // 4. Musicaly
      if (!urls.length) {
        res = await getMusicalyCandidate(videoId);
        urls = res.urls; duration = duration || res.duration;
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

    // ==========================================
    // 4. ACTION LYRICS (Lirik Lagu)
    // ==========================================
    if (action === 'lyrics') {
      try {
        const l = await musicfyrik.lyrics(videoId, artist);
        if (l && l.lines && l.lines.length > 0) {
          return res.status(200).json({ status: true, result: { lyrics: l } });
        }
      } catch (e) {
        console.log('[ytmusic] musicfyrik lyrics error:', e.message);
      }

      try {
        const r = await axios.get(`${BASE}/api/lyrics?id=${videoId}&title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`, {
          headers: browserHeaders, timeout: 20000
        });
        if (r.data) return res.status(200).json(r.data);
      } catch (e) {
        console.log('[ytmusic] lyrics fallback error:', e.message);
      }
      
      return res.status(200).json({ status: false, message: 'Lirik tidak ditemukan' });
    }

    return res.status(400).json({ status: false, message: 'Action invalid' });
  } catch (err) {
    return res.status(500).json({ status: false, message: err.message });
  }
};
