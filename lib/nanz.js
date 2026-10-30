/**
 * NanzMusify - sumber audio cadangan (dari modul yang diberikan).
 * CLI dihapus, hanya fungsi yang dipakai server yang dipertahankan.
 */
const crypto = require('crypto');

const BASE_URL = 'https://nanzmusify-updated.netlify.app';
const VIDSSAVE_PARSE_URL = 'https://api.vidssave.com/api/contentsite_api/media/parse';

// Header seperti browser; Vidssave menolak request yang terlihat seperti server (analyze_risk)
const VS_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Origin': 'https://vidssave.com',
  'Referer': 'https://vidssave.com/',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9'
};

let cachedAuth = '4c9b7d21';
let lastAuthScrape = 0;

async function getVidssaveAuth() {
  if (Date.now() - lastAuthScrape < 15 * 60 * 1000 && cachedAuth) {
    return cachedAuth;
  }
  try {
    const res = await fetch('https://vidssave.com/', { headers: VS_HEADERS });
    const html = await res.text();
    const chunks = html.match(/src="([^"]*chunk[^"]*\.js)"/g) || [];
    for (const c of chunks) {
      const src = c.replace(/^src="/, '').replace(/"$/, '');
      const chunkUrl = src.startsWith('http') ? src : `https://vidssave.com${src}`;
      const chunkRes = await fetch(chunkUrl);
      const chunkText = await chunkRes.text();
      const match = chunkText.match(/auth:"([a-zA-Z0-9_-]{6,32})"/);
      if (match) {
        cachedAuth = match[1];
        lastAuthScrape = Date.now();
        return cachedAuth;
      }
    }
  } catch (_) {}
  return cachedAuth || '4c9b7d21';
}

function decryptVidssavePayload(ciphertext, authKey) {
  const keys = [
    '4c9b7d2e'.repeat(3) + (authKey || cachedAuth || '4c9b7d21'),
    '4c9b7d2e'.repeat(3) + '4c9b7d21',
    '4c9b7d2e'.repeat(3) + '4c9b7d2e',
    'rz18efAXUbdiaO7k'
  ];

  for (const k of keys) {
    try {
      const keyBuf = Buffer.from(k, 'utf8');
      const ivBuf = Buffer.from(k.slice(0, 16), 'utf8');
      const decipher = crypto.createDecipheriv(
        k.length === 32 ? 'aes-256-cbc' : 'aes-128-cbc',
        keyBuf,
        ivBuf
      );
      decipher.setAutoPadding(false);
      let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      decrypted = decrypted.replace(/\0+$/, '');
      const parsed = JSON.parse(decrypted);
      if (parsed && (parsed.resources || parsed.title)) {
        return parsed;
      }
    } catch (_) {}
  }
  return null;
}

async function extractAudio(videoId, isRetry = false) {
  const auth = await getVidssaveAuth();
  const link = `https://www.youtube.com/watch?v=${videoId}`;
  const params = new URLSearchParams({
    hostname: 'vidssave.com',
    auth: auth,
    domain: 'api-ak.vidssave.com',
    link: link
  });

  const res = await fetch(VIDSSAVE_PARSE_URL, {
    method: 'POST',
    headers: {
      ...VS_HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  if (!res.ok) {
    throw new Error(`Vidssave HTTP error: ${res.status}`);
  }

  const json = await res.json();
  if (!json || json.status !== 1 || !json.data) {
    if (!isRetry) {
      lastAuthScrape = 0;
      await getVidssaveAuth();
      return extractAudio(videoId, true);
    }
    throw new Error(`Vidssave parse rejected: ${JSON.stringify(json).slice(0, 150)}`);
  }

  const decrypted = decryptVidssavePayload(json.data, auth);
  if (!decrypted) {
    throw new Error('Failed to decrypt audio payload');
  }

  const resources = decrypted.resources || [];
  const audios = resources.filter(r => r.type === 'audio' && r.download_url);
  const preferredQualities = ['256KBPS', '128KBPS', 'LOW', '48KBPS'];
  audios.sort((a, b) => {
    let ia = preferredQualities.indexOf(a.quality);
    let ib = preferredQualities.indexOf(b.quality);
    if (ia === -1) ia = 99;
    if (ib === -1) ib = 99;
    return ia - ib;
  });

  return {
    title: decrypted.title,
    thumbnail: decrypted.thumbnail || `https://i.ytimg.com/vi_webp/${videoId}/sddefault.webp`,
    duration: decrypted.duration,
    streamUrl: audios.length > 0 ? audios[0].download_url : null,
    quality: audios.length > 0 ? audios[0].quality : null,
    downloadLinks: audios.map(a => ({
      quality: a.quality,
      format: a.format,
      size: a.size,
      downloadUrl: a.download_url
    }))
  };
}

const nanzmusify = {
  async search(query, type = 'songs') {
    if (!query) throw new Error('Query parameter is required');
    const res = await fetch(`${BASE_URL}/api/search?query=${encodeURIComponent(query)}&type=${type}`);
    return await res.json();
  },

  async lyrics(id, title = '', artist = '') {
    if (!id) throw new Error('Video ID is required');
    const params = new URLSearchParams({ id });
    if (title) params.append('title', title);
    if (artist) params.append('artist', artist);
    const res = await fetch(`${BASE_URL}/api/lyrics?${params.toString()}`);
    return await res.json();
  }
};

nanzmusify.extractAudio = extractAudio;

module.exports = nanzmusify;
