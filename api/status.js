/* ============================================================
   STATUS API — By Egaa
   Cek: Jerexd, Tikwm, IZZ Music, Downr
   ============================================================ */

const axios = require('axios');

const SERVICES = [
  {
    id: 'jerexd',
    name: 'Jerexd AIO',
    label: 'Universal Downloader',
    check: async () => {
      const r = await axios.get('https://api.jerexd.my.id/api/downloader/aiov2?apikey=s2tQZgBEIaX4t3K7&url=', {
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
    id: 'izz',
    name: 'IZZ Music',
    label: 'Music & Lyrics',
    check: async () => {
      const r = await axios.get('https://musicaly.maspaizz.web.id/api/search?query=test', {
        timeout: 15000,
        validateStatus: () => true,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      return r.status === 200 && r.data && r.data.status === true;
    }
  },
  {
    id: 'downr',
    name: 'Downr.org',
    label: 'Backup Downloader',
    check: async () => {
      try {
        const r = await axios.get('https://downr.org', {
          timeout: 10000,
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
        status: ok ? 'online' : 'down',
        latency: Date.now() - start
      };
    } catch (err) {
      return {
        id: svc.id,
        name: svc.name,
        label: svc.label,
        status: 'down',
        latency: Date.now() - start,
        error: err.message
      };
    }
  }));

  const online = results.filter(r => r.status === 'online').length;
  const total = results.length;
  const overall = online === total ? 'healthy' : online > 0 ? 'degraded' : 'critical';
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
