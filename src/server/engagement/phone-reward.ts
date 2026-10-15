import {createHash,createHmac} from 'node:crypto';
import type {Database} from '../database';
import {normalizedPhone} from '../sms/provider';
import {AppError} from '../errors';
export const phoneRewardMigration={version:33,name:'verified_phone_reward_identity',sql:`
 CREATE TABLE verified_phones (
 user_id TEXT PRIMARY KEY NOT NULL REFERENCES contact_details(user_id) ON DELETE CASCADE,
 phone TEXT NOT NULL, verified_at INTEGER NOT NULL
 ) STRICT;
 CREATE TRIGGER phone_proof_changed AFTER UPDATE OF phone,phone_verified_at ON contact_details
 WHEN OLD.phone<>NEW.phone OR NEW.phone_verified_at IS NULL BEGIN
 DELETE FROM verified_phones WHERE user_id=NEW.user_id; END;
 CREATE TABLE phone_reward_key (id INTEGER PRIMARY KEY CHECK(id=1),digest TEXT NOT NULL CHECK(length(digest)=64)) STRICT;
 CREATE TABLE phone_reward_registry (fingerprint TEXT PRIMARY KEY CHECK(length(fingerprint)=64),claimed_at INTEGER NOT NULL) STRICT;
 CREATE TRIGGER phone_reward_no_update BEFORE UPDATE ON phone_reward_registry BEGIN SELECT RAISE(ABORT,'Phone rewards are immutable'); END;
 CREATE TRIGGER phone_reward_no_delete BEFORE DELETE ON phone_reward_registry BEGIN SELECT RAISE(ABORT,'Phone rewards are retained'); END;
 CREATE TRIGGER phone_reward_key_no_update BEFORE UPDATE ON phone_reward_key BEGIN SELECT RAISE(ABORT,'Reward key binding is immutable'); END;
 CREATE TRIGGER phone_reward_key_no_delete BEFORE DELETE ON phone_reward_key BEGIN SELECT RAISE(ABORT,'Reward key binding is retained'); END;
`};
function identityKey(){const value=process.env.NAEO_PHONE_REWARD_KEY;if(!/^[a-f0-9]{64}$/i.test(value??''))return null;const key=Buffer.from(value!,'hex');return{key,digest:createHash('sha256').update('naeo-phone-reward-v1:').update(key).digest('hex')};}
export function phoneRewardEligibility(db:Database,user:string){
 const config=identityKey();if(!config)return{reason:'휴대폰 인증 보상 설정이 준비되지 않았습니다.',fingerprint:null,digest:null};
 const bound=db.prepare('SELECT digest FROM phone_reward_key WHERE id=1').get() as {digest:string}|undefined;if(bound&&bound.digest!==config.digest)return{reason:'휴대폰 보상을 일시적으로 이용할 수 없습니다.',fingerprint:null,digest:null};
 const proof=db.prepare('SELECT p.phone,p.verified_at,c.phone AS current_phone,c.phone_verified_at FROM verified_phones p JOIN contact_details c ON c.user_id=p.user_id WHERE p.user_id=?').get(user) as {phone:string;verified_at:number;current_phone:string;phone_verified_at:number|null}|undefined;
 if(!proof||proof.verified_at!==proof.phone_verified_at||normalizedPhone(proof.current_phone)!==proof.phone)return{reason:'설정에서 휴대폰 번호 인증을 완료해주세요. 이전 인증은 다시 확인이 필요할 수 있습니다.',fingerprint:null,digest:null};
 const fingerprint=createHmac('sha256',config.key).update('naeo-phone-reward-v1:'+proof.phone).digest('hex');
 if(db.prepare('SELECT 1 FROM phone_reward_registry WHERE fingerprint=?').get(fingerprint))return{reason:'이 번호로 이미 휴대폰 인증 보상을 받았습니다.',fingerprint:null,digest:null};
 return{reason:'',fingerprint,digest:config.digest};
}
/** Caller holds the same transaction as tutorial claim + point ledger insert. */
export function reservePhoneReward(db:Database,user:string,now:number){const check=phoneRewardEligibility(db,user);if(!check.fingerprint||!check.digest)throw new AppError(409,'TUTORIAL_LOCKED',check.reason);db.prepare('INSERT INTO phone_reward_key(id,digest) VALUES(1,?) ON CONFLICT DO NOTHING').run(check.digest);db.prepare('INSERT INTO phone_reward_registry(fingerprint,claimed_at) VALUES(?,?)').run(check.fingerprint,now);}
