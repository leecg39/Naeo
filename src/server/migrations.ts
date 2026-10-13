export const migrations = [{
  version: 1,
  name: 'accounts_profiles_blogs',
  sql: `
    CREATE TABLE users (
      id TEXT PRIMARY KEY NOT NULL,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','admin')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
      terms_accepted_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE profiles (
      user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      nickname TEXT NOT NULL CHECK(length(nickname) BETWEEN 1 AND 30),
      avatar_url TEXT NOT NULL DEFAULT '',
      ranking_public INTEGER NOT NULL DEFAULT 0 CHECK(ranking_public IN (0,1)),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE sessions (
      token_hash TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL CHECK(expires_at > created_at)
    ) STRICT;
    CREATE INDEX sessions_user ON sessions(user_id);
    CREATE INDEX sessions_expiry ON sessions(expires_at);
    CREATE TABLE blogs (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      naver_id TEXT NOT NULL COLLATE NOCASE CHECK(length(naver_id) BETWEEN 2 AND 50),
      title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
      category TEXT NOT NULL DEFAULT '' CHECK(length(category) <= 50),
      is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0,1)),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(owner_id,naver_id)
    ) STRICT;
    CREATE UNIQUE INDEX blogs_primary_owner ON blogs(owner_id) WHERE is_primary = 1;
    CREATE INDEX blogs_owner ON blogs(owner_id,created_at);
    CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY NOT NULL,
      actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX audit_logs_actor ON audit_logs(actor_id,created_at);
    CREATE TABLE rate_limits (
      key TEXT PRIMARY KEY NOT NULL,
      count INTEGER NOT NULL CHECK(count > 0),
      reset_at INTEGER NOT NULL
    ) STRICT;
  `,
}];
