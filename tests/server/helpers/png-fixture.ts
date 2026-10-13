import {crc32,deflateSync} from 'node:zlib';

function chunk(type:string,data:Buffer){const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type,'ascii'),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(td)>>>0);return Buffer.concat([len,td,crc]);}
/** 테스트용 PNG: rows는 필터 바이트가 붙은 스캔라인(8비트, colorType 6=RGBA, 2=RGB). */
export function png(width:number,height:number,rows:Buffer[],colorType=6){
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=colorType;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.concat(rows))),chunk('IEND',Buffer.alloc(0))]);
}
/** 단색 RGBA PNG(크기 검증용). */
export function solidPng(width:number,height:number,rgba=[3,199,90,255]){
 const row=Buffer.alloc(1+width*4);for(let x=0;x<width;x++)row.set(rgba,1+x*4);
 return png(width,height,Array.from({length:height},()=>row));
}
