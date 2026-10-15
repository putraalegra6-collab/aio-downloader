/* ============================================================
   PROXY API — Stream download dari URL eksternal
   ============================================================ */

const axios = require('axios');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url, fn } = req.query || {};
  if (!url) return res.status(400).json({ error: 'URL wajib diisi' });

  try {
    const filename = fn || 'media';
    const isAudio = /\.(mp3|m4a|opus|aac|wav)$/i.test(filename);
    const contentType = isAudio ? 'audio/mpeg' : 'video/mp4';

    if (req.method === 'HEAD') {
      res.setHeader('Content-Type', contentType);
      return res.status(200).end();
    }

    const response = await axios({
      method: 'GET',
      url,
      responseType: 'stream',
      timeout: 60000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      maxRedirects: 5,
      validateStatus: () => true
    });

    res.setHeader('Content-Type', response.headers['content-type'] || contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }
    if (response.headers['accept-ranges']) {
      res.setHeader('Accept-Ranges', response.headers['accept-ranges']);
    }

    res.status(response.status);
    response.data.pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
