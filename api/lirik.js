const axios = require('axios');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { title, artist } = req.query;
  if (!title) return res.status(400).json({ error: 'Judul wajib diisi' });

  try {
    const qTitle = encodeURIComponent(title);
    const qArtist = encodeURIComponent(artist || '');
    
    // Pake API Lyrist (Gratis, gak pake ribet)
    const r = await axios.get(`https://api.lyrist.dev/lyrics?title=${qTitle}&artist=${qArtist}`, { timeout: 10000 });
    
    if (r.data && r.data.lyrics) {
      return res.status(200).json({ status: true, lyrics: r.data.lyrics });
    } else {
      // Fallback kalau gak nemu
      return res.status(200).json({ status: true, lyrics: "Lirik tidak ditemukan di database." });
    }
  } catch (err) {
    return res.status(500).json({ status: false, error: err.message });
  }
};
