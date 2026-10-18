const axios = require('axios');

const JEREXD_BASE = 'https://api.jerexd.my.id/api/downloader/aiov2';
const JEREXD_KEY = 's2tQZgBEIaX4t3K7';
const TIKWM_BASE = 'https://www.tikwm.com/api/';
const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36';

const isTikTok = (url) => /tiktok\.com/i.test(url);

async function fromJerexd(value) {
  const r = await axios.get(JEREXD_BASE, {
    params: { apikey: JEREXD_KEY, url: value },
    timeout: 30000,
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    validateStatus: () => true
  });
  const json = r.data;
  if (!json || json.status !== true) {
    throw new Error(json?.message || json?.error || 'Gagal memproses link dari server Jerexd');
  }
  return json;
}

async function fromTikWM(value) {
  const r = await axios.get(TIKWM_BASE, {
    params: { url: value, hd: 1 },
    timeout: 20000,
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    validateStatus: () => true
  });
  const json = r.data;
  if (!json || json.code !== 0 || !json.data) {
    throw new Error(json?.msg || 'Gagal dari TikWM');
  }
  return json.data;
}

function jerexdMedias(json) {
  return (json.downloads || []).map((item) => {
    const type = (item.type || '').toLowerCase();
    const isAudio = type.includes('audio') || type.includes('mp3');
    return {
      type: isAudio ? 'audio' : 'video',
      quality: item.quality || item.type || 'Default',
      extension: isAudio ? 'mp3' : 'mp4',
      is_audio: isAudio,
      url: item.url
    };
  }).filter(m => m.url);
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
    // Untuk TikTok, panggil Jerexd dan TikWM bersamaan. Kalau salah satu gagal, yang lain tetap dipakai.
    const tiktok = isTikTok(value);
    const [jx, tw] = await Promise.allSettled([
      fromJerexd(value),
      tiktok ? fromTikWM(value) : Promise.resolve(null)
    ]);

    if (jx.status === 'rejected' && (tw.status !== 'fulfilled' || !tw.value)) {
      throw new Error(jx.reason?.message || 'Gagal memproses media');
    }

    const j = jx.status === 'fulfilled' ? jx.value : null;
    const t = tw.status === 'fulfilled' ? tw.value : null;

    let medias = j ? jerexdMedias(j) : [];
    if (!medias.length && t) medias = tikwmMedias(t);
    if (!medias.length) throw new Error('Tidak ada link unduhan yang ditemukan');

    const authorName = t?.author?.nickname || j?.owner || j?.author || null;
    const avatar = t?.author?.avatar || null;
    const thumbnail = t?.cover || j?.thumbnail || null;

    const stats = t ? {
      views: t.play_count ?? null,
      likes: t.digg_count ?? null,
      comments: t.comment_count ?? null,
      shares: t.share_count ?? null
    } : null;

    res.status(200).json({
      status: true,
      source: t && j ? 'jerexd+tikwm' : (t ? 'tikwm' : 'jerexd'),
      title: t?.title || j?.title || 'Media',
      author: authorName,
      author_avatar: avatar,
      thumbnail,
      duration: t?.duration ?? null,
      stats,
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
