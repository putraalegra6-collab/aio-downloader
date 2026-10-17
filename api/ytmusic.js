const axios = require('axios');
const BASE = 'https://musicaly.maspaizz.web.id';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, query, videoId, title, artist } = req.method === 'POST' ? req.body : req.query;

  try {
    if (action === 'search') {
      const r = await axios.get(`${BASE}/api/search?query=${encodeURIComponent(query)}&type=songs`);
      return res.status(200).json(r.data);
    }
    if (action === 'play') {
      const r = await axios.post(`${BASE}/api/ytplay`, { query: videoId });
      return res.status(200).json(r.data);
    }
    if (action === 'lyrics') {
      const r = await axios.get(`${BASE}/api/lyrics?id=${videoId}&title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`);
      return res.status(200).json(r.data);
    }
    return res.status(400).json({ status: false, message: 'Action invalid' });
  } catch (err) {
    return res.status(500).json({ status: false, message: err.message });
  }
};
