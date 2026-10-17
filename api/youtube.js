const axios = require('axios');
const ytdl = require('@distube/ytdl-core');

const YT = "https://www.youtube.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// === COOKIE UNTUK NGIBUL YOUTUBE ===
// (Ini opsional, tapi bikin lebih stabil. Lu bisa ambil cookie 'VISITOR_INFO1_LIVE' dari browser lu)
const COOKIE = "CONSENT=YES+cb.20210328-17-p0.en+FX+123"; 

const yt = axios.create({
  timeout: 25000,
  headers: { "User-Agent": UA, "Content-Type": "application/json", Origin: YT, Referer: YT + "/" }
});

// --- Fungsi Search (Innertube, biarin aja aman) ---
async function getConfig() {
  try {
    const res = await axios.get(YT + "/?hl=en", { timeout: 8000, headers: { "User-Agent": UA, Cookie: COOKIE } });
    const html = String(res.data);
    const key = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
    const version = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/);
    return { key: key ? key[1] : "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8", version: version ? version[1] : "2.20261002.10.00" };
  } catch { return { key: "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8", version: "2.20261002.10.00" }; }
}

const text = (o) => (o ? o.simpleText || (o.runs ? o.runs.map(r => r.text).join("") : null) : null) || null;
function collect(node, out) {
  if (Array.isArray(node)) { for (const n of node) collect(n, out); return; }
  if (!node || typeof node !== "object") return;
  if (node.videoRenderer) out.push(node.videoRenderer);
  for (const k in node) if (k !== "videoRenderer") collect(node[k], out);
}

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
    results.push({
      videoId: v.videoId,
      title: text(v.title),
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
      duration: text(v.lengthText),
      views: text(v.viewCountText),
      channel: { name: text(v.ownerText) },
      thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`
    });
  }
  if (!results.length) throw new Error("Hasil tidak ditemukan");
  return { query, total: results.length, results };
}

// --- Fungsi Download (ytdl-core) ---
async function download(url) {
  const videoIdMatch = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/);
  if (!videoIdMatch) throw new Error("URL YouTube tidak valid");
  const videoId = videoIdMatch[1];
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  let info;
  try {
    // PENTING: KITA MATIKAN CACHE BIAR GAK EROFS
    info = await ytdl.getInfo(videoUrl, {
      requestOptions: {
        headers: { 
          'User-Agent': UA,
          'Cookie': COOKIE // Pakai cookie biar gak dianggap bot
        }
      }
    });
  } catch (err) {
    throw new Error(`Gagal ambil data video: ${err.message}`);
  }

  const title = info.videoDetails?.title || 'Video';
  const author = info.videoDetails?.author || null;
  const durationSec = info.videoDetails?.lengthSeconds;
  const thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  const mp4 = [];
  const mp3 = [];

  info.formats.forEach(f => {
    if (!f.url) return;
    const hasVideo = f.hasVideo;
    const hasAudio = f.hasAudio;
    const quality = f.qualityLabel || f.quality || '';
    const hMatch = quality.match(/(\d+)p/);
    const height = hMatch ? parseInt(hMatch[1]) : 0;

    if (hasVideo && hasAudio) {
      mp4.push({ quality: quality || 'Video', format: 'mp4', url: f.url, height, has_audio: true });
    } else if (hasVideo && !hasAudio && height >= 144) {
      mp4.push({ quality: quality + ' (Tanpa Audio)', format: 'mp4', url: f.url, height, has_audio: false });
    } else if (hasAudio && !hasVideo) {
      mp3.push({ quality: `${f.audioBitrate || 128}kbps`, format: 'mp3', url: f.url, bitrate: f.audioBitrate || 128 });
    }
  });

  mp4.sort((a, b) => (b.height || 0) - (a.height || 0));
  mp3.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

  // Ambil unik
  const mp4u = [...new Map(mp4.map(m => [m.height, m])).values()];
  const mp3u = [...new Map(mp3.map(m => [m.bitrate, m])).values()];

  if (!mp4u.length && !mp3u.length) throw new Error('Tidak ada format tersedia');

  return {
    videoId, title, author, duration: durationSec ? `${durationSec}s` : null,
    url: videoUrl, thumbnail, source: 'ytdl-core',
    mp4: mp4u.slice(0, 6), mp4video_only: [], mp3: mp3u.slice(0, 4)
  };
}

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
