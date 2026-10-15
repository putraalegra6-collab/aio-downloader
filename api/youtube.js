/* ============================================================
   YOUTUBE API — By Egaa v4
   Search: Innertube
   Download: ytdl-core (progressive prioritized)
   ============================================================ */

const axios = require('axios');
const ytdl = require('@distube/ytdl-core');

const YT = "https://www.youtube.com";
const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36";
const FALLBACK_CFG = { key: "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8", version: "2.20261002.10.00" };

const yt = axios.create({
  timeout: 25000,
  headers: { "User-Agent": UA, "Content-Type": "application/json", Origin: YT, Referer: YT + "/" }
});

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
  return {
    videoId: v.videoId,
    title: text(v.title),
    url: `https://www.youtube.com/watch?v=${v.videoId}`,
    duration: text(v.lengthText),
    views: text(v.viewCountText),
    published: text(v.publishedTimeText),
    channel: { name: text(v.ownerText), url: path ? YT + path : null },
    thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`
  };
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
    results.push(mapVideo(v));
  }
  if (!results.length) throw new Error("Hasil tidak ditemukan");
  return { query, total: results.length, results };
}

function extractVideoId(input) {
  const s = String(input).trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

async function download(input) {
  const videoId = extractVideoId(input);
  if (!videoId) throw new Error("Video ID tidak valid");

  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  let info;
  try {
    info = await ytdl.getInfo(videoUrl, {
      requestOptions: {
        headers: {
          'User-Agent': UA,
          'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
        }
      }
    });
  } catch (err) {
    throw new Error(`Gagal mengambil info: ${err.message}`);
  }

  if (!info || !info.formats) throw new Error('Info video tidak tersedia');

  const title = info.videoDetails?.title || 'Video';
  const author = info.videoDetails?.author || null;
  const durationSec = info.videoDetails?.lengthSeconds;
  const thumbnail = info.videoDetails?.thumbnails?.slice(-1)[0]?.url
    || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  const mp4 = [];   // progressive (video + audio)
  const mp4v = [];  // video only
  const mp3 = [];

  info.formats.forEach(f => {
    if (!f.url) return;

    const hasVideo = f.hasVideo;
    const hasAudio = f.hasAudio;
    const quality = f.qualityLabel || f.quality || '';
    const hMatch = quality.match(/(\d+)p/);
    const height = hMatch ? parseInt(hMatch[1]) : 0;

    if (hasVideo && hasAudio) {
      mp4.push({
        quality: quality || 'Video',
        format: 'mp4',
        url: f.url,
        height,
        has_audio: true,
        size: f.contentLength ? `${(f.contentLength / 1024 / 1024).toFixed(1)}MB` : null
      });
    } else if (hasVideo && !hasAudio) {
      if (height < 144) return;
      mp4v.push({
        quality: quality + ' (tanpa audio)',
        format: 'mp4',
        url: f.url,
        height,
        has_audio: false,
        size: f.contentLength ? `${(f.contentLength / 1024 / 1024).toFixed(1)}MB` : null
      });
    } else if (hasAudio && !hasVideo) {
      const bitrate = f.audioBitrate || 128;
      mp3.push({
        quality: `${bitrate}kbps`,
        format: 'mp3',
        url: f.url,
        bitrate,
        has_audio: true,
        size: f.contentLength ? `${(f.contentLength / 1024 / 1024).toFixed(1)}MB` : null
      });
    }
  });

  mp4.sort((a, b) => (b.height || 0) - (a.height || 0));
  mp4v.sort((a, b) => (b.height || 0) - (a.height || 0));
  mp3.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

  const seenH = new Set();
  const mp4u = mp4.filter(m => { if (seenH.has(m.height)) return false; seenH.add(m.height); return true; });
  const seenV = new Set();
  const mp4vu = mp4v.filter(m => { if (seenV.has(m.height)) return false; seenV.add(m.height); return true; });
  const seenA = new Set();
  const mp3u = mp3.filter(m => { if (seenA.has(m.bitrate)) return false; seenA.add(m.bitrate); return true; });

  if (!mp4u.length && !mp4vu.length && !mp3u.length) {
    throw new Error('Tidak ada format tersedia (mungkin video age-restricted)');
  }

  return {
    videoId,
    title,
    author,
    duration: durationSec ? `${durationSec}s` : null,
    url: videoUrl,
    thumbnail,
    source: 'ytdl-core',
    mp4: mp4u.slice(0, 6),
    mp4video_only: mp4vu.slice(0, 4),
    mp3: mp3u.slice(0, 4)
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
