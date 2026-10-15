/* ============================================================
   DOWNLOAD API — By Egaa
   Primary: Omdown.site (26+ platforms)
   ============================================================ */

const axios = require('axios');

const OMDOWN_BASE = 'https://www.omdown.site';
const OMDOWN_ACTION = '70fe8fea45b688241b80ac22216712ce589fb80dc7';

const OMDOWN_PLATFORMS = [
  { name: 'tiktok',    pattern: /(?:tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com)/i },
  { name: 'pinedrama', pattern: /(?:shortdrama\.tiktok\.com|pinedrama)/i },
  { name: 'youtube',   pattern: /(?:youtube\.com|youtu\.be)/i },
  { name: 'instagram', pattern: /(?:instagram\.com|instagr\.am)/i },
  { name: 'x',         pattern: /(?:x\.com|twitter\.com)/i },
  { name: 'facebook',  pattern: /(?:facebook\.com|fb\.watch|fb\.com)/i },
  { name: 'spotify',   pattern: /(?:spotify\.com)/i },
  { name: 'soundcloud',pattern: /(?:soundcloud\.com)/i },
  { name: 'pinterest', pattern: /(?:pinterest\.com|pin\.it)/i },
  { name: 'reddit',    pattern: /(?:reddit\.com|redd\.it)/i },
  { name: 'capcut',    pattern: /(?:capcut\.com)/i },
  { name: 'threads',   pattern: /(?:threads\.net)/i },
  { name: 'snapchat',  pattern: /(?:snapchat\.com)/i },
  { name: 'twitch',    pattern: /(?:twitch\.tv)/i },
  { name: 'deviantart',pattern: /(?:deviantart\.com)/i },
  { name: 'pixiv',     pattern: /(?:pixiv\.net)/i },
  { name: 'mangadex',  pattern: /(?:mangadex\.org)/i }
];

function detectPlatform(url) {
  if (!url || typeof url !== 'string') return 'general';
  for (const p of OMDOWN_PLATFORMS) if (p.pattern.test(url)) return p.name;
  return 'general';
}

async function omdownDownload(mediaUrl, locale = 'id') {
  const trimmed = String(mediaUrl).trim();
  const platform = detectPlatform(trimmed);
  const payload = JSON.stringify([trimmed, platform, locale]);

  const res = await axios.post(`${OMDOWN_BASE}/${locale}`, payload, {
    headers: {
      'Next-Action': OMDOWN_ACTION,
      'Content-Type': 'text/plain;charset=UTF-8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Referer': `${OMDOWN_BASE}/${locale}`,
      'Origin': OMDOWN_BASE,
      'Accept': 'text/x-component'
    },
    timeout: 55000,
    maxContentLength: 50 * 1024 * 1024,
    maxBodyLength: 50 * 1024 * 1024,
    validateStatus: () => true
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`omdown HTTP ${res.status}`);
  }

  const rawText = res.data;
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('omdown: no response data');
  }

  const chunkMap = {};
  const chunkRegex = /([0-9a-f]+):T([0-9a-f]+),/g;
  let cm;
  while ((cm = chunkRegex.exec(rawText)) !== null) {
    const id = cm[1];
    const len = parseInt(cm[2], 16);
    const start = cm.index + cm[0].length;
    chunkMap['$' + id] = rawText.slice(start, start + len);
  }

  const idx = rawText.indexOf('{"success":');
  if (idx === -1) throw new Error('omdown: konten tidak ditemukan / platform belum didukung');

  let depth = 0, endIdx = -1;
  const jsonStr = rawText.slice(idx);
  for (let i = 0; i < jsonStr.length; i++) {
    if (jsonStr[i] === '{') depth++;
    else if (jsonStr[i] === '}') { depth--; if (depth === 0) { endIdx = i + 1; break; } }
  }
  if (endIdx === -1) throw new Error('omdown: gagal parse JSON');

  const parsed = JSON.parse(jsonStr.slice(0, endIdx));
  if (!parsed.success || !parsed.data) {
    throw new Error(parsed.error || 'omdown: gagal ekstrak media');
  }

  const data = parsed.data;

  const fixUrl = (u) => {
    if (!u || typeof u !== 'string') return null;
    let target = u;
    if (chunkMap[target]) target = chunkMap[target];
    if (target.startsWith('/')) return `${OMDOWN_BASE}${target}`;
    return target;
  };

  const formats = (data.formats || []).map(f => {
    let dlUrl = f.downloadUrl;
    if (dlUrl && chunkMap[dlUrl]) dlUrl = chunkMap[dlUrl];
    return {
      id: f.id,
      label: f.label,
      description: f.description,
      kind: f.kind,
      quality: f.quality || f.label || 'Default',
      ext: f.ext || 'mp4',
      is_audio: f.kind === 'audio',
      downloadUrl: fixUrl(dlUrl)
    };
  }).filter(f => f.downloadUrl);

  if (!formats.length) throw new Error('omdown: no downloadable format');

  return {
    ok: true,
    mode: 'download',
    api: 'omdown',
    source: (data.platform || platform).toLowerCase(),
    title: data.title || 'Untitled',
    author: data.author || null,
    duration: data.durationLabel || null,
    thumbnail: fixUrl(data.thumbnailUrl),
    url: trimmed,
    medias: formats.map(f => ({
      type: f.kind || 'video',
      quality: f.quality,
      extension: f.ext,
      is_audio: f.is_audio,
      url: f.downloadUrl
    }))
  };
}

function isUrl(input) {
  const s = String(input).trim();
  if (/^https?:\/\//i.test(s)) return true;
  return /(?:tiktok|instagram|youtube|youtu\.be|facebook|fb\.watch|twitter|x\.com|spotify|pinterest|soundcloud|reddit|threads|twitch|capcut)\.(?:com|be|space|org|net|co|tv)/i.test(s);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ status: false, error: 'Method not allowed' });
  }

  const { input } = req.body || {};
  if (!input || !String(input).trim()) {
    return res.status(400).json({ status: false, error: 'Input wajib diisi' });
  }

  const value = String(input).trim();
  if (!isUrl(value)) {
    return res.status(400).json({
      status: false,
      error: 'Masukkan link media yang valid (TikTok, Instagram, YouTube, dll)'
    });
  }

  try {
    const result = await omdownDownload(value);
    return res.status(200).json({ status: true, ...result });
  } catch (err) {
    return res.status(500).json({
      status: false,
      error: err.message || 'Gagal memproses media',
      detail: err.message
    });
  }
};
