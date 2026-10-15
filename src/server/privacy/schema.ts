export const personalExportMigration={version:29,name:'personal_data_exports',sql:`
 CREATE TABLE personal_exports (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','succeeded','failed')),
  attempt INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until INTEGER,
  file_key TEXT UNIQUE,
  file_size INTEGER,
  error TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  expires_at INTEGER NOT NULL
 ) STRICT;
 CREATE UNIQUE INDEX personal_exports_active ON personal_exports(owner_id) WHERE state IN ('queued','running');
 CREATE INDEX personal_exports_expiry ON personal_exports(expires_at);
 CREATE TABLE personal_export_deletions (
  file_key TEXT PRIMARY KEY NOT NULL,
  queued_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  last_attempt_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT NOT NULL DEFAULT ''
 ) STRICT;
 CREATE TRIGGER personal_export_replace AFTER UPDATE OF file_key ON personal_exports WHEN OLD.file_key IS NOT NULL AND (NEW.file_key IS NULL OR NEW.file_key<>OLD.file_key) BEGIN
  INSERT INTO personal_export_deletions(file_key) VALUES(OLD.file_key) ON CONFLICT DO NOTHING;
 END;
 CREATE TRIGGER personal_export_delete AFTER DELETE ON personal_exports WHEN OLD.file_key IS NOT NULL BEGIN
  INSERT INTO personal_export_deletions(file_key) VALUES(OLD.file_key) ON CONFLICT DO NOTHING;
 END;
`};
