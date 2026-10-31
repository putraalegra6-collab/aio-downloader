const { sql, init } = require('../lib/db');
const { currentUser } = require('../lib/auth');

const MAX_IMG_B64 = 2800000;
const OWNER = (process.env.OWNER_USERNAME || '').trim().toLowerCase();

module.exports = async (req, res) => {
  try {
    await init();
    const me = await currentUser(req);
    if (!me) return res.status(401).json({ error: 'Belum login' });
    const q = req.query || {};

    if (req.method === 'GET' && q.file) {
      const rows = await sql`SELECT mime, data FROM stories WHERE id = ${Number(q.file)} AND data IS NOT NULL AND created_at > now() - interval '24 hours'`;
      if (!rows[0]) return res.status(404).end();
      const mime = String(rows[0].mime || '');
      if (!/^image\/(png|jpeg|webp|gif)$/.test(mime)) return res.status(404).end();
      res.setHeader('Content-Type', mime);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      return res.status(200).end(Buffer.from(rows[0].data, 'base64'));
    }

    if (req.method === 'GET') {
      const rows = await sql`SELECT s.id, s.user_id, s.username, s.kind, s.body, s.created_at,
          (s.data IS NOT NULL) AS has_file, (u.avatar IS NOT NULL) AS has_avatar, u.avatar_v AS av,
          (u.verified OR LOWER(u.username) = ${OWNER}) AS verified
        FROM stories s JOIN users u ON u.id = s.user_id
        WHERE s.created_at > now() - interval '24 hours'
        ORDER BY s.created_at ASC LIMIT 300`;
      return res.status(200).json({ stories: rows });
    }

    if (req.method === 'POST') {
      const { kind = 'text', body = null, data = null, mime = null } = req.body || {};
      if (kind === 'text') {
        const t = String(body || '').trim().slice(0, 300);
        if (!t) return res.status(400).json({ error: 'Status kosong' });
        await sql`INSERT INTO stories (user_id, username, kind, body) VALUES (${me.id}, ${me.username}, 'text', ${t})`;
        return res.status(201).json({ ok: true });
      }
      if (kind === 'image') {
        if (!data || String(data).length > MAX_IMG_B64) return res.status(413).json({ error: 'Foto terlalu besar (maks 2 MB)' });
        if (!/^image\/(png|jpeg|webp|gif)$/.test(String(mime || ''))) return res.status(400).json({ error: 'Format foto tidak didukung' });
        const cap = body ? String(body).trim().slice(0, 300) : null;
        await sql`INSERT INTO stories (user_id, username, kind, body, mime, data) VALUES (${me.id}, ${me.username}, 'image', ${cap}, ${String(mime)}, ${String(data)})`;
        return res.status(201).json({ ok: true });
      }
      return res.status(400).json({ error: 'Jenis status tidak valid' });
    }

    if (req.method === 'DELETE') {
      await sql`DELETE FROM stories WHERE id = ${Number(q.id)} AND user_id = ${me.id}`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
