export const memberKeywordsMigration={version:47,name:'member_keyword_workspace',sql:`
 ALTER TABLE saved_keywords ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN(0,1));
 UPDATE saved_keywords SET favorite=1 WHERE status='saved';
 CREATE TABLE member_keywords (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phrase TEXT NOT NULL CHECK(length(phrase) BETWEEN 1 AND 60),
  phrase_key TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '' CHECK(length(category)<=30),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=500),
  favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN(0,1)),
  written INTEGER NOT NULL DEFAULT 0 CHECK(written IN(0,1)),
  pc_volume INTEGER CHECK(pc_volume>=0),mobile_volume INTEGER CHECK(mobile_volume>=0),
  document_count INTEGER CHECK(document_count>=0),measured_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
  UNIQUE(owner_id,phrase_key)
 ) STRICT;
 CREATE INDEX member_keywords_owner ON member_keywords(owner_id,created_at DESC,id);
`};
