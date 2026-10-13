import {crc32} from 'node:zlib';

/** DOS 날짜·시각(로컬 대신 UTC 고정). */
function dosTime(ms:number){const d=new Date(ms);return{time:(d.getUTCHours()<<11)|(d.getUTCMinutes()<<5)|(d.getUTCSeconds()>>1),date:((d.getUTCFullYear()-1980)<<9)|((d.getUTCMonth()+1)<<5)|d.getUTCDate()};}
/** 압축하지 않고 저장하는 ZIP(PNG는 이미 압축되어 있음). 파일 이름은 UTF-8 플래그. */
export function buildZip(files:{name:string;data:Buffer}[],now=Date.now()):Buffer{
 const {time,date}=dosTime(now),locals:Buffer[]=[],centrals:Buffer[]=[];
 let offset=0;
 for(const f of files){
  const name=Buffer.from(f.name,'utf8'),crc=crc32(f.data)>>>0;
  const local=Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x0800,6);local.writeUInt16LE(0,8);local.writeUInt16LE(time,10);local.writeUInt16LE(date,12);
  local.writeUInt32LE(crc,14);local.writeUInt32LE(f.data.length,18);local.writeUInt32LE(f.data.length,22);local.writeUInt16LE(name.length,26);local.writeUInt16LE(0,28);
  const central=Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x0800,8);central.writeUInt16LE(0,10);central.writeUInt16LE(time,12);central.writeUInt16LE(date,14);
  central.writeUInt32LE(crc,16);central.writeUInt32LE(f.data.length,20);central.writeUInt32LE(f.data.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
  locals.push(local,name,f.data);centrals.push(central,name);
  offset+=30+name.length+f.data.length;
 }
 const dir=Buffer.concat(centrals),end=Buffer.alloc(22);
 end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(dir.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...locals,dir,end]);
}
