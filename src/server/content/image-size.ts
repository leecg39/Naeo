import {openSync,readSync,closeSync} from 'node:fs';
import path from 'node:path';

export type ImageSize={width:number;height:number};
const cache=new Map<string,ImageSize|null>();
const ASSET=/^\/assets\/[A-Za-z0-9._-]+\.(webp|png|jpe?g|gif)$/;

function readHead(file:string,bytes=65536):Buffer{
 const fd=openSync(file,'r');
 try{const buf=Buffer.alloc(bytes);const n=readSync(fd,buf,0,bytes,0);return buf.subarray(0,n);}finally{closeSync(fd);}
}

function webp(b:Buffer):ImageSize|null{
 if(b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WEBP')return null;
 const kind=b.toString('ascii',12,16);
 if(kind==='VP8X')return{width:1+b.readUIntLE(24,3),height:1+b.readUIntLE(27,3)};
 if(kind==='VP8 ')return{width:b.readUInt16LE(26)&0x3fff,height:b.readUInt16LE(28)&0x3fff};
 if(kind==='VP8L'){const v=b.readUInt32LE(21);return{width:1+(v&0x3fff),height:1+((v>>14)&0x3fff)};}
 return null;
}

function jpeg(b:Buffer):ImageSize|null{
 if(b[0]!==0xff||b[1]!==0xd8)return null;
 let i=2;
 while(i+9<b.length){
  if(b[i]!==0xff){i++;continue;}
  const marker=b[i+1];
  if(marker>=0xc0&&marker<=0xcf&&![0xc4,0xc8,0xcc].includes(marker))return{height:b.readUInt16BE(i+5),width:b.readUInt16BE(i+7)};
  i+=2+b.readUInt16BE(i+2);
 }
 return null;
}

export function parseImageSize(b:Buffer):ImageSize|null{
 if(b.length>=24&&b.readUInt32BE(0)===0x89504e47)return{width:b.readUInt32BE(16),height:b.readUInt32BE(20)};
 if(b.length>=10&&b.toString('ascii',0,3)==='GIF')return{width:b.readUInt16LE(6),height:b.readUInt16LE(8)};
 return webp(b)??jpeg(b);
}

/** 공개 자산(/assets/파일명)만 크기를 읽는다. 경로 이동·외부 URL은 null. */
export function assetImageSize(src:string,root=process.cwd()):ImageSize|null{
 if(!ASSET.test(src))return null;
 if(cache.has(src))return cache.get(src)??null;
 let size:ImageSize|null;
 try{size=parseImageSize(readHead(path.join(root,'public',src)));}catch{size=null;}
 cache.set(src,size);
 return size;
}
