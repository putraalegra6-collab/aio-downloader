/* ============================================================
   YOUTUBE API — By Egaa v12 (Deep Search Fix)
   Menggunakan RapidAPI (youtube138)
   ============================================================ */

const axios = require('axios');

const RAPIDAPI_KEY = '117f9a6f2cmsh4bce9466c6d8d3ep18aa37jsn1e36d57cbacf';
const RAPIDAPI_HOST = 'youtube138.p.rapidapi.com';

const rapidHeaders = {
  'x-rapidapi-host': RAPIDAPI_HOST,
  'x-rapidapi-key': RAPIDAPI_KEY
};

/* ============================================================
   SEARCH
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
   DOWNLOAD (Deep Search Data)
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

    // --- DEEP SEARCH LOGIC ---
    // Kadang RapidAPI ngasih format di `formats`, `adaptiveFormats`, atau `streamingData.formats`
    let allFormats = [];
    if (data.formats && Array.isArray(data.formats)) allFormats = allFormats.concat(data.formats);
    if (data.adaptiveFormats && Array.isArray(data.adaptiveFormats)) allFormats = allFormats.concat(data.adaptiveFormats);
    if (data.streamingData?.formats) allFormats = allFormats.concat(data.streamingData.formats);
    if (data.streamingData?.adaptiveFormats) allFormats = allFormats.concat(data.streamingData.adaptiveFormats);
    
    // Kalau formatnya kosong, coba cari di properti lain (kadang namanya `links` atau `urls`)
    if (allFormats.length === 0) {
      const stringified = JSON.stringify(data);
      const urlMatches = stringified.match(/"url":"(https:\/\/[^"]+)"/g);
      if (urlMatches) {
        // Extract unique URLs
        const urls = [...new Set(urlMatches.map(m => m.split(':"')[1].slice(0, -1)))];
        urls.forEach(u => {
           if (u.includes('googlevideo.com')) allFormats.push({ url: u, mimeType: 'video/mp4', qualityLabel: 'Unknown' });
        });
      }
    }

    if (allFormats.length === 0) {
      throw new Error("Format video kosong di response API.");
    }

    const mp4 = [];
    const mp3 = [];

    allFormats.forEach(f => {
      // Pastikan ada URL
      if (!f.url && !f.link) return;
      const videoUrl = f.url || f.link;
      
      const mime = f.mimeType || f.mime || '';
      const quality = f.qualityLabel || f.quality || 'Default';
      
      // Deteksi Audio
      if (mime.includes('audio')) {
        mp3.push({
          quality: f.audioQuality || f.bitrate ? `${Math.round((f.bitrate||128000)/1000)}kbps` : 'Audio',
          format: mime.includes('mp4') ? 'm4a' : 'webm',
          url: videoUrl
        });
      } 
      // Deteksi Video
      else if (mime.includes('video') || videoUrl.includes('mime=video')) {
        // Kita cuma mau yang ada audionya (progressive) biar bisa diputar
        // Tapi kalau gak ada info hasAudio, kita masukin aja semua
        const hasAudio = f.hasAudio !== undefined ? f.hasAudio : (mime.includes('avc1') || mime.includes('mp4a'));
        
        mp4.push({
          quality: quality,
          format: 'mp4',
          url: videoUrl,
          has_audio: hasAudio
        });
      }
    });

    // Urutkan MP4 berdasarkan resolusi (angka di qualityLabel)
    mp4.sort((a, b) => {
      const getNum = (str) => parseInt(str.replace(/[^0-9]/g, '')) || 0;
      return getNum(b.quality) - getNum(a.quality);
    });

    if (mp4.length === 0 && mp3.length === 0) {
      throw new Error("Gak nemu format MP4/MP3 di dalam data API.");
    }

    return {
      videoId,
      title: data.title || 'YouTube Video',
      author: data.author?.title || 'YouTube',
      duration: data.lengthSeconds ? `${data.lengthSeconds}s` : null,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      // Buang duplikat berdasarkan resolusi
      mp4: [...new Map(mp4.map(m => [m.quality, m])).values()].slice(0, 6),
      mp4video_only: [],
      mp3: [...new Map(mp3.map(m => [m.quality, m])).values()].slice(0, 3)
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
