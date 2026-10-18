const axios = require('axios');

const JEREXD_BASE = 'https://api.jerexd.my.id/api/downloader/aio';
const API_KEY = 's2tQZgBEIaX4t3K7';
const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ status: false, error: 'Method not allowed' });

  const { input } = req.body || {};
  if (!input || !String(input).trim()) {
    return res.status(400).json({ status: false, error: 'Input wajib diisi' });
  }

  const value = String(input).trim();

  try {
    // Tembak ke API Jerexd
    const apiUrl = `${JEREXD_BASE}?apikey=${API_KEY}&url=${encodeURIComponent(value)}`;
    
    const response = await axios.get(apiUrl, {
      timeout: 30000,
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json'
      },
      validateStatus: () => true
    });

    const json = response.data;

    if (!json || json.status !== true) {
      throw new Error(json?.message || json?.error || 'Gagal memproses link dari server Jerexd');
    }

    // Normalisasi data ke format yang dipake frontend kita
    const downloads = json.downloads || [];
    
    const medias = downloads.map((item, i) => {
      const type = (item.type || '').toLowerCase();
      const isAudio = type.includes('audio') || type.includes('mp3');
      
      return {
        type: isAudio ? 'audio' : 'video',
        quality: item.quality || item.type || 'Default',
        extension: isAudio ? 'mp3' : 'mp4',
        is_audio: isAudio,
        url: item.url
      };
    });

    if (!medias.length) throw new Error('Tidak ada link unduhan yang ditemukan');

    res.status(200).json({
      status: true,
      source: 'jerexd',
      title: json.title || 'Media',
      author: json.owner || json.author || null,
      thumbnail: json.thumbnail || null,
      url: value,
      medias: medias
    });

  } catch (err) {
    res.status(500).json({
      status: false,
      error: err.message || 'Gagal memproses media',
      detail: err.message
    });
  }
};
