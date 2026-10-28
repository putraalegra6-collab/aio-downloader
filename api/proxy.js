const axios = require('axios');
const { resolveSse } = require('../lib/sse');

const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url, fn } = req.query || {};
  if (!url) return res.status(400).json({ status: false, error: 'URL wajib diisi' });

  const filename = fn || 'media';
  const isAudio = /\.(mp3|m4a|opus|aac|wav)$/i.test(filename);
  const contentType = isAudio ? 'audio/mp4' : 'video/mp4';

  if (req.method === 'HEAD') {
    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    return res.status(200).end();
  }

  try {
    // Fallback: kalau masih dapat link SSE, selesaikan dulu
    let target = String(url);
    if (target.includes('sse-progress')) {
      target = await resolveSse(target);
    }

    const range = req.headers.range;
    const response = await axios({
      method: 'GET',
      url: target,
      responseType: 'stream',
      timeout: 60000,
      headers: {
        'User-Agent': UA,
        'Accept': '*/*',
        ...(range ? { 'Range': range } : {})
      },
      maxRedirects: 5,
      validateStatus: () => true
    });

    const upstreamType = response.headers['content-type'] || '';
    console.log('[proxy]', response.status, upstreamType, target.slice(0, 120));

    if (response.status >= 400 || /json|html/i.test(upstreamType)) {
      response.data.destroy();
      return res.status(502).json({
        status: false,
        error: 'Sumber file menolak atau mengirim halaman, bukan media',
        upstream_status: response.status,
        upstream_type: upstreamType
      });
    }

    const finalType = (!upstreamType || /octet-stream|binary/i.test(upstreamType))
      ? contentType
      : upstreamType;

    res.setHeader('Content-Type', finalType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Accept-Ranges', 'bytes');
    if (response.headers['content-length'] && !response.headers['content-encoding']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }
    if (response.headers['content-range']) res.setHeader('Content-Range', response.headers['content-range']);

    res.status(response.status);
    response.data.pipe(res);
  } catch (err) {
    res.status(500).json({ status: false, error: err.message });
  }
};
