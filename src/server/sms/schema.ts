export const smsMigration={version:32,name:'sms_verification',sql:`
 CREATE TABLE sms_challenges (
 user_id TEXT PRIMARY KEY NOT NULL REFERENCES contact_details(user_id) ON DELETE CASCADE,
 id TEXT UNIQUE NOT NULL, session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
 phone TEXT NOT NULL, contact_version INTEGER NOT NULL, service TEXT NOT NULL,
 provider_sid TEXT, state TEXT NOT NULL CHECK(state IN ('starting','pending','checking','failed')),
 attempts INTEGER NOT NULL DEFAULT 0, lease TEXT, lease_until INTEGER,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
 ) STRICT;
 CREATE TRIGGER sms_contact_changed AFTER UPDATE ON contact_details BEGIN DELETE FROM sms_challenges WHERE user_id=NEW.user_id; END;
 CREATE TRIGGER sms_user_changed AFTER UPDATE OF status,password_hash,email,role ON users BEGIN DELETE FROM sms_challenges WHERE user_id=NEW.id; END;
`};
