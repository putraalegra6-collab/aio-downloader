/* ============================================================
   PROXY API — Stream download dari URL eksternal
   ============================================================ */

const axios = require('axios');

module.exports = async (req, res) => {
  // Bypass CORS biar browser HP gak nge-blokir
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url, fn } = req.query || {};
  if (!url) return res.status(400).json({ error: 'URL wajib diisi' });

  try {
    const filename = fn || 'media';
    const isAudio = /\.(mp3|m4a|opus|aac|wav)$/i.test(filename) || filename.includes('audio');
    const contentType = isAudio ? 'audio/mpeg' : 'video/mp4';

    // Kalau cuma ngecek status (HEAD), langsung balikin OK
    if (req.method === 'HEAD') {
      res.setHeader('Content-Type', contentType);
      return res.status(200).end();
    }

    // Ambil file dari server asli (TikTok, YouTube CDN, dll)
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 60000, // Naikin timeout buat video gede
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        // Trik: Kadang CDN butuh Referer biar gak 403
        'Referer': 'https://www.youtube.com/',
        'Origin': 'https://www.youtube.com'
      },
      maxRedirects: 5,
      validateStatus: () => true
    });

    // Teruskan header dari server asli ke browser
    res.setHeader('Content-Type', response.headers['content-type'] || contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }
    if (response.headers['accept-ranges']) {
      res.setHeader('Accept-Ranges', response.headers['accept-ranges']);
    }

    // Stream langsung ke browser
    res.status(response.status);
    response.data.pipe(res);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
