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
}, {
  version: 3,
  name: 'content_articles',
  sql: `
    CREATE TABLE article_categories (
      id TEXT PRIMARY KEY NOT NULL,
      slug TEXT NOT NULL UNIQUE CHECK(length(slug) BETWEEN 1 AND 40 AND slug NOT GLOB '*[^a-z0-9-]*'),
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 30),
      sort_order INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE articles (
      id TEXT PRIMARY KEY NOT NULL,
      category_id TEXT NOT NULL REFERENCES article_categories(id) ON DELETE RESTRICT,
      slug TEXT NOT NULL CHECK(length(slug) BETWEEN 1 AND 80 AND slug NOT GLOB '*[^a-z0-9-]*'),
      title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
      summary TEXT NOT NULL DEFAULT '' CHECK(length(summary)<=500),
      show_summary INTEGER NOT NULL DEFAULT 1 CHECK(show_summary IN (0,1)),
      body_markdown TEXT NOT NULL DEFAULT '' CHECK(length(body_markdown)<=200000),
      tags_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags_json) AND json_type(tags_json)='array'),
      cover_image TEXT NOT NULL DEFAULT '' CHECK(length(cover_image)<=300),
      featured INTEGER NOT NULL DEFAULT 0 CHECK(featured IN (0,1)),
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
      published_at INTEGER,
      read_minutes INTEGER NOT NULL DEFAULT 1 CHECK(read_minutes BETWEEN 1 AND 600),
      position INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(category_id,slug),
      CHECK(status<>'published' OR published_at IS NOT NULL)
    ) STRICT;
    CREATE INDEX articles_public ON articles(status,published_at DESC,position);
    CREATE TABLE content_revisions (
      id TEXT PRIMARY KEY NOT NULL,
      resource_type TEXT NOT NULL CHECK(resource_type IN ('article','category')),
      resource_id TEXT NOT NULL,
      version INTEGER NOT NULL CHECK(version>0),
      snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
      author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(resource_type,resource_id,version)
    ) STRICT;
    CREATE TRIGGER articles_delete_revisions AFTER DELETE ON articles BEGIN
      DELETE FROM content_revisions WHERE resource_type='article' AND resource_id=old.id;
    END;
    CREATE TABLE seed_runs (
      name TEXT PRIMARY KEY NOT NULL,
      applied_at INTEGER NOT NULL
    ) STRICT;
  `,
}, {
  version: 4,
  name: 'inquiries',
  sql: `
    CREATE TABLE inquiries (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL CHECK(length(email) BETWEEN 3 AND 254),
      type TEXT NOT NULL CHECK(type IN ('service','technical','business','partnership','etc')),
      subject TEXT NOT NULL DEFAULT '' CHECK(length(subject)<=200),
      message TEXT NOT NULL CHECK(length(message) BETWEEN 1 AND 5000),
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','answered','closed')),
      answered_at INTEGER,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX inquiries_owner ON inquiries(owner_id,created_at);
    CREATE INDEX inquiries_status ON inquiries(status,created_at);
    CREATE TABLE inquiry_messages (
      id TEXT PRIMARY KEY NOT NULL,
      inquiry_id TEXT NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
      author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 10000),
      delivery TEXT NOT NULL DEFAULT 'not_configured' CHECK(delivery IN ('not_configured','sent','failed')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX inquiry_messages_inquiry ON inquiry_messages(inquiry_id,created_at);
    CREATE TABLE inquiry_templates (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE CHECK(length(name) BETWEEN 1 AND 60),
      subject TEXT NOT NULL DEFAULT '' CHECK(length(subject)<=200),
      body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 10000),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
  `,
}, {
  version: 5,
  name: 'site_documents',
  sql: `
    DROP TRIGGER articles_delete_revisions;
    CREATE TABLE content_revisions_v5 (
      id TEXT PRIMARY KEY NOT NULL,
      resource_type TEXT NOT NULL CHECK(resource_type IN ('article','category','document','faq','update','announcement')),
      resource_id TEXT NOT NULL,
      version INTEGER NOT NULL CHECK(version>0),
      snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
      author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(resource_type,resource_id,version)
    ) STRICT;
    INSERT INTO content_revisions_v5 SELECT id,resource_type,resource_id,version,snapshot_json,author_id,created_at FROM content_revisions;
    DROP TABLE content_revisions;
    ALTER TABLE content_revisions_v5 RENAME TO content_revisions;
    CREATE TRIGGER articles_delete_revisions AFTER DELETE ON articles BEGIN
      DELETE FROM content_revisions WHERE resource_type='article' AND resource_id=old.id;
    END;
    CREATE TABLE site_documents (
      id TEXT PRIMARY KEY NOT NULL,
      path TEXT NOT NULL UNIQUE CHECK(length(path) BETWEEN 2 AND 80 AND path GLOB '/[a-z0-9]*' AND path NOT GLOB '*[^a-z0-9/-]*'),
      title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
      effective_label TEXT NOT NULL DEFAULT '' CHECK(length(effective_label)<=120),
      body TEXT NOT NULL DEFAULT '' CHECK(length(body)<=100000),
      closing_note TEXT NOT NULL DEFAULT '' CHECK(length(closing_note)<=2000),
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
      position INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE TRIGGER site_documents_delete_revisions AFTER DELETE ON site_documents BEGIN
      DELETE FROM content_revisions WHERE resource_type='document' AND resource_id=old.id;
    END;
  `,
}, {
  version: 6,
  name: 'faq_items',
  sql: `
    CREATE TABLE faq_items (
      id TEXT PRIMARY KEY NOT NULL,
      category TEXT NOT NULL CHECK(length(category) BETWEEN 1 AND 40),
      question TEXT NOT NULL CHECK(length(question) BETWEEN 1 AND 200),
      answer TEXT NOT NULL CHECK(length(answer) BETWEEN 1 AND 5000),
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
      position INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX faq_items_public ON faq_items(status,position);
  `,
}];
