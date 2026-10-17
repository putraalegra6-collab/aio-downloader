const axios = require('axios');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { videoId, title, artist } = req.query;
  
  if (!videoId && !title) return res.status(400).json({ error: 'ID atau Judul wajib diisi' });

  try {
    // Tembak langsung ke API IZZ (Musicaly)
    const baseUrl = 'https://musicaly.maspaizz.web.id/api/lyrics';
    
    // Bangun parameter persis kayak di config.js mereka
    const params = new URLSearchParams();
    if (videoId) params.append('id', videoId);
    if (title) params.append('title', title);
    if (artist) params.append('artist', artist);

    const r = await axios.get(`${baseUrl}?${params.toString()}`, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36'
      }
    });

    // Balikin data mentahnya ke frontend
    return res.status(200).json(r.data);

  } catch (err) {
    return res.status(500).json({ 
      status: false, 
      error: 'Gagal mengambil lirik dari server IZZ',
      detail: err.message 
    });
  }
};
