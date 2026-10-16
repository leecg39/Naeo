import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {AppError} from '../errors';

export function encryptOpenAIToken(value:string,aad:string,key:Buffer):string{
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(aad));
 const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
 return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),encrypted.toString('base64url')].join('.');
}

export function decryptOpenAIToken(value:string,aad:string,key:Buffer):string{
 try{
  const [version,iv,tag,payload,...rest]=value.split('.');
  if(version!=='v1'||!iv||!tag||!payload||rest.length)throw new Error('format');
  const ivBytes=Buffer.from(iv,'base64url'),tagBytes=Buffer.from(tag,'base64url'),payloadBytes=Buffer.from(payload,'base64url');
  if(ivBytes.length!==12||tagBytes.length!==16||payloadBytes.length===0)throw new Error('format');
  const decipher=createDecipheriv('aes-256-gcm',key,ivBytes);decipher.setAAD(Buffer.from(aad));decipher.setAuthTag(tagBytes);
  return Buffer.concat([decipher.update(payloadBytes),decipher.final()]).toString('utf8');
 }catch{throw new AppError(503,'OPENAI_CREDENTIALS_UNREADABLE','저장된 ChatGPT 연결 정보를 읽을 수 없습니다. 다시 연결해주세요.');}
}
