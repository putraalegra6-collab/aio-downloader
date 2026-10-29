const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

let ready = null;

async function createTables() {
  await sql`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL,
    pass_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (LOWER(username))`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_v INT NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false`;
  await sql`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'text',
    body TEXT,
    reply_to INT,
    file_name TEXT,
    mime TEXT,
    data TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS to_user INT REFERENCES users(id) ON DELETE CASCADE`;
  await sql`CREATE INDEX IF NOT EXISTS messages_to_user ON messages (to_user)`;
  await sql`CREATE TABLE IF NOT EXISTS chat_clear (
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    peer_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_id INT NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, peer_id)
  )`;
}

function init() {
  if (!ready) {
    ready = (async () => {
      let lastErr;
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          await createTables();
          return;
        } catch (e) {
          lastErr = e;
          await new Promise((r) => setTimeout(r, 300 * attempt));
        }
      }
      throw lastErr;
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

module.exports = { sql, init };
