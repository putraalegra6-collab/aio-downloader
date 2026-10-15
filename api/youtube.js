/* ============================================================
   YOUTUBE API — By Egaa v2
   Search: Innertube (youtubei)
   Download: Invidious instances (multi-fallback)
   ============================================================ */

const axios = require('axios');

const YT = "https://www.youtube.com";
const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36";
const FALLBACK_CFG = { key: "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8", version: "2.20261002.10.00" };

/* Invidious instances — dicoba berurutan sampai works */
const INVIDIOUS = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://yewtu.be',
  'https://invidious.f5.si',
  'https://iv.melmac.space',
  'https://invidious.privacyredirect.com',
  'https://vid.puffyan.us'
];

const yt = axios.create({
  timeout: 25000,
  headers: { "User-Agent": UA, "Content-Type": "application/json", Origin: YT, Referer: YT + "/" }
});

/* ============================================================
   CONFIG
   ============================================================ */
async function getConfig() {
  try {
    const res = await axios.get(YT + "/?hl=en", {
      timeout: 8000,
      headers: { "User-Agent": UA, Cookie: "CONSENT=YES+1; SOCS=CAI" }
    });
    const html = String(res.data);
    const key = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
    const version = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/);
    return { key: key ? key[1] : FALLBACK_CFG.key, version: version ? version[1] : FALLBACK_CFG.version };
  } catch { return FALLBACK_CFG; }
}

const text = (o) => (o ? o.simpleText || (o.runs ? o.runs.map(r => r.text).join("") : null) : null) || null;

function collect(node, out) {
  if (Array.isArray(node)) { for (const n of node) collect(n, out); return; }
  if (!node || typeof node !== "object") return;
  if (node.videoRenderer) out.push(node.videoRenderer);
  for (const k in node) if (k !== "videoRenderer") collect(node[k], out);
}

function mapVideo(v) {
  const owner = v.ownerText?.runs?.[0];
  const path = owner?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl;
  const snippet = v.detailedMetadataSnippets?.[0] ? text(v.detailedMetadataSnippets[0].snippetText) : null;
  return {
    videoId: v.videoId,
    title: text(v.title),
    url: `https://www.youtube.com/watch?v=${v.videoId}`,
    duration: text(v.lengthText),
    views: text(v.viewCountText),
    published: text(v.publishedTimeText),
    description: snippet || text(v.descriptionSnippet),
    channel: { name: text(v.ownerText), url: path ? YT + path : null },
    thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`
  };
}

/* ============================================================
   SEARCH — Innertube
   ============================================================ */
async function search(query) {
  const cfg = await getConfig();
  const res = await yt.post(`${YT}/youtubei/v1/search?key=${cfg.key}&prettyPrint=false`, {
    context: { client: { clientName: "WEB", clientVersion: cfg.version, hl: "id", gl: "ID" } },
    query, params: "EgIQAQ=="
  }, { headers: { "X-Youtube-Client-Name": "1", "X-Youtube-Client-Version": cfg.version } });

  const found = [];
  collect(res.data, found);
  const seen = new Set();
  const results = [];
  for (const v of found) {
    if (!v.videoId || seen.has(v.videoId)) continue;
    seen.add(v.videoId);
    results.push(mapVideo(v));
  }
  if (!results.length) throw new Error("Hasil tidak ditemukan");
  return { query, total: results.length, results };
}

/* ============================================================
   EXTRACT VIDEO ID
   ============================================================ */
function extractVideoId(input) {
  const s = String(input).trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

/* ============================================================
   GET TITLE via oEmbed
   ============================================================ */
async function getTitle(videoId) {
  try {
    const res = await axios.get(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, { timeout: 8000 });
    return res.data.title;
  } catch { return "Video"; }
}

/* ============================================================
   DOWNLOAD — Invidious multi-instance
   ============================================================ */
async function download(input) {
  const videoId = extractVideoId(input);
  if (!videoId) throw new Error("Video ID tidak valid");

  const errors = [];
  let data = null;
  let usedInstance = null;

  // Coba setiap instance Invidious sampai salah satu works
  for (const inst of INVIDIOUS) {
    try {
      const res = await axios.get(`${inst}/api/v1/videos/${videoId}`, {
        timeout: 20000,
        headers: { 'User-Agent': UA, 'Accept': 'application/json' },
        validateStatus: () => true
      });

      if (res.status !== 200) {
        errors.push(`${inst.replace('https://','')}: HTTP ${res.status}`);
        continue;
      }

      if (!res.data || !res.data.title) {
        errors.push(`${inst.replace('https://','')}: invalid data`);
        continue;
      }

      data = res.data;
      usedInstance = inst;
      break;
    } catch (err) {
      errors.push(`${inst.replace('https://','')}: ${err.message}`);
    }
  }

  if (!data) {
    throw new Error('YouTube download failed: ' + errors.join(' | '));
  }

  const title = data.title || await getTitle(videoId);
  const thumbnail = data.videoThumbnails?.[0]?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  // Kumpulkan format
  const mp4 = [];
  const mp3 = [];

  const fmtStreams = data.formatStreams || [];
  const adaptive = data.adaptiveFormats || [];

  // Format video+audio combined
  fmtStreams.forEach(f => {
    if (!f.url) return;
    const quality = f.qualityLabel || f.resolution || 'Video';
    // Extract resolution height
    const hMatch = quality.match(/(\d+)p/);
    const height = hMatch ? parseInt(hMatch[1]) : 0;
    // Skip kalau terlalu kecil
    if (height && height < 144) return;
    mp4.push({
      quality: quality,
      format: 'mp4',
      url: f.url,
      height: height,
      size: f.size ? `${(f.size / 1024 / 1024).toFixed(1)}MB` : null
    });
  });

  // Format video-only (adaptive)
  adaptive.filter(f => f.type && f.type.startsWith('video')).forEach(f => {
    if (!f.url) return;
    const quality = f.qualityLabel || f.resolution || 'Video';
    const hMatch = quality.match(/(\d+)p/);
    const height = hMatch ? parseInt(hMatch[1]) : 0;
    // Skip kalau duplikat dari fmtStreams
    if (mp4.find(m => m.height === height && m.height > 0)) return;
    mp4.push({
      quality: quality + ' (video only)',
      format: 'mp4',
      url: f.url,
      height: height,
      size: f.clen ? `${(f.clen / 1024 / 1024).toFixed(1)}MB` : null
    });
  });

  // Format audio
  adaptive.filter(f => f.type && f.type.startsWith('audio')).forEach(f => {
    if (!f.url) return;
    // Ambil hanya bitrate tertinggi per encoding
    let bitrate = f.bitrate ? Math.round(f.bitrate / 1000) : 128;
    mp3.push({
      quality: `${bitrate}kbps`,
      format: 'mp3',
      url: f.url,
      bitrate: bitrate,
      size: f.clen ? `${(f.clen / 1024 / 1024).toFixed(1)}MB` : null
    });
  });

  // Sort by quality (descending)
  mp4.sort((a, b) => (b.height || 0) - (a.height || 0));
  mp3.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

  // Dedupe mp3 by bitrate
  const seenMp3 = new Set();
  const mp3Unique = mp3.filter(m => {
    if (seenMp3.has(m.bitrate)) return false;
    seenMp3.add(m.bitrate);
    return true;
  });

  if (!mp4.length && !mp3Unique.length) {
    throw new Error('Tidak ada format unduhan tersedia');
  }

  return {
    videoId,
    title,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    thumbnail,
    author: data.author || null,
    duration: data.lengthSeconds ? `${data.lengthSeconds}s` : null,
    source: `invidious (${usedInstance.replace('https://','')})`,
    mp4: mp4.slice(0, 8),
    mp3: mp3Unique.slice(0, 4)
  };
}

/* ============================================================
   HANDLER
   ============================================================ */
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, query, url } = req.body || {};

  try {
    if (action === 'search') {
      if (!query) return res.status(400).json({ error: 'Query wajib diisi' });
      return res.status(200).json(await search(query));
    }
    if (action === 'download') {
      if (!url) return res.status(400).json({ error: 'URL wajib diisi' });
      return res.status(200).json(await download(url));
    }
    return res.status(400).json({ error: 'Action tidak valid' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
