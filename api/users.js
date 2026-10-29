const { sql, init } = require('../lib/db');
const { currentUser } = require('../lib/auth');

const AVATAR_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_AVATAR_CHARS = 400000;
const OWNER = (process.env.OWNER_USERNAME || '').trim().toLowerCase();

module.exports = async (req, res) => {
  try {
    await init();
    const me = await currentUser(req);
    if (!me) return res.status(401).json({ error: 'Belum login' });
    const q = req.query || {};

    // Foto profil (gambar biner)
    if (req.method === 'GET' && q.avatar) {
      const rows = await sql`SELECT avatar FROM users WHERE id = ${Number(q.avatar)}`;
      if (!rows[0] || !rows[0].avatar) return res.status(404).end();
      const m = rows[0].avatar.match(/^data:(image\/[a-z]+);base64,(.+)$/);
      if (!m) return res.status(404).end();
      res.setHeader('Content-Type', m[1]);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      return res.status(200).end(Buffer.from(m[2], 'base64'));
    }

    // Profil satu user
    if (req.method === 'GET' && q.id) {
      const rows = await sql`SELECT id, username, bio, (avatar IS NOT NULL) AS has_avatar, avatar_v AS av, (verified OR LOWER(username) = ${OWNER}) AS verified FROM users WHERE id = ${Number(q.id)}`;
      if (!rows[0]) return res.status(404).json({ error: 'User tidak ditemukan' });
      return res.status(200).json(rows[0]);
    }

    // Daftar user lain
    if (req.method === 'GET') {
      const rows = await sql`SELECT id, username, bio, (avatar IS NOT NULL) AS has_avatar, avatar_v AS av, (verified OR LOWER(username) = ${OWNER}) AS verified
        FROM users WHERE id <> ${me.id} ORDER BY LOWER(username) LIMIT 500`;
      return res.status(200).json({ users: rows });
    }

    // Centang biru: hanya owner yang boleh
    if (req.method === 'POST' && q.action === 'verify') {
      if (!me.is_owner) return res.status(403).json({ error: 'Hanya owner yang bisa memberi centang' });
      const { id, value } = req.body || {};
      const uid = Number(id);
      if (!Number.isInteger(uid)) return res.status(400).json({ error: 'User tidak valid' });
      await sql`UPDATE users SET verified = ${value === true} WHERE id = ${uid}`;
      return res.status(200).json({ ok: true });
    }

    // Edit profil sendiri: bio dan/atau foto
    if (req.method === 'POST' && q.action === 'me') {
      const { bio, avatar } = req.body || {};
      if (bio !== undefined) {
        const b = String(bio ?? '').trim().slice(0, 160);
        await sql`UPDATE users SET bio = ${b} WHERE id = ${me.id}`;
      }
      if (avatar !== undefined) {
        if (avatar === null) {
          await sql`UPDATE users SET avatar = NULL, avatar_v = avatar_v + 1 WHERE id = ${me.id}`;
        } else {
          if (typeof avatar !== 'string' || avatar.length > MAX_AVATAR_CHARS || !AVATAR_RE.test(avatar)) {
            return res.status(400).json({ error: 'Foto tidak valid (maks 300 KB)' });
          }
          await sql`UPDATE users SET avatar = ${avatar}, avatar_v = avatar_v + 1 WHERE id = ${me.id}`;
        }
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
