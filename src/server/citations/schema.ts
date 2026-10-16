export const citationMigration={
 version:40,
 name:'ai_citation_checks',
 sql:`
  CREATE TABLE citation_runs (
   id TEXT PRIMARY KEY NOT NULL,
   owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
   blog_id TEXT NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
   state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','succeeded','failed','canceled')),
   source TEXT NOT NULL CHECK(source IN ('member','scan')),
   provider TEXT NOT NULL CHECK(length(provider) BETWEEN 1 AND 30),
   post_limit INTEGER NOT NULL CHECK(post_limit BETWEEN 1 AND 30),
   checked INTEGER NOT NULL DEFAULT 0 CHECK(checked>=0),
   searches INTEGER NOT NULL DEFAULT 0 CHECK(searches>=0),
   progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
   attempt INTEGER NOT NULL DEFAULT 0 CHECK(attempt>=0),
   max_attempts INTEGER NOT NULL DEFAULT 3 CHECK(max_attempts BETWEEN 1 AND 5),
   lease_owner TEXT CHECK(lease_owner IS NULL OR length(lease_owner)<=100),
   lease_until INTEGER,
   run_after INTEGER NOT NULL,
   cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0,1)),
   idempotency_key TEXT CHECK(idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 100),
   error_code TEXT CHECK(error_code IS NULL OR length(error_code)<=60),
   error_message TEXT CHECK(error_message IS NULL OR length(error_message)<=500),
   created_at INTEGER NOT NULL,
   updated_at INTEGER NOT NULL,
   completed_at INTEGER,
   UNIQUE(owner_id,idempotency_key),
   CHECK(state<>'running' OR (lease_owner IS NOT NULL AND lease_until IS NOT NULL))
  ) STRICT;
  CREATE UNIQUE INDEX citation_runs_one_active ON citation_runs(blog_id) WHERE state IN ('queued','running');
  CREATE INDEX citation_runs_claim ON citation_runs(state,run_after);
  CREATE INDEX citation_runs_owner ON citation_runs(owner_id,created_at DESC);
  CREATE INDEX citation_runs_blog ON citation_runs(blog_id,state,completed_at DESC);
  CREATE TABLE citation_results (
   id TEXT PRIMARY KEY NOT NULL,
   run_id TEXT NOT NULL REFERENCES citation_runs(id) ON DELETE CASCADE,
   owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
   blog_id TEXT NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
   post_id TEXT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
   keyword TEXT NOT NULL CHECK(length(keyword) BETWEEN 1 AND 60),
   keyword_source TEXT NOT NULL CHECK(keyword_source IN ('member','tag','title')),
   status TEXT NOT NULL CHECK(status IN ('checked','error')),
   briefing INTEGER NOT NULL CHECK(briefing IN (0,1)),
   exposed INTEGER NOT NULL CHECK(exposed IN (0,1)),
   text_rank INTEGER CHECK(text_rank IS NULL OR text_rank BETWEEN 1 AND 100),
   image_rank INTEGER CHECK(image_rank IS NULL OR image_rank BETWEEN 1 AND 100),
   evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json) AND json_type(evidence_json)='object' AND length(evidence_json)<=120000),
   checked_at INTEGER NOT NULL,
   viewed_at INTEGER,
   UNIQUE(run_id,post_id),
   CHECK(status='checked' OR (briefing=0 AND exposed=0 AND text_rank IS NULL AND image_rank IS NULL)),
   CHECK(briefing=1 OR (text_rank IS NULL AND image_rank IS NULL))
  ) STRICT;
  CREATE INDEX citation_results_run ON citation_results(run_id,checked_at);
  CREATE INDEX citation_results_viewed ON citation_results(owner_id,viewed_at);
  CREATE TABLE post_keywords (
   post_id TEXT PRIMARY KEY NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
   owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
   keyword TEXT NOT NULL CHECK(length(keyword) BETWEEN 1 AND 60),
   version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
   updated_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX post_keywords_owner ON post_keywords(owner_id);
 `,
} as const;
