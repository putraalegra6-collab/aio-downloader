const { sql, init } = require('../lib/db');
const { currentUser, currentToken, clearSession, hashPassword, checkPassword } = require('../lib/auth');

const AVATAR_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_AVATAR_CHARS = 400000;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const OWNER = (process.env.OWNER_USERNAME || '').trim().toLowerCase();

module.exports = async (req, res) => {
  try {
    await init();
    const me = await currentUser(req);
    if (!me) return res.status(401).json({ error: 'Belum login' });
    const q = req.query || {};

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

    if (req.method === 'GET' && q.id) {
      const rows = await sql`SELECT id, username, bio, (avatar IS NOT NULL) AS has_avatar, avatar_v AS av, last_seen,
        (verified OR LOWER(username) = ${OWNER}) AS verified FROM users WHERE id = ${Number(q.id)}`;
      if (!rows[0]) return res.status(404).json({ error: 'User tidak ditemukan' });
      return res.status(200).json(rows[0]);
    }

    if (req.method === 'GET' && q.chats !== undefined) {
      const rows = await sql`SELECT u.id, u.username, u.bio, (u.avatar IS NOT NULL) AS has_avatar, u.avatar_v AS av, u.last_seen,
          (u.verified OR LOWER(u.username) = ${OWNER}) AS verified, MAX(m.id) AS last_id
        FROM messages m
        JOIN users u ON u.id = (CASE WHEN m.user_id = ${me.id} THEN m.to_user ELSE m.user_id END)
        WHERE m.to_user IS NOT NULL AND (m.user_id = ${me.id} OR m.to_user = ${me.id})
          AND m.id > COALESCE((SELECT c.last_id FROM chat_clear c WHERE c.user_id = ${me.id} AND c.peer_id = u.id), 0)
        GROUP BY u.id
        ORDER BY last_id DESC LIMIT 200`;
      return res.status(200).json({ users: rows });
    }

    if (req.method === 'GET' && q.q !== undefined) {
      const term = '%' + String(q.q).toLowerCase().replace(/[%_\\]/g, '') + '%';
      const rows = await sql`SELECT id, username, bio, (avatar IS NOT NULL) AS has_avatar, avatar_v AS av, last_seen,
          (verified OR LOWER(username) = ${OWNER}) AS verified
        FROM users WHERE id <> ${me.id} AND LOWER(username) LIKE ${term} ORDER BY LOWER(username) LIMIT 50`;
      return res.status(200).json({ users: rows });
    }

    if (req.method === 'GET') {
      const rows = await sql`SELECT id, username, bio, (avatar IS NOT NULL) AS has_avatar, avatar_v AS av, last_seen,
        (verified OR LOWER(username) = ${OWNER}) AS verified
        FROM users WHERE id <> ${me.id} ORDER BY LOWER(username) LIMIT 500`;
      return res.status(200).json({ users: rows });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // Centang biru: hanya owner
    if (q.action === 'verify') {
      if (!me.is_owner) return res.status(403).json({ error: 'Hanya owner yang bisa memberi centang' });
      const { id, value } = req.body || {};
      const uid = Number(id);
      if (!Number.isInteger(uid)) return res.status(400).json({ error: 'User tidak valid' });
      await sql`UPDATE users SET verified = ${value === true} WHERE id = ${uid}`;
      return res.status(200).json({ ok: true });
    }

    // Edit bio dan foto
    if (q.action === 'me') {
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

    // Ganti username (butuh password sekarang)
    if (q.action === 'username') {
      const { username = '', password = '' } = req.body || {};
      if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'Username 3-20 karakter: huruf, angka, atau _' });
      const rows = await sql`SELECT pass_hash FROM users WHERE id = ${me.id}`;
      if (!rows[0] || !checkPassword(password, rows[0].pass_hash)) return res.status(401).json({ error: 'Password salah' });
      try {
        await sql`UPDATE users SET username = ${username} WHERE id = ${me.id}`;
      } catch (e) {
        if (String(e.code) === '23505') return res.status(409).json({ error: 'Username sudah dipakai' });
        throw e;
      }
      await sql`UPDATE messages SET username = ${username} WHERE user_id = ${me.id}`;
      return res.status(200).json({ ok: true });
    }

    // Ganti password (butuh password lama). Sesi lain di-logout.
    if (q.action === 'password') {
      const { old_password = '', new_password = '' } = req.body || {};
      if (String(new_password).length < 4) return res.status(400).json({ error: 'Password baru minimal 4 karakter' });
      const rows = await sql`SELECT pass_hash FROM users WHERE id = ${me.id}`;
      if (!rows[0] || !checkPassword(old_password, rows[0].pass_hash)) return res.status(401).json({ error: 'Password lama salah' });
      await sql`UPDATE users SET pass_hash = ${hashPassword(new_password)} WHERE id = ${me.id}`;
      await sql`DELETE FROM sessions WHERE user_id = ${me.id} AND token <> ${currentToken(req)}`;
      return res.status(200).json({ ok: true });
    }

    // Hapus akun permanen (butuh password)
    if (q.action === 'delete') {
      const { password = '' } = req.body || {};
      const rows = await sql`SELECT pass_hash FROM users WHERE id = ${me.id}`;
      if (!rows[0] || !checkPassword(password, rows[0].pass_hash)) return res.status(401).json({ error: 'Password salah' });
      await clearSession(req, res);
      await sql`DELETE FROM users WHERE id = ${me.id}`;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action invalid' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
