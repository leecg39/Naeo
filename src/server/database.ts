import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, existsSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { migrations } from './migrations';

export type Database = DatabaseSync;

export function transaction<T>(db: Database, action: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    if (result instanceof Promise) throw new Error('Database transactions must be synchronous');
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function openDatabase(filename: string): Database {
  const path = filename === ':memory:' ? filename : existsSync(filename)?realpathSync(filename):resolve(filename);
  if(path!==':memory:'&&existsSync(path+'.restore-pending.json')) throw new Error('Restore recovery is required before opening this database; stop all writers and run restore --offline --recover');
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  try {
    if (path !== ':memory:') chmodSync(path, 0o600);
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL
    ) STRICT;`);
    transaction(db, () => {
      const installed = db.prepare('SELECT version,checksum FROM schema_migrations ORDER BY version').all() as {version:number;checksum:string}[];
      if (installed.some(row=>!migrations.some(m=>m.version===row.version))) throw new Error('Database schema is newer than this application');
      for (const migration of migrations) {
        const checksum = createHash('sha256').update(migration.sql).digest('hex');
        const existing = installed.find(row=>row.version===migration.version);
        if (existing) {
          if (existing.checksum !== checksum) throw new Error(`Migration ${migration.version} checksum mismatch`);
          continue;
        }
        db.exec(migration.sql);
        db.prepare('INSERT INTO schema_migrations VALUES(?,?,?,?)').run(migration.version,migration.name,checksum,Date.now());
      }
    });
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

const globalDatabase = globalThis as typeof globalThis & { naeoDatabase?: Database };
export function database(): Database {
  return globalDatabase.naeoDatabase ??= openDatabase(process.env.NAEO_DATABASE_PATH || 'var/naeo.sqlite');
}
