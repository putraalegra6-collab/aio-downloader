const { resolveSse } = require('../lib/sse');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = req.query?.url;
  if (!url) return res.status(400).json({ status: false, error: 'URL wajib diisi' });

  // Link biasa langsung dikembalikan
  if (!String(url).includes('sse-progress')) {
    return res.status(200).json({ status: true, url });
  }

  try {
    const direct = await resolveSse(String(url));
    return res.status(200).json({ status: true, url: direct });
  } catch (err) {
    return res.status(502).json({ status: false, error: err.message });
  }
};
