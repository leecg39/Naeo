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
}, {
  version: 2,
  name: 'account_security_and_preferences',
  sql: `
    ALTER TABLE users ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0);
    ALTER TABLE users ADD COLUMN email_verified_at INTEGER;
    ALTER TABLE sessions ADD COLUMN public_id TEXT NOT NULL DEFAULT '';
    UPDATE sessions SET public_id=lower(hex(randomblob(16)));
    CREATE UNIQUE INDEX sessions_public_id ON sessions(public_id);
    CREATE TABLE contact_details (
      user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT '' CHECK(length(name)<=80),
      email TEXT NOT NULL DEFAULT '' CHECK(length(email)<=254),
      phone TEXT NOT NULL DEFAULT '' CHECK(length(phone)<=20),
      phone_verified_at INTEGER,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE notification_preferences (
      user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      marketing_email INTEGER NOT NULL DEFAULT 0 CHECK(marketing_email IN (0,1)),
      scan_email INTEGER NOT NULL DEFAULT 0 CHECK(scan_email IN (0,1)),
      autoscan INTEGER NOT NULL DEFAULT 0 CHECK(autoscan IN (0,1)),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE consent_history (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('terms','marketing_email','scan_email')),
      accepted INTEGER NOT NULL CHECK(accepted IN (0,1)),
      created_at INTEGER NOT NULL
    ) STRICT;
    INSERT INTO notification_preferences(user_id,updated_at) SELECT id,updated_at FROM users;
    INSERT INTO consent_history(id,user_id,kind,accepted,created_at)
      SELECT lower(hex(randomblob(16))),id,'terms',1,terms_accepted_at FROM users WHERE terms_accepted_at>0;
  `,
}];
