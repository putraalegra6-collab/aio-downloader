const axios = require('axios');

const AIO_BASE = 'https://api.jerexd.my.id/api/downloader/aiov2';
const TIKWM_BASE = 'https://www.tikwm.com/api/';
const JEREXD_KEY = process.env.JEREXD_KEY || 's2tQZgBEIaX4t3K7';
const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36';

const isTikTok = (url) => /tiktok\.com/i.test(url);
const toNum = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return isFinite(n) ? n : null;
};

async function fromAio(value) {
  const r = await axios.get(AIO_BASE, {
    params: { apikey: JEREXD_KEY, url: value },
    timeout: 30000,
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    validateStatus: () => true
  });
  const json = r.data;
  if (!json || json.status !== true || !json.result) {
    throw new Error(json?.error || json?.message || 'Gagal dari server AIO');
  }
  return json.result;
}

async function fromTikWM(value) {
  const r = await axios.get(TIKWM_BASE, {
    params: { url: value, hd: 1 },
    timeout: 20000,
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    validateStatus: () => true
  });
  const json = r.data;
  if (!json || json.code !== 0 || !json.data) throw new Error(json?.msg || 'Gagal dari TikWM');
  return json.data;
}

function normMedias(list = []) {
  return list.map((m) => {
    const ext = String(m.extension || '').toLowerCase();
    const isAudio = m.type === 'audio' || ['mp3', 'm4a', 'opus', 'aac', 'wav'].includes(ext);
    return {
      type: isAudio ? 'audio' : 'video',
      quality: m.quality || m.label || 'Default',
      extension: ext || (isAudio ? 'mp3' : 'mp4'),
      is_audio: isAudio,
      url: m.url
    };
  }).filter((m) => m.url);
}

function tikwmMedias(d) {
  const list = [];
  if (d.hdplay) list.push({ type: 'video', quality: 'HD no watermark', extension: 'mp4', is_audio: false, url: d.hdplay });
  if (d.play) list.push({ type: 'video', quality: 'no watermark', extension: 'mp4', is_audio: false, url: d.play });
  if (d.music) list.push({ type: 'audio', quality: 'Audio', extension: 'mp3', is_audio: true, url: d.music });
  return list;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ status: false, error: 'Method not allowed' });

  const { input } = req.body || {};
  if (!input || !String(input).trim()) {
    return res.status(400).json({ status: false, error: 'Input wajib diisi' });
  }
  const value = String(input).trim();

  try {
    const tiktok = isTikTok(value);
    const [aio, tw] = await Promise.allSettled([
      fromAio(value),
      tiktok ? fromTikWM(value) : Promise.resolve(null)
    ]);

    const a = aio.status === 'fulfilled' ? aio.value : null;
    const t = tw.status === 'fulfilled' ? tw.value : null;

    let medias = a ? normMedias(a.medias) : [];
    if (!medias.length && t) medias = tikwmMedias(t);
    if (!medias.length) {
      throw new Error(aio.reason?.message || 'Tidak ada link unduhan yang ditemukan');
    }

    const stats = {
      views: toNum(t?.play_count) ?? toNum(a?.viewCount),
      likes: toNum(t?.digg_count),
      comments: toNum(t?.comment_count),
      shares: toNum(t?.share_count)
    };
    const hasStats = Object.values(stats).some((v) => v !== null);

    res.status(200).json({
      status: true,
      source: a && t ? 'aiov2+tikwm' : (a ? 'aiov2' : 'tikwm'),
      title: a?.title || t?.title || 'Media',
      author: a?.author || t?.author?.nickname || null,
      author_avatar: t?.author?.avatar || null,
      thumbnail: t?.cover || a?.thumbnail || null,
      duration: a?.duration ?? t?.duration ?? null,
      stats: hasStats ? stats : null,
      url: value,
      medias
    });
  } catch (err) {
    res.status(500).json({
      status: false,
      error: err.message || 'Gagal memproses media',
      detail: err.message
    });
  }
};
