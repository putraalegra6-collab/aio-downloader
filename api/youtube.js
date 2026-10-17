/* ============================================================
   YOUTUBE API — By Egaa v10
   Search: Vamx API
   Download: Nexa AIO API (Universal, sama kayak IG)
   ============================================================ */

const axios = require('axios');

const VAMX_KEY = 'vamx_live_1bb188197b9ec7df7c75165aee481b59';
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/* ============================================================
   SEARCH - VAMX
   ============================================================ */
async function search(query) {
  try {
    const api = `https://vamxapi.my.id/api/v1/search/youtube?q=${encodeURIComponent(query)}&limit=15&type=video&order=relevance`;
    const res = await axios.get(api, {
      timeout: 15000,
      headers: { 'x-api-key': VAMX_KEY, 'User-Agent': UA }
    });
    
    if (res.data?.status === false) throw new Error("Vamx limit");
    
    let results = res.data?.data || res.data?.result || res.data || [];
    if (!Array.isArray(results) || results.length === 0) throw new Error("Vamx kosong");

    const normalized = results.map(v => {
      const vid = v.videoId || v.id || (v.url ? v.url.split('v=')[1] : null);
      return {
        videoId: vid,
        title: v.title || 'Tanpa Judul',
        url: v.url || `https://www.youtube.com/watch?v=${vid}`,
        duration: v.duration || v.timestamp || null,
        views: v.views || v.viewCount || null,
        channel: { name: v.channel || v.author?.name || 'Unknown' },
        thumbnail: vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : (v.thumbnail || '')
      };
    }).filter(v => v.videoId);

    return { query, total: normalized.length, results: normalized };
  } catch (err) {
    throw new Error("Pencarian gagal: " + err.message);
  }
}

/* ============================================================
   DOWNLOAD - NEXA AIO (Sama kayak Instagram)
   ============================================================ */
async function download(url) {
  try {
    // Kita tembak API Nexa pakai URL YouTube
    const api = `https://api.nexadev.my.id/api/aio?url=${encodeURIComponent(url)}`;
    
    const res = await axios.get(api, {
      timeout: 30000,
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json, text/plain, */*'
      },
      validateStatus: () => true
    });

    if (res.status !== 200) throw new Error(`Nexa HTTP ${res.status}`);
    
    const json = res.data;
    if (!json || json.status !== true || !Array.isArray(json.data)) {
      throw new Error(json?.message || 'Nexa gagal memproses YouTube');
    }

    const raw = json.data.filter(item => item && item.url);
    if (!raw.length) throw new Error('Nexa tidak mengembalikan link video');

    const mp4 = [];
    const mp3 = [];

    // Milah-milah format dari Nexa
    raw.forEach((item, i) => {
      const type = (item.type || 'mp4').toLowerCase();
      const isAudio = ['mp3', 'm4a', 'audio'].includes(type);
      
      if (isAudio) {
        mp3.push({
          quality: item.quality || `Audio ${i + 1}`,
          format: 'mp3',
          url: item.url
        });
      } else {
        // Anggap video mp4
        mp4.push({
          quality: item.quality || (i === 0 ? 'HD (Original)' : `Video ${i + 1}`),
          format: 'mp4',
          url: item.url,
          has_audio: true // Nexa biasanya ngasih video yang udah ada audionya
        });
      }
    });

    // Ambil judul dari parameter URL (karena Nexa gak selalu ngasih judul)
    let title = "YouTube Video";
    try {
      const oembed = await axios.get(`https://www.youtube.com/oembed?url=${url}&format=json`);
      if (oembed.data && oembed.data.title) title = oembed.data.title;
    } catch {}

    const vidMatch = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/);
    const videoId = vidMatch ? vidMatch[1] : '';

    return {
      videoId: videoId,
      title: title,
      author: null,
      duration: null,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      url: url,
      mp4: mp4,
      mp4video_only: [],
      mp3: mp3
    };

  } catch (err) {
    throw new Error(`Gagal download: ${err.message}`);
  }
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
    if (action === 'search') return res.status(200).json(await search(query));
    if (action === 'download') return res.status(200).json(await download(url));
    return res.status(400).json({ error: 'Action invalid' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
