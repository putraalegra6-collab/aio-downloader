const axios = require('axios');

const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36';

function findFileUrl(obj, depth = 0) {
  if (!obj || depth > 6) return '';
  if (typeof obj === 'string') {
    return /^https?:\/\//.test(obj) && !obj.includes('sse-progress') ? obj : '';
  }
  if (Array.isArray(obj)) {
    for (const x of obj) { const u = findFileUrl(x, depth + 1); if (u) return u; }
    return '';
  }
  if (typeof obj === 'object') {
    for (const k of Object.keys(obj)) { const u = findFileUrl(obj[k], depth + 1); if (u) return u; }
  }
  return '';
}

function resolveSse(url, maxMs = 50000) {
  return new Promise((resolve, reject) => {
    axios.get(url, {
      responseType: 'stream',
      timeout: maxMs,
      headers: { 'User-Agent': UA, 'Accept': 'text/event-stream' },
      validateStatus: () => true
    }).then((r) => {
      const stream = r.data;
      let buf = '';
      let done = false;

      const finish = (err, val) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        stream.destroy();
        if (err) reject(err); else resolve(val);
      };

      const timer = setTimeout(() => finish(new Error('Timeout menunggu link file dari server')), maxMs);

      stream.on('data', (chunk) => {
        buf += chunk.toString('utf8').replace(/\r\n/g, '\n');
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
            if (found) return finish(null, found);
          } catch (e) { /* bukan JSON, lewati */ }
        }
      });
      stream.on('end', () => finish(new Error('Progres selesai tanpa link file')));
      stream.on('error', (e) => finish(e));
    }).catch(reject);
  });
}

module.exports = { resolveSse, findFileUrl };
