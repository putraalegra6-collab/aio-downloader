/* ============================================================
   API 3 — YouTube Search + Download
   Base: youtube.com + cnv.cx (y2meta-uk)
   ============================================================ */

const axios = require('axios');

const YT  = "https://www.youtube.com";
const CNV = "https://cnv.cx/v2";
const UA  = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

const FALLBACK = {
  key: "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
  version: "2.20261002.10.00"
};

const yt = axios.create({
  timeout: 25000,
  headers: {
    "User-Agent": UA,
    "Content-Type": "application/json",
    Origin: YT,
    Referer: YT + "/"
  }
});

const cnv = axios.create({
  timeout: 25000,
  headers: {
    "User-Agent": UA,
    Referer: "https://frame.y2meta-uk.com/",
    Origin: "https://frame.y2meta-uk.com"
  }
});

/* ---------------- Config (innertube key + version) ---------------- */
async function getConfig() {
  try {
    const res = await axios.get(YT + "/?hl=en", {
      timeout: 8000,
      headers: { "User-Agent": UA, Cookie: "CONSENT=YES+1; SOCS=CAI" }
    });
    const html = String(res.data);
    const key = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
    const version = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/);
    return {
      key: key ? key[1] : FALLBACK.key,
      version: version ? version[1] : FALLBACK.version
    };
  } catch {
    return FALLBACK;
  }
}

/* ---------------- Helpers ---------------- */
const text = (o) => (o ? o.simpleText || (o.runs ? o.runs.map(r => r.text).join("") : null) : null) || null;

function collect(node, out) {
  if (Array.isArray(node)) {
    for (const n of node) collect(n, out);
    return;
  }
  if (!node || typeof node !== "object") return;
  if (node.videoRenderer) out.push(node.videoRenderer);
  for (const k in node) {
    if (k !== "videoRenderer") collect(node[k], out);
  }
}

function mapVideo(v) {
  const owner = v.ownerText?.runs?.[0];
  const path = owner?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl;
  const snippet = v.detailedMetadataSnippets?.[0]
    ? text(v.detailedMetadataSnippets[0].snippetText)
    : null;
  return {
    videoId: v.videoId,
    title: text(v.title),
    url: `https://www.youtube.com/watch?v=${v.videoId}`,
    duration: text(v.lengthText),
    views: text(v.viewCountText),
    published: text(v.publishedTimeText),
    description: snippet || text(v.descriptionSnippet),
    channel: {
      name: text(v.ownerText),
      url: path ? YT + path : null
    },
    thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`
  };
}

/* ---------------- Search ---------------- */
async function search(query) {
  const cfg = await getConfig();
  const res = await yt.post(
    `${YT}/youtubei/v1/search?key=${cfg.key}&prettyPrint=false`,
    {
      context: {
        client: {
          clientName: "WEB",
          clientVersion: cfg.version,
          hl: "id",
          gl: "ID"
        }
      },
      query,
      params: "EgIQAQ=="
    },
    {
      headers: {
        "X-Youtube-Client-Name": "1",
        "X-Youtube-Client-Version": cfg.version
      }
    }
  );

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

/* ---------------- Extract Video ID ---------------- */
function extractVideoId(input) {
  const s = String(input).trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

/* ---------------- Get converter key ---------------- */
async function getKey(videoId) {
  const res = await cnv.get(`${CNV}/sanity/key?id=${videoId}`);
  return res.data.key;
}

/* ---------------- Convert to download URL ---------------- */
async function convert(key, videoId, format, videoQuality, audioBitrate) {
  const res = await cnv.post(
    `${CNV}/converter`,
    new URLSearchParams({
      link: `https://youtu.be/${videoId}`,
      format,
      audioBitrate: String(audioBitrate),
      videoQuality: String(videoQuality),
      filenameStyle: "pretty",
      vCodec: "h264"
    }).toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        accept: "*/*",
        key
      }
    }
  );
  return {
    url: res.data?.url || null,
    filename: res.data?.filename || null
  };
}

/* ---------------- Get video title (oembed) ---------------- */
async function getTitle(videoId) {
  try {
    const res = await axios.get(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      { timeout: 8000 }
    );
    return res.data.title;
  } catch {
    return "Unknown";
  }
}

/* ---------------- Download (all formats) ---------------- */
async function download(input) {
  const videoId = extractVideoId(input);
  if (!videoId) throw new Error("Video ID tidak valid");

  const [title, key] = await Promise.all([getTitle(videoId), getKey(videoId)]);

  const mp4Qualities = [1080, 720, 360, 240, 144];
  const mp3Qualities = [320, 256, 128];

  const [mp4, mp3] = await Promise.all([
    Promise.all(
      mp4Qualities.map(async (q) => {
        const { url, filename } = await convert(key, videoId, "mp4", q, 128)
          .catch(() => ({ url: null, filename: null }));
        return { quality: `${q}p`, format: "mp4", url, filename };
      })
    ),
    Promise.all(
      mp3Qualities.map(async (q) => {
        const { url, filename } = await convert(key, videoId, "mp3", 720, q)
          .catch(() => ({ url: null, filename: null }));
        return { quality: `${q}kbps`, format: "mp3", url, filename };
      })
    )
  ]);

  return {
    videoId,
    title,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    mp4,
    mp3
  };
}

/* ---------------- Handler ---------------- */
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, query, url } = req.body || {};

  try {
    if (action === 'search') {
      if (!query) return res.status(400).json({ error: 'Query wajib diisi' });
      const data = await search(query);
      return res.status(200).json(data);
    }

    if (action === 'download') {
      if (!url) return res.status(400).json({ error: 'URL wajib diisi' });
      const data = await download(url);
      return res.status(200).json(data);
    }

    return res.status(400).json({ error: 'Action tidak valid' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
