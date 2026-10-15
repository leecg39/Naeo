import {phoneRewardMigration} from './engagement/phone-reward';
import {smsMigration} from './sms/schema';
import {inquiryMailMigration} from './inquiries/mail-schema';
import {accountMailMigration} from './mail/schema';
import {personalExportMigration} from './privacy/schema';
import {engagementMigration} from './engagement/schema';
import {billingRecoveryMigration} from './billing/recovery-schema';
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
}, {
  version: 7,
  name: 'site_updates',
  sql: `
    CREATE TABLE site_updates (
      id TEXT PRIMARY KEY NOT NULL,
      slug TEXT NOT NULL UNIQUE CHECK(length(slug) BETWEEN 1 AND 80 AND slug NOT GLOB '*[^a-z0-9-]*'),
      version_label TEXT NOT NULL DEFAULT '' CHECK(length(version_label)<=20),
      types_json TEXT NOT NULL CHECK(json_valid(types_json) AND json_type(types_json)='array' AND json_array_length(types_json) BETWEEN 1 AND 4),
      title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
      summary TEXT NOT NULL DEFAULT '' CHECK(length(summary)<=500),
      body_markdown TEXT NOT NULL DEFAULT '' CHECK(length(body_markdown)<=200000),
      published_on TEXT NOT NULL CHECK(published_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
      position INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX site_updates_public ON site_updates(status,published_on DESC,position);
  `,
}, {
  version: 8,
  name: 'announcements',
  sql: `
    CREATE TABLE announcements (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 80),
      body TEXT NOT NULL DEFAULT '' CHECK(length(body)<=300),
      link_url TEXT NOT NULL DEFAULT '' CHECK(length(link_url)<=300),
      link_label TEXT NOT NULL DEFAULT '' CHECK(length(link_label)<=30),
      target TEXT NOT NULL DEFAULT 'landing' CHECK(target IN ('landing','all')),
      starts_at INTEGER,
      ends_at INTEGER,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      CHECK(starts_at IS NULL OR ends_at IS NULL OR ends_at>starts_at)
    ) STRICT;
    CREATE INDEX announcements_active ON announcements(status,updated_at DESC);
  `,
}, {
  version: 9,
  name: 'page_settings',
  sql: `
    DROP TRIGGER articles_delete_revisions;
    DROP TRIGGER site_documents_delete_revisions;
    CREATE TABLE content_revisions_v9 (
      id TEXT PRIMARY KEY NOT NULL,
      resource_type TEXT NOT NULL CHECK(resource_type IN ('article','category','document','faq','update','announcement','page')),
      resource_id TEXT NOT NULL,
      version INTEGER NOT NULL CHECK(version>0),
      snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
      author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(resource_type,resource_id,version)
    ) STRICT;
    INSERT INTO content_revisions_v9 SELECT id,resource_type,resource_id,version,snapshot_json,author_id,created_at FROM content_revisions;
    DROP TABLE content_revisions;
    ALTER TABLE content_revisions_v9 RENAME TO content_revisions;
    CREATE TRIGGER articles_delete_revisions AFTER DELETE ON articles BEGIN
      DELETE FROM content_revisions WHERE resource_type='article' AND resource_id=old.id;
    END;
    CREATE TRIGGER site_documents_delete_revisions AFTER DELETE ON site_documents BEGIN
      DELETE FROM content_revisions WHERE resource_type='document' AND resource_id=old.id;
    END;
    CREATE TABLE page_settings (
      id TEXT PRIMARY KEY NOT NULL,
      path TEXT NOT NULL UNIQUE CHECK(path IN ('/features','/guide/writing','/guide/extension-publish')),
      title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
      description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=300),
      status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','hidden')),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
      updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
  `,
}, {
  version: 10,
  name: 'scan_jobs',
  sql: `
    CREATE TABLE blog_posts (
      id TEXT PRIMARY KEY NOT NULL,
      blog_id TEXT NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
      external_id TEXT NOT NULL CHECK(length(external_id) BETWEEN 1 AND 100),
      url TEXT NOT NULL CHECK(length(url) BETWEEN 1 AND 500),
      title TEXT NOT NULL CHECK(length(title)<=300),
      excerpt TEXT NOT NULL DEFAULT '' CHECK(length(excerpt)<=2000),
      category TEXT NOT NULL DEFAULT '' CHECK(length(category)<=100),
      tags_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags_json) AND json_type(tags_json)='array'),
      published_at INTEGER,
      collected_at INTEGER NOT NULL,
      UNIQUE(blog_id,external_id)
    ) STRICT;
    CREATE INDEX blog_posts_recent ON blog_posts(blog_id,published_at DESC);
    CREATE TABLE scan_jobs (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blog_id TEXT NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
      state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','succeeded','failed','canceled')),
      attempt INTEGER NOT NULL DEFAULT 0 CHECK(attempt>=0),
      max_attempts INTEGER NOT NULL DEFAULT 3 CHECK(max_attempts BETWEEN 1 AND 10),
      progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
      lease_owner TEXT CHECK(lease_owner IS NULL OR length(lease_owner)<=100),
      lease_until INTEGER,
      run_after INTEGER NOT NULL,
      cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0,1)),
      idempotency_key TEXT CHECK(idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 100),
      retry_of TEXT REFERENCES scan_jobs(id) ON DELETE SET NULL,
      error_code TEXT CHECK(error_code IS NULL OR length(error_code)<=60),
      error_message TEXT CHECK(error_message IS NULL OR length(error_message)<=500),
      result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      UNIQUE(owner_id,idempotency_key),
      CHECK(state<>'running' OR (lease_owner IS NOT NULL AND lease_until IS NOT NULL))
    ) STRICT;
    CREATE UNIQUE INDEX scan_jobs_one_active ON scan_jobs(blog_id) WHERE state IN ('queued','running');
    CREATE INDEX scan_jobs_claim ON scan_jobs(state,run_after);
    CREATE INDEX scan_jobs_owner ON scan_jobs(owner_id,created_at DESC);
    CREATE TABLE worker_heartbeats (
      worker_id TEXT PRIMARY KEY NOT NULL CHECK(length(worker_id) BETWEEN 1 AND 100),
      started_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      processed INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0
    ) STRICT;
  `,
}, {
  version: 11,
  name: 'scan_results',
  sql: `
    CREATE TABLE scan_results (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blog_id TEXT NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
      job_id TEXT UNIQUE REFERENCES scan_jobs(id) ON DELETE SET NULL,
      score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 100),
      method_version TEXT NOT NULL CHECK(length(method_version) BETWEEN 1 AND 40),
      report_json TEXT NOT NULL CHECK(json_valid(report_json)),
      post_count INTEGER NOT NULL CHECK(post_count>=0),
      measured_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX scan_results_blog ON scan_results(blog_id,measured_at DESC);
  `,
}, {
  version: 12,
  name: 'mate_reports',
  sql: `
    CREATE TABLE mate_reports (
      token TEXT PRIMARY KEY NOT NULL CHECK(length(token)=22),
      owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      naver_id TEXT NOT NULL CHECK(length(naver_id) BETWEEN 2 AND 50),
      score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 100),
      report_json TEXT NOT NULL CHECK(json_valid(report_json)),
      post_count INTEGER NOT NULL CHECK(post_count>=0),
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL CHECK(expires_at>created_at)
    ) STRICT;
    CREATE INDEX mate_reports_owner ON mate_reports(owner_id,created_at DESC);
    CREATE INDEX mate_reports_expiry ON mate_reports(expires_at);
  `,
}, {
  version: 13,
  name: 'keywords',
  sql: `
    CREATE TABLE keywords (
      id TEXT PRIMARY KEY NOT NULL,
      phrase TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK(length(phrase) BETWEEN 1 AND 60),
      category TEXT NOT NULL DEFAULT '' CHECK(length(category)<=30),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','hidden')),
      note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=200),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX keywords_active ON keywords(status,created_at DESC);
    CREATE TABLE keyword_metrics (
      id TEXT PRIMARY KEY NOT NULL,
      keyword_id TEXT NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
      pc_volume INTEGER NOT NULL CHECK(pc_volume>=0),
      mobile_volume INTEGER NOT NULL CHECK(mobile_volume>=0),
      document_count INTEGER NOT NULL CHECK(document_count>=0),
      source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','naver_searchad')),
      measured_at INTEGER NOT NULL,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX keyword_metrics_latest ON keyword_metrics(keyword_id,measured_at DESC);
    CREATE TABLE saved_keywords (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      keyword_id TEXT NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('saved','written')),
      note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=500),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(owner_id,keyword_id)
    ) STRICT;
  `,
}, {
  version: 14,
  name: 'competitors_actions',
  sql: `
    CREATE TABLE competitor_blogs (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      naver_id TEXT NOT NULL CHECK(length(naver_id) BETWEEN 2 AND 50),
      note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=500),
      snapshot_json TEXT CHECK(snapshot_json IS NULL OR json_valid(snapshot_json)),
      last_collected_at INTEGER,
      last_attempt_at INTEGER,
      last_error TEXT CHECK(last_error IS NULL OR length(last_error)<=60),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(owner_id,naver_id)
    ) STRICT;
    CREATE TABLE action_items (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      result_id TEXT NOT NULL REFERENCES scan_results(id) ON DELETE CASCADE,
      criterion TEXT NOT NULL CHECK(criterion IN ('cadence','recency','titles','tags','topic')),
      title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done')),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(result_id,criterion)
    ) STRICT;
    CREATE INDEX action_items_owner ON action_items(owner_id,created_at DESC);
  `,
}, {
  version: 15,
  name: 'drafts_media',
  sql: `
    CREATE TABLE drafts (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
      keyword TEXT NOT NULL DEFAULT '' CHECK(length(keyword)<=60),
      category TEXT NOT NULL DEFAULT '' CHECK(length(category)<=30),
      body TEXT NOT NULL DEFAULT '' CHECK(length(body)<=100000),
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','ready','published','archived')),
      published_at INTEGER,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX drafts_owner ON drafts(owner_id,updated_at DESC);
    CREATE TABLE draft_revisions (
      id TEXT PRIMARY KEY NOT NULL,
      draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
      version INTEGER NOT NULL CHECK(version>0),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(draft_id,version)
    ) STRICT;
    CREATE TABLE media_files (
      id TEXT PRIMARY KEY NOT NULL,
      public_id TEXT NOT NULL UNIQUE CHECK(length(public_id)=22),
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      draft_id TEXT REFERENCES drafts(id) ON DELETE SET NULL,
      mime TEXT NOT NULL CHECK(mime IN ('image/jpeg','image/png','image/webp')),
      size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 10485760),
      storage_key TEXT NOT NULL UNIQUE CHECK(length(storage_key) BETWEEN 10 AND 80),
      original_name TEXT NOT NULL DEFAULT '' CHECK(length(original_name)<=120),
      source TEXT NOT NULL DEFAULT 'upload' CHECK(source IN ('upload','ai')),
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX media_owner ON media_files(owner_id,created_at DESC);
    CREATE INDEX media_draft ON media_files(draft_id);
    CREATE TABLE share_links (
      token TEXT PRIMARY KEY NOT NULL CHECK(length(token)=22),
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      created_at INTEGER NOT NULL,
      CHECK(expires_at>created_at)
    ) STRICT;
    CREATE INDEX share_links_draft ON share_links(draft_id);
  `,
}, {
  version: 16,
  name: 'credits_generation',
  sql: `
    CREATE TABLE credit_ledger (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      delta INTEGER NOT NULL CHECK(delta<>0 AND delta BETWEEN -1000000 AND 1000000),
      reason TEXT NOT NULL CHECK(reason IN ('grant','generation','refund','adjust')),
      ref_type TEXT NOT NULL DEFAULT '' CHECK(length(ref_type)<=30),
      ref_id TEXT NOT NULL DEFAULT '' CHECK(length(ref_id)<=60),
      note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=200),
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX credit_ledger_once ON credit_ledger(ref_type,ref_id,reason) WHERE ref_id<>'';
    CREATE INDEX credit_ledger_owner ON credit_ledger(owner_id,created_at DESC);
    CREATE TABLE generation_jobs (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      draft_id TEXT REFERENCES drafts(id) ON DELETE SET NULL,
      state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','succeeded','failed','canceled')),
      cost INTEGER NOT NULL CHECK(cost>=0),
      input_json TEXT NOT NULL CHECK(json_valid(input_json)),
      provider TEXT NOT NULL CHECK(length(provider) BETWEEN 1 AND 30),
      model TEXT NOT NULL CHECK(length(model) BETWEEN 1 AND 80),
      idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 100),
      attempt INTEGER NOT NULL DEFAULT 0 CHECK(attempt>=0),
      max_attempts INTEGER NOT NULL DEFAULT 2 CHECK(max_attempts BETWEEN 1 AND 5),
      lease_owner TEXT,
      lease_until INTEGER,
      run_after INTEGER NOT NULL,
      cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0,1)),
      error_code TEXT CHECK(error_code IS NULL OR length(error_code)<=60),
      error_message TEXT CHECK(error_message IS NULL OR length(error_message)<=500),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER,
      UNIQUE(owner_id,idempotency_key)
    ) STRICT;
    CREATE INDEX generation_jobs_claim ON generation_jobs(state,run_after);
    CREATE INDEX generation_jobs_owner ON generation_jobs(owner_id,created_at DESC);
  `,
}, {
  version: 17,
  name: 'writing_templates',
  sql: `
    CREATE TABLE writing_templates (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK(length(name) BETWEEN 1 AND 60),
      category TEXT NOT NULL DEFAULT '' CHECK(length(category)<=30),
      guidance TEXT NOT NULL CHECK(length(guidance) BETWEEN 1 AND 2000),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','hidden')),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
  `,
}, {
  version: 18,
  name: 'ranking_snapshots',
  sql: `
    CREATE TABLE ranking_periods (
      period_type TEXT NOT NULL CHECK(period_type IN ('week','month')),
      period_key TEXT NOT NULL CHECK(length(period_key) BETWEEN 7 AND 10),
      starts_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL CHECK(ends_at>starts_at),
      entries INTEGER NOT NULL CHECK(entries>=0),
      confirmed_at INTEGER NOT NULL,
      PRIMARY KEY(period_type,period_key)
    ) STRICT;
    CREATE TABLE ranking_snapshots (
      period_type TEXT NOT NULL,
      period_key TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      nickname TEXT NOT NULL,
      naver_id TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      rank INTEGER NOT NULL CHECK(rank>0),
      score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 100),
      total INTEGER NOT NULL CHECK(total>0),
      measured_at INTEGER NOT NULL,
      criteria_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(criteria_json)),
      PRIMARY KEY(period_type,period_key,user_id),
      FOREIGN KEY(period_type,period_key) REFERENCES ranking_periods(period_type,period_key) ON DELETE CASCADE
    ) STRICT;
    CREATE INDEX ranking_snapshots_rank ON ranking_snapshots(period_type,period_key,rank);
    CREATE INDEX ranking_snapshots_user ON ranking_snapshots(user_id);
  `,
}, {
  version: 19,
  name: 'events_rewards',
  sql: `
    CREATE TABLE events (
      id TEXT PRIMARY KEY NOT NULL,
      slug TEXT NOT NULL UNIQUE CHECK(length(slug) BETWEEN 2 AND 60),
      title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
      summary TEXT NOT NULL DEFAULT '' CHECK(length(summary)<=300),
      body TEXT NOT NULL DEFAULT '' CHECK(length(body)<=20000),
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','closed')),
      starts_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL CHECK(ends_at>starts_at),
      requires_proof INTEGER NOT NULL DEFAULT 1 CHECK(requires_proof IN (0,1)),
      reward_tokens INTEGER NOT NULL DEFAULT 0 CHECK(reward_tokens BETWEEN 0 AND 10000),
      accepts_entries INTEGER NOT NULL DEFAULT 1 CHECK(accepts_entries IN (0,1)),
      cta_label TEXT NOT NULL DEFAULT '' CHECK(length(cta_label)<=40),
      cta_href TEXT NOT NULL DEFAULT '' CHECK(cta_href='' OR (substr(cta_href,1,1)='/' AND substr(cta_href,2,1)<>'/' AND length(cta_href)<=200)),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE event_entries (
      id TEXT PRIMARY KEY NOT NULL,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      proof_url TEXT NOT NULL DEFAULT '' CHECK(length(proof_url)<=300),
      note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=500),
      status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','approved','rejected','withdrawn')),
      review_note TEXT NOT NULL DEFAULT '' CHECK(length(review_note)<=300),
      reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at INTEGER,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX event_entries_one ON event_entries(event_id,user_id) WHERE status<>'withdrawn';
    CREATE INDEX event_entries_user ON event_entries(user_id,created_at DESC);
    CREATE TABLE rewards (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('event','ranking','manual','gift')),
      tokens INTEGER NOT NULL CHECK((kind='gift' AND tokens=0) OR (kind<>'gift' AND tokens BETWEEN 1 AND 100000)),
      item TEXT NOT NULL DEFAULT '' CHECK(length(item)<=100 AND (kind<>'gift' OR length(item)>0)),
      description TEXT NOT NULL CHECK(length(description) BETWEEN 1 AND 200),
      event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
      source_key TEXT CHECK(source_key IS NULL OR length(source_key)<=120),
      entry_id TEXT REFERENCES event_entries(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'granted' CHECK(status IN ('granted','revoked')),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
      granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      revoked_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      revoked_at INTEGER
    ) STRICT;
    CREATE UNIQUE INDEX rewards_once ON rewards(source_key) WHERE source_key IS NOT NULL AND status='granted';
    CREATE INDEX rewards_user ON rewards(user_id,created_at DESC);
    CREATE INDEX rewards_event ON rewards(event_id,created_at DESC);
  `,
}, {
  version: 20,
  name: 'billing',
  sql: `
    CREATE TABLE credit_ledger_v20 (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      delta INTEGER NOT NULL CHECK(delta<>0 AND delta BETWEEN -1000000 AND 1000000),
      reason TEXT NOT NULL CHECK(reason IN ('grant','generation','refund','adjust','subscription','expire','coupon')),
      ref_type TEXT NOT NULL DEFAULT '' CHECK(length(ref_type)<=30),
      ref_id TEXT NOT NULL DEFAULT '' CHECK(length(ref_id)<=60),
      note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=200),
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL
    ) STRICT;
    INSERT INTO credit_ledger_v20 SELECT id,owner_id,delta,reason,ref_type,ref_id,note,created_by,created_at FROM credit_ledger;
    DROP TABLE credit_ledger;
    ALTER TABLE credit_ledger_v20 RENAME TO credit_ledger;
    CREATE UNIQUE INDEX credit_ledger_once ON credit_ledger(ref_type,ref_id,reason) WHERE ref_id<>'';
    CREATE INDEX credit_ledger_owner ON credit_ledger(owner_id,created_at DESC);
    CREATE TABLE plans (
      id TEXT PRIMARY KEY NOT NULL,
      code TEXT NOT NULL UNIQUE CHECK(length(code) BETWEEN 2 AND 30),
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 40),
      description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=300),
      price_krw INTEGER NOT NULL CHECK(price_krw BETWEEN 0 AND 10000000),
      monthly_tokens INTEGER NOT NULL DEFAULT 0 CHECK(monthly_tokens BETWEEN 0 AND 1000000),
      trial_days INTEGER NOT NULL DEFAULT 0 CHECK(trial_days BETWEEN 0 AND 30),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','hidden')),
      position INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE coupons (
      id TEXT PRIMARY KEY NOT NULL,
      code TEXT NOT NULL UNIQUE CHECK(length(code) BETWEEN 4 AND 32),
      kind TEXT NOT NULL CHECK(kind IN ('tokens','percent_off','amount_off')),
      value INTEGER NOT NULL CHECK(value>0 AND (kind<>'percent_off' OR value<=100)),
      plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
      max_redemptions INTEGER CHECK(max_redemptions IS NULL OR max_redemptions>0),
      starts_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL CHECK(ends_at>starts_at),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
      note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=200),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE coupon_redemptions (
      id TEXT PRIMARY KEY NOT NULL,
      coupon_id TEXT NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      status TEXT NOT NULL CHECK(status IN ('reserved','used','released')),
      payment_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX coupon_redemptions_once ON coupon_redemptions(coupon_id,user_id) WHERE status<>'released';
    CREATE TABLE subscriptions (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_id TEXT NOT NULL REFERENCES plans(id),
      status TEXT NOT NULL CHECK(status IN ('trialing','active','canceled','expired')),
      trial INTEGER NOT NULL DEFAULT 0 CHECK(trial IN (0,1)),
      current_period_start INTEGER NOT NULL,
      current_period_end INTEGER NOT NULL CHECK(current_period_end>current_period_start),
      cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK(cancel_at_period_end IN (0,1)),
      period_tokens INTEGER NOT NULL DEFAULT 0 CHECK(period_tokens>=0),
      period_payment_id TEXT,
      renewal_payment_id TEXT,
      ended_at INTEGER,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX subscriptions_live ON subscriptions(user_id) WHERE status IN ('trialing','active');
    CREATE INDEX subscriptions_due ON subscriptions(status,current_period_end);
    CREATE TABLE trial_fingerprints (
      kind TEXT NOT NULL CHECK(kind IN ('user','email','blog')),
      value_hash TEXT NOT NULL CHECK(length(value_hash)=64),
      created_at INTEGER NOT NULL,
      PRIMARY KEY(kind,value_hash)
    ) STRICT;
    CREATE TABLE payments (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      order_id TEXT NOT NULL UNIQUE CHECK(length(order_id) BETWEEN 6 AND 64),
      order_name TEXT NOT NULL CHECK(length(order_name) BETWEEN 1 AND 100),
      plan_id TEXT NOT NULL REFERENCES plans(id),
      list_amount INTEGER NOT NULL CHECK(list_amount>=0),
      amount INTEGER NOT NULL CHECK(amount>=0 AND amount<=list_amount),
      coupon_redemption_id TEXT REFERENCES coupon_redemptions(id) ON DELETE SET NULL,
      provider TEXT NOT NULL CHECK(provider IN ('toss','none')),
      status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','paid','failed','expired','canceled','partial_canceled')),
      payment_key TEXT UNIQUE CHECK(payment_key IS NULL OR length(payment_key)<=200),
      method TEXT NOT NULL DEFAULT '' CHECK(length(method)<=40),
      canceled_amount INTEGER NOT NULL DEFAULT 0 CHECK(canceled_amount BETWEEN 0 AND amount),
      failure_code TEXT NOT NULL DEFAULT '' CHECK(length(failure_code)<=60),
      failure_message TEXT NOT NULL DEFAULT '' CHECK(length(failure_message)<=300),
      subscription_id TEXT REFERENCES subscriptions(id) ON DELETE SET NULL,
      approved_at INTEGER,
      expires_at INTEGER NOT NULL,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX payments_user ON payments(user_id,created_at DESC);
    CREATE TRIGGER payments_immutable_amount BEFORE UPDATE OF order_id,list_amount,amount,plan_id,created_at ON payments BEGIN
      SELECT RAISE(ABORT,'payment amounts are immutable');
    END;
    CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments BEGIN
      SELECT RAISE(ABORT,'payments are accounting records');
    END;
    CREATE TABLE refunds (
      id TEXT PRIMARY KEY NOT NULL,
      payment_id TEXT NOT NULL REFERENCES payments(id),
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      amount INTEGER NOT NULL CHECK(amount>0),
      reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 300),
      status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','approved','rejected','completed','failed')),
      decision_note TEXT NOT NULL DEFAULT '' CHECK(length(decision_note)<=300),
      decided_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      decided_at INTEGER,
      failure_message TEXT NOT NULL DEFAULT '' CHECK(length(failure_message)<=300),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX refunds_open ON refunds(payment_id) WHERE status IN ('requested','approved');
    CREATE TRIGGER refunds_no_delete BEFORE DELETE ON refunds BEGIN
      SELECT RAISE(ABORT,'refunds are accounting records');
    END;
    CREATE TABLE payment_events (
      id TEXT PRIMARY KEY NOT NULL,
      provider TEXT NOT NULL,
      dedupe_key TEXT NOT NULL UNIQUE CHECK(length(dedupe_key)<=300),
      event_type TEXT NOT NULL CHECK(length(event_type)<=60),
      order_id TEXT NOT NULL DEFAULT '',
      result TEXT NOT NULL DEFAULT '' CHECK(length(result)<=60),
      received_at INTEGER NOT NULL
    ) STRICT;
  `,
}, {
  version: 21,
  name: 'oauth_accounts',
  sql: `
    CREATE TABLE oauth_accounts (
      provider TEXT NOT NULL CHECK(provider IN ('google','naver')),
      subject TEXT NOT NULL CHECK(length(subject) BETWEEN 1 AND 200),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL DEFAULT '' CHECK(length(email)<=254),
      created_at INTEGER NOT NULL,
      last_login_at INTEGER,
      PRIMARY KEY(provider,subject),
      UNIQUE(user_id,provider)
    ) STRICT;
    CREATE TABLE oauth_states (
      state_hash TEXT PRIMARY KEY NOT NULL CHECK(length(state_hash)=64),
      provider TEXT NOT NULL CHECK(provider IN ('google','naver')),
      intent TEXT NOT NULL CHECK(intent IN ('login','link')),
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      binding_hash TEXT NOT NULL CHECK(length(binding_hash)=64),
      code_verifier TEXT NOT NULL CHECK(length(code_verifier) BETWEEN 43 AND 128),
      nonce TEXT NOT NULL CHECK(length(nonce) BETWEEN 16 AND 100),
      next TEXT NOT NULL DEFAULT '/dashboard' CHECK(length(next)<=500),
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      CHECK(intent='login' OR user_id IS NOT NULL)
    ) STRICT;
    CREATE INDEX oauth_states_expiry ON oauth_states(expires_at);
  `,
}, {
  version: 22,
  name: 'oauth_server_mcp',
  sql: `
    CREATE TABLE oauth_clients (
      client_id TEXT PRIMARY KEY NOT NULL CHECK(length(client_id) BETWEEN 8 AND 80),
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
      kind TEXT NOT NULL CHECK(kind IN ('mcp','extension')),
      redirect_uris_json TEXT NOT NULL CHECK(json_valid(redirect_uris_json)),
      created_at INTEGER NOT NULL,
      last_used_at INTEGER
    ) STRICT;
    CREATE TABLE oauth_codes (
      code_hash TEXT PRIMARY KEY NOT NULL CHECK(length(code_hash)=64),
      client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      redirect_uri TEXT NOT NULL CHECK(length(redirect_uri)<=500),
      code_challenge TEXT NOT NULL CHECK(length(code_challenge) BETWEEN 43 AND 128),
      scope TEXT NOT NULL CHECK(length(scope)<=200),
      resource TEXT NOT NULL CHECK(length(resource)<=300),
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE oauth_tokens (
      token_hash TEXT PRIMARY KEY NOT NULL CHECK(length(token_hash)=64),
      kind TEXT NOT NULL CHECK(kind IN ('access','refresh')),
      client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scope TEXT NOT NULL CHECK(length(scope)<=200),
      resource TEXT NOT NULL CHECK(length(resource)<=300),
      family_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      last_used_at INTEGER,
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX oauth_tokens_user ON oauth_tokens(user_id,client_id);
    CREATE INDEX oauth_tokens_family ON oauth_tokens(family_id);
    CREATE TABLE mcp_calls (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL,
      tool TEXT NOT NULL CHECK(length(tool)<=60),
      ok INTEGER NOT NULL CHECK(ok IN (0,1)),
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX mcp_calls_user ON mcp_calls(user_id,created_at DESC);
  `,
}, {
  version: 23,
  name: 'creative_projects',
  sql: `
    CREATE TABLE creative_projects (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('carousel','ad','video')),
      title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
      width INTEGER NOT NULL CHECK(width BETWEEN 320 AND 3840),
      height INTEGER NOT NULL CHECK(height BETWEEN 320 AND 3840),
      theme_json TEXT NOT NULL CHECK(json_valid(theme_json)),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX creative_projects_owner ON creative_projects(owner_id,updated_at DESC);
    CREATE TABLE creative_slides (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES creative_projects(id) ON DELETE CASCADE,
      position INTEGER NOT NULL CHECK(position>=0),
      heading TEXT NOT NULL DEFAULT '' CHECK(length(heading)<=120),
      body TEXT NOT NULL DEFAULT '' CHECK(length(body)<=600),
      caption TEXT NOT NULL DEFAULT '' CHECK(length(caption)<=80),
      background TEXT NOT NULL DEFAULT '' CHECK(background='' OR background GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(project_id,position)
    ) STRICT;
  `,
}, {
  version: 24,
  name: 'creative_exports',
  sql: `
    CREATE TABLE export_jobs (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES creative_projects(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      format TEXT NOT NULL CHECK(format IN ('pdf','zip')),
      state TEXT NOT NULL DEFAULT 'collecting' CHECK(state IN ('collecting','succeeded','failed')),
      slide_count INTEGER NOT NULL CHECK(slide_count BETWEEN 1 AND 20),
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      error TEXT NOT NULL DEFAULT '' CHECK(length(error)<=300),
      file_key TEXT CHECK(file_key IS NULL OR length(file_key)<=60),
      file_size INTEGER,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX export_jobs_project ON export_jobs(project_id,created_at DESC);
    CREATE INDEX export_jobs_expiry ON export_jobs(expires_at);
    CREATE TABLE export_pages (
      job_id TEXT NOT NULL REFERENCES export_jobs(id) ON DELETE CASCADE,
      position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 19),
      storage_key TEXT NOT NULL CHECK(length(storage_key)<=60),
      size INTEGER NOT NULL,
      PRIMARY KEY(job_id,position)
    ) STRICT;
  `,
}, {
  version: 25,
  name: 'analytics_ops',
  sql: `
    CREATE TABLE page_views (
      id TEXT PRIMARY KEY NOT NULL,
      day TEXT NOT NULL CHECK(length(day)=10),
      path TEXT NOT NULL CHECK(length(path) BETWEEN 1 AND 200),
      visitor_hash TEXT NOT NULL CHECK(length(visitor_hash)=64),
      referrer_host TEXT NOT NULL DEFAULT '' CHECK(length(referrer_host)<=100),
      dwell_ms INTEGER CHECK(dwell_ms IS NULL OR dwell_ms BETWEEN 0 AND 1800000),
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX page_views_day ON page_views(day,path);
    CREATE TABLE page_stats (
      day TEXT NOT NULL,
      path TEXT NOT NULL,
      views INTEGER NOT NULL CHECK(views>=0),
      visitors INTEGER NOT NULL CHECK(visitors>=0),
      dwell_total_ms INTEGER NOT NULL DEFAULT 0,
      dwell_samples INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(day,path)
    ) STRICT;
    CREATE TABLE referrer_stats (
      day TEXT NOT NULL,
      host TEXT NOT NULL,
      views INTEGER NOT NULL,
      PRIMARY KEY(day,host)
    ) STRICT;
    CREATE TABLE analytics_salts (
      day TEXT PRIMARY KEY NOT NULL,
      salt TEXT NOT NULL CHECK(length(salt)=64)
    ) STRICT;
  `,
}, {
  version: 26,
  name: 'durable_media_deletion',
  sql: `
    CREATE TABLE media_deletions (
      storage_key TEXT PRIMARY KEY NOT NULL,
      queued_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
      last_attempt_at INTEGER,
      last_error_code TEXT NOT NULL DEFAULT ''
    ) STRICT;
    CREATE TRIGGER media_delete_file AFTER DELETE ON media_files BEGIN
      INSERT INTO media_deletions(storage_key) VALUES(OLD.storage_key) ON CONFLICT DO NOTHING;
    END;
  `,
}, engagementMigration,billingRecoveryMigration,personalExportMigration,accountMailMigration,inquiryMailMigration,smsMigration,phoneRewardMigration];

