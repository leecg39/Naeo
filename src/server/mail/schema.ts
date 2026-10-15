export const accountMailMigration={version:30,name:'account_mail_tokens_outbox',sql:`
 CREATE TABLE account_mail (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK(purpose IN ('reset','verify')),
  email TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL CHECK(length(token_hash)=64),
  encrypted_payload TEXT,
  state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','sending','retry','accepted','failed')),
  attempt INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until INTEGER,
  run_after INTEGER NOT NULL,
  error_code TEXT NOT NULL DEFAULT '',
  provider_id TEXT,
  accepted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
 ) STRICT;
 CREATE INDEX account_mail_queue ON account_mail(state,run_after);
 CREATE INDEX account_mail_user ON account_mail(user_id,purpose,created_at);
 CREATE TRIGGER invalidate_account_mail AFTER UPDATE OF password_hash,email,status,role ON users
 WHEN OLD.password_hash<>NEW.password_hash OR OLD.email<>NEW.email OR OLD.status<>NEW.status OR OLD.role<>NEW.role BEGIN
  DELETE FROM account_mail WHERE user_id=NEW.id;
 END;
`};
