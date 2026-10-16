export const openAIConnectionMigration={
 version:38,
 name:'openai_member_connections',
 sql:`
  CREATE TABLE openai_connections (
   id TEXT PRIMARY KEY NOT NULL,
   user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
   issuer TEXT NOT NULL CHECK(length(issuer) BETWEEN 8 AND 200),
   subject TEXT NOT NULL CHECK(length(subject) BETWEEN 1 AND 200),
   client_id TEXT NOT NULL CHECK(length(client_id) BETWEEN 8 AND 200),
   email TEXT NOT NULL DEFAULT '' CHECK(length(email)<=254),
   display_name TEXT NOT NULL DEFAULT '' CHECK(length(display_name)<=100),
   scope TEXT NOT NULL CHECK(length(scope) BETWEEN 1 AND 500),
   access_token_encrypted TEXT NOT NULL,
   refresh_token_encrypted TEXT NOT NULL,
   id_token_encrypted TEXT NOT NULL,
   access_expires_at INTEGER NOT NULL,
   earliest_refresh_at INTEGER,
   revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
   token_version INTEGER NOT NULL DEFAULT 1 CHECK(token_version>0),
   refresh_started_at INTEGER,
   connected_at INTEGER NOT NULL,
   updated_at INTEGER NOT NULL,
   last_refreshed_at INTEGER,
   UNIQUE(issuer,subject)
  ) STRICT;
  CREATE INDEX openai_connections_expiry ON openai_connections(access_expires_at);
  CREATE TABLE openai_connection_states (
   state_hash TEXT PRIMARY KEY NOT NULL CHECK(length(state_hash)=64),
   user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
   binding_hash TEXT NOT NULL CHECK(length(binding_hash)=64),
   code_verifier TEXT NOT NULL CHECK(length(code_verifier) BETWEEN 43 AND 128),
   nonce TEXT NOT NULL CHECK(length(nonce) BETWEEN 16 AND 100),
   redirect_uri TEXT NOT NULL CHECK(length(redirect_uri)<=500),
   expires_at INTEGER NOT NULL,
   created_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX openai_connection_states_user ON openai_connection_states(user_id,expires_at);
 `,
} as const;

export const openAIGenerationMigration={
 version:39,
 name:'openai_generation_credentials',
 sql:`
  ALTER TABLE openai_connections ADD COLUMN refresh_lease TEXT CHECK(refresh_lease IS NULL OR length(refresh_lease)=36);
  ALTER TABLE generation_jobs ADD COLUMN credential_revision INTEGER CHECK(credential_revision IS NULL OR credential_revision>0);
 `,
} as const;
