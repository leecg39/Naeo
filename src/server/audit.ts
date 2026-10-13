import { randomUUID } from 'node:crypto';
import type { Database } from './database';

export function audit(db: Database, actorId: string | null, action: string, entityType: string, entityId: string, metadata: Record<string,unknown> = {}) {
  db.prepare('INSERT INTO audit_logs VALUES(?,?,?,?,?,?,?)').run(randomUUID(),actorId,action,entityType,entityId,JSON.stringify(metadata),Date.now());
}
