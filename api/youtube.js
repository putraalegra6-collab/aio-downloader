/* ============================================================
   YOUTUBE API — By Egaa v3
   Search: Innertube (youtubei)
   Download: ytdl-core (native, no external API)
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
   SEARCH
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
   DOWNLOAD — ytdl-core
   ============================================================ */
async function download(input) {
  const videoId = extractVideoId(input);
  if (!videoId) throw new Error("Video ID tidak valid");

  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // Ambil info video
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

  /* Kumpulkan format MP4 (progressive: video+audio) */
  const mp4 = [];
  const mp3 = [];

  // Filter yang ada video + audio (progressive)
  info.formats.forEach(f => {
    if (!f.url) return;

    const hasVideo = f.hasVideo;
    const hasAudio = f.hasAudio;
    const quality = f.qualityLabel || f.quality || '';

    // Progressive (video + audio)
    if (hasVideo && hasAudio) {
      const hMatch = quality.match(/(\d+)p/);
      const height = hMatch ? parseInt(hMatch[1]) : 0;
      mp4.push({
        quality: quality || 'Video',
        format: 'mp4',
        url: f.url,
        height,
        size: f.contentLength ? `${(f.contentLength / 1024 / 1024).toFixed(1)}MB` : null,
        type: 'progressive',
        itag: f.itag
      });
    }
  });

  // Kalau gak ada progressive, ambil video-only sebagai fallback
  if (!mp4.length) {
    info.formats.forEach(f => {
      if (!f.url || !f.hasVideo) return;
      const quality = f.qualityLabel || 'Video';
      const hMatch = quality.match(/(\d+)p/);
      const height = hMatch ? parseInt(hMatch[1]) : 0;
      if (height < 144) return;
      mp4.push({
        quality: quality + ' (video only)',
        format: 'mp4',
        url: f.url,
        height,
        size: f.contentLength ? `${(f.contentLength / 1024 / 1024).toFixed(1)}MB` : null,
        type: 'adaptive',
        itag: f.itag
      });
    });
  }

  // Audio
  info.formats.forEach(f => {
    if (!f.url || !f.hasAudio || f.hasVideo) return;
    const bitrate = f.audioBitrate || 128;
    mp3.push({
      quality: `${bitrate}kbps`,
      format: 'mp3',
      url: f.url,
      bitrate,
      size: f.contentLength ? `${(f.contentLength / 1024 / 1024).toFixed(1)}MB` : null,
      itag: f.itag
    });
  });

  // Sort
  mp4.sort((a, b) => (b.height || 0) - (a.height || 0));
  mp3.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

  // Dedupe
  const seenMp4 = new Set();
  const mp4Unique = mp4.filter(m => {
    const k = `${m.height}-${m.type}`;
    if (seenMp4.has(k)) return false;
    seenMp4.add(k);
    return true;
  });

  const seenMp3 = new Set();
  const mp3Unique = mp3.filter(m => {
    if (seenMp3.has(m.bitrate)) return false;
    seenMp3.add(m.bitrate);
    return true;
  });

  if (!mp4Unique.length && !mp3Unique.length) {
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
    mp4: mp4Unique.slice(0, 8),
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
