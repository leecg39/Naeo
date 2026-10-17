export const recommendationDiscoveryMigration={version:48,name:'member_recommendation_discovery',sql:`
 CREATE TABLE member_recommendations (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blog_id TEXT NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
  phrase TEXT NOT NULL CHECK(length(phrase) BETWEEN 1 AND 60),phrase_key TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',signal TEXT NOT NULL CHECK(signal IN('new','revisit','rewritten','opportunity')),
  score REAL NOT NULL DEFAULT 0,reason TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN('blog_analysis','citation','catalog','naver_searchad')),
  source_post_id TEXT REFERENCES blog_posts(id) ON DELETE SET NULL,
  pc_volume INTEGER CHECK(pc_volume>=0),mobile_volume INTEGER CHECK(mobile_volume>=0),document_count INTEGER CHECK(document_count>=0),measured_at INTEGER,
  history_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(history_json)),related_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(related_json)),
  competition_json TEXT NOT NULL DEFAULT '{"blogs":[],"news":[],"checkedAt":null,"error":null}' CHECK(json_valid(competition_json)),
  written INTEGER NOT NULL DEFAULT 0 CHECK(written IN(0,1)),dismissed INTEGER NOT NULL DEFAULT 0 CHECK(dismissed IN(0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),recommended_at INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
  UNIQUE(owner_id,blog_id,phrase_key)
 ) STRICT;
 CREATE INDEX member_recommendations_owner ON member_recommendations(owner_id,blog_id,recommended_at DESC);
 CREATE TABLE recommendation_builds (
  id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blog_id TEXT NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK(state IN('running','succeeded','failed')),
  source TEXT NOT NULL CHECK(source IN('local','refresh')),new_count INTEGER NOT NULL DEFAULT 0 CHECK(new_count>=0),
  started_at INTEGER NOT NULL,completed_at INTEGER,lease_until INTEGER NOT NULL,error_message TEXT,
  notice TEXT
 ) STRICT;
 CREATE UNIQUE INDEX recommendation_builds_one_running ON recommendation_builds(owner_id) WHERE state='running';
 CREATE INDEX recommendation_builds_quota ON recommendation_builds(owner_id,state,started_at DESC);
`};
