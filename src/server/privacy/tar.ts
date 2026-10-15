import {createHash} from 'node:crypto';
import {closeSync,constants,fstatSync,openSync,readSync,writeSync} from 'node:fs';
/** USTAR, regular files only. Total archive may exceed 4GiB; each member is bounded by USTAR's 8GiB field. */
export class TarWriter{
 private fd:number;private offset=0;
 constructor(path:string){this.fd=openSync(path,'wx',0o600);}
 private write(bytes:Buffer){let at=0;while(at<bytes.length){const n=writeSync(this.fd,bytes,at,bytes.length-at,this.offset);if(!n)throw new Error('SHORT_WRITE');at+=n;this.offset+=n;}}
 private header(name:string,size:number,start:number){
  if(!/^[a-zA-Z0-9_./-]{1,99}$/.test(name)||name.split('/').includes('..')||name.startsWith('/')||size>0o77777777777)throw new Error('ARCHIVE_MEMBER_LIMIT');
  const b=Buffer.alloc(512),oct=(n:number,at:number,len:number)=>b.write(n.toString(8).padStart(len-1,'0')+'\0',at,len,'ascii');
  b.write(name);oct(0o600,100,8);oct(0,108,8);oct(0,116,8);oct(size,124,12);oct(0,136,12);b.fill(32,148,156);b[156]=48;b.write('ustar\0',257);b.write('00',263);oct(b.reduce((a,n)=>a+n,0),148,7);b[155]=32;
  let at=0;while(at<b.length){const n=writeSync(this.fd,b,at,b.length-at,start+at);if(!n)throw new Error('SHORT_WRITE');at+=n;}
 }
 private member(name:string,produce:(write:(bytes:Buffer)=>void)=>void){
  const start=this.offset,hash=createHash('sha256');this.write(Buffer.alloc(512));
  produce(bytes=>{hash.update(bytes);this.write(bytes);});
  const size=this.offset-start-512;this.header(name,size,start);this.write(Buffer.alloc((512-size%512)%512));
  return{path:name,size,sha256:hash.digest('hex')};
 }
 rows(name:string,records:Iterable<unknown>){let rows=0;const file=this.member(name,write=>{for(const record of records){write(Buffer.from(JSON.stringify(record)+'\n'));rows++;}});return {...file,rows};}
 json(name:string,data:unknown){return this.member(name,write=>write(Buffer.from(JSON.stringify(data,null,2)+'\n')));}
 file(name:string,path:string,expectedSize:number){
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
   const before=fstatSync(fd);if(!before.isFile()||before.size!==expectedSize)throw new Error('ATTACHMENT_CHANGED');
   return this.member(name,write=>{
    const chunk=Buffer.alloc(128*1024);let left=before.size;
    while(left){const n=readSync(fd,chunk,0,Math.min(left,chunk.length),null);if(!n)throw new Error('ATTACHMENT_CHANGED');write(chunk.subarray(0,n));left-=n;}
    const after=fstatSync(fd);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw new Error('ATTACHMENT_CHANGED');
   });
  }finally{closeSync(fd);}
 }
 finish(){this.write(Buffer.alloc(1024));const size=this.offset;this.close();return size;}
 close(){if(this.fd>=0){closeSync(this.fd);this.fd=-1;}}
}
