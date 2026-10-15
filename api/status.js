/* ============================================================
   STATUS API — Cek kesehatan semua backend service
   ============================================================ */

const axios = require('axios');

const SERVICES = [
  {
    name: 'Omdown.site',
    label: 'Universal Downloader',
    check: async () => {
      const r = await axios.get('https://www.omdown.site', {
        timeout: 10000,
        validateStatus: () => true,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      return r.status >= 200 && r.status < 400;
    }
  },
  {
    name: 'YouTube (cnv.cx)',
    label: 'YouTube Converter',
    check: async () => {
      const r = await axios.get('https://cnv.cx/v2/sanity/key?id=dQw4w9WgXcQ', {
        timeout: 10000,
        validateStatus: () => true,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      return r.status === 200 && r.data && r.data.key;
    }
  },
  {
    name: 'YouTube (oembed)',
    label: 'YouTube Metadata',
    check: async () => {
      const r = await axios.get('https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ&format=json', {
        timeout: 10000,
        validateStatus: () => true
      });
      return r.status === 200;
    }
  },
  {
    name: 'Downr.org',
    label: 'Fallback Downloader',
    check: async () => {
      try {
        const r = await axios.get('https://downr.org', {
          timeout: 8000,
          validateStatus: () => true,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        return r.status >= 200 && r.status < 400;
      } catch { return false; }
    }
  }
];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const results = await Promise.all(
    SERVICES.map(async (svc) => {
      const start = Date.now();
      try {
        const ok = await svc.check();
        const latency = Date.now() - start;
        return {
          name: svc.name,
          label: svc.label,
          status: ok ? 'online' : 'down',
          latency
        };
      } catch (err) {
        return {
          name: svc.name,
          label: svc.label,
          status: 'down',
          latency: Date.now() - start,
          error: err.message
        };
      }
    })
  );

  const onlineCount = results.filter(r => r.status === 'online').length;
  const totalCount = results.length;
  const overall = onlineCount === totalCount ? 'healthy'
                : onlineCount > 0 ? 'degraded'
                : 'critical';

  res.status(200).json({
    status: true,
    overall,
    online: onlineCount,
    total: totalCount,
    checked_at: new Date().toISOString(),
    services: results
  });
};
