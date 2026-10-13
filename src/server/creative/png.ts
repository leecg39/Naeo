import {crc32,inflateSync} from 'node:zlib';
import {AppError} from '../errors';

export type Png={width:number;height:number;channels:3|4;pixels:Buffer};
const SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);
const MAX_SIDE=4096,MAX_PIXELS=4096*4096;
const invalid=(m:string)=>new AppError(400,'INVALID_PNG',`PNG 파일이 올바르지 않습니다: ${m}`);

function paeth(a:number,b:number,c:number){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
/** 스캔라인 필터(0 None, 1 Sub, 2 Up, 3 Average, 4 Paeth)를 되돌린다. */
function unfilter(data:Buffer,width:number,height:number,bpp:number):Buffer{
 const stride=width*bpp,out=Buffer.alloc(stride*height);
 if(data.length!==(stride+1)*height)throw invalid('이미지 데이터 길이가 크기와 다릅니다');
 for(let y=0;y<height;y++){
  const type=data[y*(stride+1)],src=y*(stride+1)+1,dst=y*stride;
  for(let x=0;x<stride;x++){
   const raw=data[src+x],a=x>=bpp?out[dst+x-bpp]:0,b=y>0?out[dst-stride+x]:0,c=x>=bpp&&y>0?out[dst-stride+x-bpp]:0;
   const pred=type===0?0:type===1?a:type===2?b:type===3?(a+b)>>1:type===4?paeth(a,b,c):-1;
   if(pred<0)throw invalid(`알 수 없는 필터 ${type}`);
   out[dst+x]=(raw+pred)&0xff;
  }
 }
 return out;
}
/**
 * 업로드된 PNG를 끝까지 검증하며 해석한다: 서명, 청크 길이·CRC, IHDR(8비트 RGB/RGBA, 비인터레이스), IDAT 압축 해제, 필터 복원.
 */
export function parsePng(buf:Buffer):Png{
 if(buf.length<SIGNATURE.length+12||!buf.subarray(0,8).equals(SIGNATURE))throw invalid('서명이 없습니다');
 let pos=8,width=0,height=0,channels:3|4=4,sawEnd=false;
 const idat:Buffer[]=[];
 while(pos<buf.length){
  if(pos+12>buf.length)throw invalid('청크가 잘렸습니다');
  const len=buf.readUInt32BE(pos),type=buf.toString('ascii',pos+4,pos+8);
  if(pos+12+len>buf.length)throw invalid('청크가 잘렸습니다');
  const body=buf.subarray(pos+8,pos+8+len);
  if((crc32(buf.subarray(pos+4,pos+8+len))>>>0)!==buf.readUInt32BE(pos+8+len))throw invalid(`${type} CRC 불일치`);
  if(pos===8&&type!=='IHDR')throw invalid('IHDR가 처음이 아닙니다');
  if(type==='IHDR'){
   width=body.readUInt32BE(0);height=body.readUInt32BE(4);
   const [depth,color,,,interlace]=[body[8],body[9],body[10],body[11],body[12]];
   if(depth!==8||(color!==2&&color!==6)||interlace!==0)throw new AppError(400,'UNSUPPORTED_PNG','8비트 RGB·RGBA, 비인터레이스 PNG만 받을 수 있습니다.');
   if(!width||!height||width>MAX_SIDE||height>MAX_SIDE||width*height>MAX_PIXELS)throw invalid('크기가 허용 범위를 벗어났습니다');
   channels=color===6?4:3;
  }else if(type==='IDAT')idat.push(body);
  else if(type==='IEND'){sawEnd=true;break;}
  pos+=12+len;
 }
 if(!width||!idat.length||!sawEnd)throw invalid('필수 청크가 없습니다');
 let data:Buffer;
 try{data=inflateSync(Buffer.concat(idat),{maxOutputLength:(width*channels+1)*height});}catch{throw invalid('압축 데이터를 풀 수 없습니다');}
 return{width,height,channels,pixels:unfilter(data,width,height,channels)};
}
/** PDF 삽입용 RGB(알파는 흰 배경에 합성). */
export function toRgb(img:Png):Buffer{
 if(img.channels===3)return img.pixels;
 const n=img.width*img.height,out=Buffer.alloc(n*3);
 for(let i=0;i<n;i++){const a=img.pixels[i*4+3];for(let c=0;c<3;c++)out[i*3+c]=Math.round((img.pixels[i*4+c]*a+255*(255-a))/255);}
 return out;
}
