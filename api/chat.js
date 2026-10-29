const { sql, init } = require('../lib/db');
const { currentUser } = require('../lib/auth');

const MAX_B64 = 4 * 1024 * 1024;
const KINDS = ['text', 'image', 'video', 'audio', 'voice', 'file'];

module.exports = async (req, res) => {
  try {
    await init();
    const me = await currentUser(req);
    if (!me) return res.status(401).json({ error: 'Belum login' });
    const q = req.query || {};

    // Ambil isi file (foto, video, audio, VN, file)
    if (req.method === 'GET' && q.file) {
      const rows = await sql`SELECT user_id, to_user, file_name, mime, data FROM messages WHERE id = ${Number(q.file)} AND data IS NOT NULL`;
      if (!rows[0]) return res.status(404).end();
      const r = rows[0];
      if (r.to_user && r.user_id !== me.id && r.to_user !== me.id && !me.is_admin) return res.status(403).end();
      const mime = String(r.mime || '');
      const inline = /^(image\/(png|jpeg|gif|webp)|video\/(mp4|webm)|audio\/)/.test(mime);
      res.setHeader('Content-Type', inline ? mime : 'application/octet-stream');
      res.setHeader('Content-Disposition', (inline ? 'inline' : 'attachment') + '; filename="' + encodeURIComponent(r.file_name || 'file') + '"');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      return res.status(200).end(Buffer.from(r.data, 'base64'));
    }

    // Daftar pesan: global (tanpa with) atau chat pribadi (with=ID)
    if (req.method === 'GET') {
      let rows;
      if (q.with !== undefined) {
        const w = Number(q.with);
        if (!Number.isInteger(w)) return res.status(400).json({ error: 'User tidak valid' });
        rows = await sql`SELECT m.id, m.user_id, m.username, m.kind, m.body, m.reply_to, m.file_name, m.mime, m.to_user,
            (m.data IS NOT NULL) AS has_file, m.created_at, (u.avatar IS NOT NULL) AS has_avatar, u.avatar_v AS av
          FROM messages m JOIN users u ON u.id = m.user_id
          WHERE (m.user_id = ${me.id} AND m.to_user = ${w}) OR (m.user_id = ${w} AND m.to_user = ${me.id})
          ORDER BY m.id DESC LIMIT 100`;
      } else {
        rows = await sql`SELECT m.id, m.user_id, m.username, m.kind, m.body, m.reply_to, m.file_name, m.mime, m.to_user,
            (m.data IS NOT NULL) AS has_file, m.created_at, (u.avatar IS NOT NULL) AS has_avatar, u.avatar_v AS av
          FROM messages m JOIN users u ON u.id = m.user_id
          WHERE m.to_user IS NULL
          ORDER BY m.id DESC LIMIT 100`;
      }
      return res.status(200).json({ messages: rows.reverse() });
    }

    if (req.method === 'POST') {
      const { kind = 'text', body = null, reply_to = null, file_name = null, mime = null, data = null, to = null } = req.body || {};
      if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Jenis pesan tidak valid' });
      if (data && String(data).length > MAX_B64) return res.status(413).json({ error: 'File terlalu besar (maks 3 MB)' });
      const text = body ? String(body).trim().slice(0, 2000) : null;
      if (!data && !text) return res.status(400).json({ error: 'Pesan kosong' });

      let toId = null;
      if (to !== null && to !== undefined) {
        toId = Number(to);
        if (!Number.isInteger(toId)) return res.status(400).json({ error: 'Penerima tidak valid' });
        const t = await sql`SELECT id FROM users WHERE id = ${toId}`;
        if (!t[0]) return res.status(404).json({ error: 'Penerima tidak ditemukan' });
      }

      const replyId = reply_to ? Number(reply_to) : null;
      const rows = await sql`INSERT INTO messages (user_id, username, kind, body, reply_to, file_name, mime, data, to_user)
        VALUES (${me.id}, ${me.username}, ${kind}, ${text}, ${Number.isInteger(replyId) ? replyId : null},
          ${file_name ? String(file_name).slice(0, 200) : null}, ${mime ? String(mime).slice(0, 100) : null},
          ${data || null}, ${toId})
        RETURNING id`;
      return res.status(201).json({ id: rows[0].id });
    }

    if (req.method === 'DELETE') {
      const id = Number(q.id);
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
