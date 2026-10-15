export const engagementMigration = {
 version:27,name:'points_attendance_tutorial',sql:`
 CREATE TABLE point_ledger (
   id TEXT PRIMARY KEY NOT NULL,
   owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
   delta INTEGER NOT NULL CHECK(delta<>0),
   reason TEXT NOT NULL CHECK(reason IN ('attendance','tutorial')),
   reference TEXT NOT NULL,
   created_at INTEGER NOT NULL,
   UNIQUE(owner_id,reason,reference)
 ) STRICT;
 CREATE INDEX point_ledger_owner ON point_ledger(owner_id,created_at DESC);
 CREATE TRIGGER points_no_update BEFORE UPDATE ON point_ledger BEGIN
   SELECT RAISE(ABORT,'Point ledger entries are immutable');
 END;
 CREATE TRIGGER points_no_delete BEFORE DELETE ON point_ledger WHEN EXISTS(SELECT 1 FROM users WHERE id=old.owner_id) BEGIN
   SELECT RAISE(ABORT,'Point ledger entries are immutable');
 END;
 CREATE TABLE attendance (
   owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
   day TEXT NOT NULL CHECK(length(day)=10),
   streak INTEGER NOT NULL CHECK(streak>0),
   points INTEGER NOT NULL CHECK(points>0),
   created_at INTEGER NOT NULL,
   PRIMARY KEY(owner_id,day)
 ) STRICT;
 CREATE TABLE tutorial_claims (
   owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
   step TEXT NOT NULL CHECK(step IN ('blog','mate','ai_picks','ranking','verify')),
   points INTEGER NOT NULL CHECK(points>0),
   created_at INTEGER NOT NULL,
   PRIMARY KEY(owner_id,step)
 ) STRICT;
 CREATE TABLE engagement_preferences (
   owner_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
   sub_topic TEXT NOT NULL DEFAULT '' CHECK(length(sub_topic)<=50),
   version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
   changed_at INTEGER NOT NULL
 ) STRICT;
 CREATE TABLE engagement_visits (
   owner_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
   ranking_at INTEGER NOT NULL
 ) STRICT;
 `,
};
