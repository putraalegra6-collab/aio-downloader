/* ============================================================
   YOUTUBE API — By Egaa v11
   Menggunakan RapidAPI (youtube138) untuk Search & Download
   ============================================================ */

const axios = require('axios');

const RAPIDAPI_KEY = '117f9a6f2cmsh4bce9466c6d8d3ep18aa37jsn1e36d57cbacf';
const RAPIDAPI_HOST = 'youtube138.p.rapidapi.com';

const rapidHeaders = {
  'x-rapidapi-host': RAPIDAPI_HOST,
  'x-rapidapi-key': RAPIDAPI_KEY
};

/* ============================================================
   SEARCH (Menggunakan Endpoint Search RapidAPI)
   ============================================================ */
async function search(query) {
  try {
    const options = {
      method: 'GET',
      url: `https://${RAPIDAPI_HOST}/search/`,
      params: { q: query, hl: 'id', gl: 'ID' },
      headers: rapidHeaders
    };

    const res = await axios.request(options);
    const data = res.data;

    if (!data || !data.contents) throw new Error("Hasil tidak ditemukan");

    // Filter hanya video yang muncul
    const videos = [];
    data.contents.forEach(item => {
      if (item.video) {
        videos.push({
          videoId: item.video.videoId,
          title: item.video.title || 'Tanpa Judul',
          url: `https://www.youtube.com/watch?v=${item.video.videoId}`,
          duration: item.video.lengthText || null,
          views: item.video.viewCountText || null,
          channel: { name: item.video.channel?.name || 'Unknown' },
          thumbnail: item.video.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${item.video.videoId}/hqdefault.jpg`
        });
      }
    });

    if (videos.length === 0) throw new Error("Tidak ada video yang ditemukan");

    return { query, total: videos.length, results: videos };
  } catch (err) {
    throw new Error(`Pencarian gagal: ${err.message}`);
  }
}

/* ============================================================
   DOWNLOAD (Menggunakan Endpoint Video Details RapidAPI)
   ============================================================ */
async function download(url) {
  const vidMatch = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/);
  if (!vidMatch) throw new Error("URL YouTube tidak valid");
  const videoId = vidMatch[1];

  try {
    const options = {
      method: 'GET',
      url: `https://${RAPIDAPI_HOST}/video/details/`,
      params: { id: videoId, hl: 'id', gl: 'ID' },
      headers: rapidHeaders
    };

    const res = await axios.request(options);
    const data = res.data;

    if (!data || !data.formats) throw new Error("Gagal mengambil link video");

    const mp4 = [];
    const mp3 = [];

    // Ambil format MP4 (Video)
    data.formats.forEach(f => {
      // Hanya ambil format mp4 dengan audio (biasanya mimeType video/mp4; codecs="avc1...")
      if (f.mimeType.includes('video/mp4') && f.hasAudio) {
        mp4.push({
          quality: f.qualityLabel || 'Video',
          format: 'mp4',
          url: f.url,
          has_audio: true
        });
      }
      
      // Ambil format Audio (MP4 Audio / WebM Audio) buat di-convert jadi MP3 (tapi linknya tetep m4a/webm)
      if (f.mimeType.includes('audio') && !f.hasVideo) {
        mp3.push({
          quality: `${f.qualityLabel || '128kbps'}`,
          format: 'm4a', // m4a lebih universal untuk audio-only dari YouTube
          url: f.url
        });
      }
    });

    // Urutkan dari kualitas tertinggi ke terendah
    mp4.sort((a, b) => parseInt(b.quality) - parseInt(a.quality));

    if (mp4.length === 0 && mp3.length === 0) {
      throw new Error("Tidak ada format yang tersedia untuk diunduh");
    }

    return {
      videoId,
      title: data.title || 'YouTube Video',
      author: data.author?.title || 'YouTube',
      duration: data.lengthSeconds ? `${data.lengthSeconds}s` : null,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      mp4: mp4.slice(0, 5), // Ambil 5 kualitas terbaik
      mp4video_only: [],
      mp3: mp3.slice(0, 3)
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
    if (action === 'search') {
      if (!query) return res.status(400).json({ error: 'Query wajib diisi' });
      return res.status(200).json(await search(query));
    }
    if (action === 'download') {
      if (!url) return res.status(400).json({ error: 'URL wajib diisi' });
      return res.status(200).json(await download(url));
    }
    return res.status(400).json({ error: 'Action invalid' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
