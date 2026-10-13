import {randomUUID} from 'node:crypto';
import {transaction,type Database} from './database';
import {AppError} from './errors';
import {audit} from './audit';
import {createContactInput,updateContactInput,deleteInput,preferencesInput} from './validation';

export type Contact={name:string;email:string;phone:string;phoneVerifiedAt:number|null;version:number;updatedAt:number};
export type Preferences={marketingEmail:boolean;scanEmail:boolean;autoscan:boolean;version:number;updatedAt:number};
export function getContact(db:Database,userId:string):Contact|null {
  const row=db.prepare('SELECT name,email,phone,phone_verified_at AS phoneVerifiedAt,version,updated_at AS updatedAt FROM contact_details WHERE user_id=?').get(userId) as Contact|undefined;
  return row?{...row}:null;
}
export function saveContact(db:Database,userId:string,input:unknown,create=false) {
  const valid=create?createContactInput.parse(input):updateContactInput.parse(input);
  return transaction(db,()=>{
    const previous=getContact(db,userId);
    if(create&&previous)throw new AppError(409,'CONTACT_EXISTS','이미 연락처가 있습니다. 수정 기능을 이용해주세요.');
    if(!create&&!previous)throw new AppError(404,'NOT_FOUND','저장한 연락처가 없습니다.');
    if(!create&&previous?.version!==('version' in valid?valid.version:undefined))throw new AppError(409,'VERSION_CONFLICT','연락처가 변경되었습니다. 다시 불러와주세요.');
    if(create)db.prepare('INSERT INTO contact_details(user_id,name,email,phone,updated_at) VALUES(?,?,?,?,?)').run(userId,valid.name,valid.email,valid.phone,Date.now());
    else db.prepare('UPDATE contact_details SET name=?,email=?,phone=?,phone_verified_at=?,version=version+1,updated_at=? WHERE user_id=?').run(valid.name,valid.email,valid.phone,previous?.phone===valid.phone?previous.phoneVerifiedAt:null,Date.now(),userId);
    audit(db,userId,create?'contact.create':'contact.update','contact',userId);
    return getContact(db,userId);
  });
}
export function deleteContact(db:Database,userId:string,input:unknown) {
  const valid=deleteInput.parse(input);
  return transaction(db,()=>{
    const previous=getContact(db,userId);
    if(!previous)throw new AppError(404,'NOT_FOUND','저장한 연락처가 없습니다.');
    if(previous.version!==valid.version)throw new AppError(409,'VERSION_CONFLICT','연락처가 변경되었습니다. 다시 불러와주세요.');
    db.prepare('DELETE FROM contact_details WHERE user_id=?').run(userId);audit(db,userId,'contact.delete','contact',userId);return {deleted:true};
  });
}
export function getPreferences(db:Database,userId:string):Preferences {
  const row=db.prepare('SELECT marketing_email AS marketingEmail,scan_email AS scanEmail,autoscan,version,updated_at AS updatedAt FROM notification_preferences WHERE user_id=?').get(userId) as {marketingEmail:number;scanEmail:number;autoscan:number;version:number;updatedAt:number}|undefined;
  if(!row)throw new AppError(404,'NOT_FOUND','알림 설정을 찾을 수 없습니다.');
  return {...row,marketingEmail:Boolean(row.marketingEmail),scanEmail:Boolean(row.scanEmail),autoscan:Boolean(row.autoscan)};
}
export function savePreferences(db:Database,userId:string,input:unknown) {
  const valid=preferencesInput.parse(input);
  return transaction(db,()=>{
    const previous=getPreferences(db,userId);
    if(previous.version!==valid.version)throw new AppError(409,'VERSION_CONFLICT','알림 설정이 변경되었습니다. 다시 불러와주세요.');
    const next={...previous,...valid},now=Date.now();
    db.prepare('UPDATE notification_preferences SET marketing_email=?,scan_email=?,autoscan=?,version=version+1,updated_at=? WHERE user_id=?').run(Number(next.marketingEmail),Number(next.scanEmail),Number(next.autoscan),now,userId);
    for(const [field,kind] of [['marketingEmail','marketing_email'],['scanEmail','scan_email']] as const)if(previous[field]!==next[field])db.prepare('INSERT INTO consent_history VALUES(?,?,?,?,?)').run(randomUUID(),userId,kind,Number(next[field]),now);
    audit(db,userId,'preferences.update','preferences',userId);return getPreferences(db,userId);
  });
}
