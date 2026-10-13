import type { Database } from './database';
import { transaction } from './database';
import { profileInput } from './validation';
import { AppError } from './errors';
import { audit } from './audit';

export type Profile = {userId:string;nickname:string;avatarUrl:string;rankingPublic:boolean;version:number;updatedAt:number};
export function getProfile(db:Database,userId:string):Profile {
  const row=db.prepare('SELECT user_id AS userId,nickname,avatar_url AS avatarUrl,ranking_public AS rankingPublic,version,updated_at AS updatedAt FROM profiles WHERE user_id=?').get(userId) as (Omit<Profile,'rankingPublic'>&{rankingPublic:number})|undefined;
  if(!row) throw new AppError(404,'NOT_FOUND','프로필을 찾을 수 없습니다.');
  return {...row,rankingPublic:Boolean(row.rankingPublic)};
}
export function updateProfile(db:Database,userId:string,input:unknown):Profile {
  const valid=profileInput.parse(input);
  return transaction(db,()=>{
    const current=getProfile(db,userId);
    if(current.version!==valid.version) throw new AppError(409,'VERSION_CONFLICT','다른 화면에서 수정했습니다. 새로고침 후 다시 시도해주세요.');
    db.prepare('UPDATE profiles SET nickname=?,avatar_url=?,ranking_public=?,version=version+1,updated_at=? WHERE user_id=? AND version=?').run(valid.nickname??current.nickname,valid.avatarUrl??current.avatarUrl,Number(valid.rankingPublic??current.rankingPublic),Date.now(),userId,valid.version);
    db.prepare('UPDATE users SET version=version+1,updated_at=? WHERE id=?').run(Date.now(),userId);
    audit(db,userId,'profile.update','profile',userId,{fields:Object.keys(valid).filter(k=>k!=='version')});
    return getProfile(db,userId);
  });
}
