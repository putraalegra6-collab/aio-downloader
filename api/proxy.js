const axios = require('axios');

const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36';

// Cari URL file (http...) di dalam objek JSON apa pun
function findFileUrl(obj, depth = 0) {
  if (!obj || depth > 6) return '';
  if (typeof obj === 'string') return /^https?:\/\//.test(obj) && !obj.includes('sse-progress') ? obj : '';
  if (Array.isArray(obj)) {
    for (const x of obj) { const u = findFileUrl(x, depth + 1); if (u) return u; }
    return '';
  }
  if (typeof obj === 'object') {
    for (const k of Object.keys(obj)) { const u = findFileUrl(obj[k], depth + 1); if (u) return u; }
  }
  return '';
}

// Baca stream SSE sampai ada event yang berisi link file asli
function resolveSse(url, maxMs = 90000) {
  return new Promise(async (resolve, reject) => {
    let r;
    try {
      r = await axios.get(url, {
        responseType: 'stream',
        timeout: maxMs,
        headers: { 'User-Agent': UA, 'Accept': 'text/event-stream' },
        validateStatus: () => true
      });
    } catch (e) { return reject(e); }

    const timer = setTimeout(() => { r.data.destroy(); reject(new Error('Timeout menunggu link file')); }, maxMs);
    let buf = '';

    r.data.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const payload = block.split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('\n');
        if (!payload) continue;
        try {
          const found = findFileUrl(JSON.parse(payload));
          if (found) {
            clearTimeout(timer);
            r.data.destroy();
            return resolve(found);
          }
        } catch (e) { /* event bukan JSON, lewati */ }
      }
    });

    r.data.on('end', () => { clearTimeout(timer); reject(new Error('Progres selesai tanpa link file')); });
    r.data.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url, fn } = req.query || {};
  if (!url) return res.status(400).json({ error: 'URL wajib diisi' });

  const filename = fn || 'media';
  const isAudio = /\.(mp3|m4a|opus|aac|wav)$/i.test(filename);
  const contentType = isAudio ? 'audio/mp4' : 'video/mp4';

  if (req.method === 'HEAD') {
    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    return res.status(200).end();
  }

  try {
    // Kalau link berupa progres SSE, tunggu sampai ada link file asli
    let target = url;
    if (url.includes('sse-progress')) {
      target = await resolveSse(url);
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

    res.setHeader('Content-Type', response.headers['content-type'] || contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Accept-Ranges', 'bytes');
    if (response.headers['content-length']) res.setHeader('Content-Length', response.headers['content-length']);
    if (response.headers['content-range']) res.setHeader('Content-Range', response.headers['content-range']);

    res.status(response.status);
    response.data.pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
