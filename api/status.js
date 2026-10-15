/* ============================================================
   STATUS API — By Egaa
   Cek kesehatan service dengan kategori
   ============================================================ */

const axios = require('axios');

const SERVICES = [
  {
    id: 'nexa',
    name: 'Nexa AIO',
    label: 'Universal Downloader',
    category: 'downloader',
    check: async () => {
      const r = await axios.get('https://api.nexadev.my.id/api/aio?url=https://www.instagram.com/reel/DeB_9SaJ1Cs/', {
        timeout: 15000,
        validateStatus: () => true,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      return r.status === 200 && r.data && r.data.status === true;
    }
  },
  {
    id: 'tikwm',
    name: 'TikWM',
    label: 'TikTok Backup',
    category: 'downloader',
    check: async () => {
      const r = await axios.get('https://www.tikwm.com/api/?url=https://vt.tiktok.com/ZSXdPKPMx/', {
        timeout: 15000,
        validateStatus: () => true,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      return r.status === 200 && r.data && r.data.code === 0;
    }
  },
  {
    id: 'youtube-oembed',
    name: 'YouTube',
    label: 'Metadata Service',
    category: 'search',
    check: async () => {
      const r = await axios.get('https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ&format=json', {
        timeout: 10000,
        validateStatus: () => true
      });
      return r.status === 200;
    }
  },
  {
    id: 'cnv',
    name: 'YouTube Converter',
    label: 'Download Service',
    category: 'downloader',
    check: async () => {
      try {
        const r = await axios.get('https://cnv.cx/v2/sanity/key?id=dQw4w9WgXcQ', {
          timeout: 10000,
          validateStatus: () => true,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        return r.status === 200 && r.data && r.data.key;
      } catch { return false; }
    }
  }
];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const results = await Promise.all(SERVICES.map(async (svc) => {
    const start = Date.now();
    try {
      const ok = await svc.check();
      return {
        id: svc.id,
        name: svc.name,
        label: svc.label,
        category: svc.category,
        status: ok ? 'online' : 'down',
        latency: Date.now() - start
      };
    } catch (err) {
      return {
        id: svc.id,
        name: svc.name,
        label: svc.label,
        category: svc.category,
        status: 'down',
        latency: Date.now() - start,
        error: err.message
      };
    }
  }));

  const online = results.filter(r => r.status === 'online').length;
  const total = results.length;
  const overall = online === total ? 'healthy' : online > 0 ? 'degraded' : 'critical';

  // Average latency
  const avgLatency = Math.round(
    results.filter(r => r.status === 'online').reduce((s, r) => s + r.latency, 0) / Math.max(online, 1)
  );

  res.status(200).json({
    status: true,
    overall,
    online,
    total,
    avg_latency: avgLatency,
    checked_at: new Date().toISOString(),
    services: results
  });
};
