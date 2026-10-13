import type {Database} from '../database';

/** Invoke inside the account mutation transaction so old grants cannot survive a security change. */
export function revokeUserGrants(db:Database,userId:string,now=Date.now()){
 db.prepare('DELETE FROM oauth_codes WHERE user_id=?').run(userId);
 db.prepare('DELETE FROM oauth_states WHERE user_id=?').run(userId);
 db.prepare('UPDATE oauth_tokens SET revoked_at=coalesce(revoked_at,?) WHERE user_id=?').run(now,userId);
}
