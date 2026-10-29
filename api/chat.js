const { sql, init } = require('../lib/db');
const { currentUser } = require('../lib/auth');

const MAX_B64 = 4 * 1024 * 1024; // ~3 MB file asli
const KINDS = ['text', 'image', 'video', 'audio', 'voice', 'file', 'report'];

module.exports = async (req, res) => {
  try {
    await init();
    const me = await currentUser(req);
    if (!me) return res.status(401).json({ error: 'Belum login' });

    // Ambil file (foto/video/audio/VN/file)
    if (req.method === 'GET' && req.query.file) {
      const rows = await sql`SELECT file_name, mime, data FROM messages WHERE id = ${Number(req.query.file)} AND data IS NOT NULL`;
      if (!rows[0]) return res.status(404).end();
      const mime = String(rows[0].mime || '');
      // Hanya tipe media aman yang ditampilkan langsung. Selain itu dipaksa download (cegah XSS)
      const inline = /^(image\/(png|jpeg|gif|webp)|video\/(mp4|webm)|audio\/)/.test(mime);
      res.setHeader('Content-Type', inline ? mime : 'application/octet-stream');
      res.setHeader('Content-Disposition', (inline ? 'inline' : 'attachment') + '; filename="' + encodeURIComponent(rows[0].file_name || 'file') + '"');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      return res.status(200).end(Buffer.from(rows[0].data, 'base64'));
    }

    // Daftar 100 pesan terakhir (tanpa isi file, biar ringan)
    if (req.method === 'GET') {
      const rows = await sql`SELECT id, user_id, username, kind, body, reply_to, file_name, mime, (data IS NOT NULL) AS has_file, created_at
        FROM messages ORDER BY id DESC LIMIT 100`;
      return res.status(200).json({ messages: rows.reverse() });
    }

    if (req.method === 'POST') {
      const { kind = 'text', body = null, reply_to = null, file_name = null, mime = null, data = null } = req.body || {};
      if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Jenis pesan tidak valid' });
      if (data && String(data).length > MAX_B64) return res.status(413).json({ error: 'File terlalu besar (maks 3 MB)' });
      const text = body ? String(body).trim().slice(0, 2000) : null;
      if (!data && !text) return res.status(400).json({ error: 'Pesan kosong' });

      const rows = await sql`INSERT INTO messages (user_id, username, kind, body, reply_to, file_name, mime, data)
        VALUES (${me.id}, ${me.username}, ${kind}, ${text}, ${reply_to ? Number(reply_to) : null},
          ${file_name ? String(file_name).slice(0, 200) : null}, ${mime ? String(mime).slice(0, 100) : null}, ${data || null})
        RETURNING id`;
      return res.status(201).json({ id: rows[0].id });
    }

    if (req.method === 'DELETE') {
      const id = Number(req.query.id);
      const rows = await sql`SELECT user_id FROM messages WHERE id = ${id}`;
      if (!rows[0]) return res.status(404).json({ error: 'Pesan tidak ditemukan' });
      if (rows[0].user_id !== me.id && !me.is_admin) return res.status(403).json({ error: 'Bukan pesanmu' });
      await sql`DELETE FROM messages WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
