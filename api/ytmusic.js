const musicfyrik = require('../lib/musicfyrik'); // Pastiin file lib/musicfyrik.js lu ada

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Ambil parameter dari request frontend lu
  const { action, query, videoId, title, artist } = req.method === 'POST' ? req.body : req.query;

  try {
    // 1. FITUR HOME (Lagu Populer)
    if (action === 'home') {
      try {
        // Ambil lagu-lagu populer pakai keyword default
        const sr = await musicfyrik.search('Top Hits Indonesia');
        return res.status(200).json({ status: true, result: { songs: sr.songs.slice(0, 30) } });
      } catch (e) {
        console.log('[ytmusic] Home error:', e.message);
        return res.status(200).json({ status: false, result: { songs: [] } });
      }
    }

    // 2. FITUR SEARCH (Cari Lagu)
    if (action === 'search') {
      try {
        const sr = await musicfyrik.search(query);
        return res.status(200).json({ status: true, result: { query: query, songs: sr.songs } });
      } catch (e) {
        console.log('[ytmusic] Search error:', e.message);
        return res.status(200).json({ status: false, message: 'Gagal mencari lagu', result: { songs: [] } });
      }
    }

    // 3. FITUR PLAY (Putar Lagu)
    if (action === 'play') {
      try {
        const resPlay = await musicfyrik.play(videoId);
        const audioUrl = resPlay.downloadUrl || resPlay.proxyStreamUrl;

        if (!audioUrl) {
          return res.status(200).json({ status: false, message: 'Link audio tidak ditemukan' });
        }

        // Format durasi (detik ke Menit:Detik)
        let fmtDur = resPlay.duration;
        if (typeof fmtDur === 'number' && isFinite(fmtDur)) {
          fmtDur = Math.floor(fmtDur / 60) + ':' + String(Math.floor(fmtDur % 60)).padStart(2, '0');
        }

        return res.status(200).json({
          status: true,
          result: { 
            duration: fmtDur, 
            download: { audio: audioUrl } 
          }
        });
      } catch (e) {
        console.log('[ytmusic] Play error:', e.message);
        return res.status(200).json({ status: false, message: 'Gagal memutar lagu: ' + e.message });
      }
    }

    // 4. FITUR LIRIK
    if (action === 'lyrics') {
      try {
        const l = await musicfyrik.lyrics(videoId, artist);
        return res.status(200).json({ status: true, result: { lyrics: l } });
      } catch (e) {
        console.log('[ytmusic] Lyrics error:', e.message);
        return res.status(200).json({ status: false, message: 'Lirik tidak ditemukan' });
      }
    }

    return res.status(400).json({ status: false, message: 'Action invalid' });
  } catch (err) {
    return res.status(500).json({ status: false, message: err.message });
  }
};
