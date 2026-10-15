export const inquiryMailMigration={version:31,name:'inquiry_mail_outbox',sql:`
 CREATE TABLE inquiry_mail (
 id TEXT PRIMARY KEY NOT NULL, reply_id TEXT NOT NULL UNIQUE REFERENCES inquiry_messages(id) ON DELETE CASCADE,
 payload TEXT, state TEXT NOT NULL CHECK(state IN ('queued','sending','retry','accepted','failed')),
 attempt INTEGER NOT NULL DEFAULT 0, lease TEXT, lease_until INTEGER, run_after INTEGER NOT NULL,
 expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, error_code TEXT NOT NULL DEFAULT ''
 ) STRICT;
 CREATE INDEX inquiry_mail_pending ON inquiry_mail(state,run_after);
 CREATE TRIGGER inquiry_mail_immutable BEFORE UPDATE OF body ON inquiry_messages
 WHEN OLD.body<>NEW.body AND EXISTS(SELECT 1 FROM inquiry_mail WHERE reply_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'Dispatched reply is immutable'); END;
`};
