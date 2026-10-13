import {deflateSync} from 'node:zlib';
import {toRgb,type Png} from './png';

const num=(n:number)=>Number(n.toFixed(3)).toString();
/** PDF 문자열 리터럴: 비ASCII 제목은 UTF-16BE(BOM) 16진 문자열로. */
const pdfText=(s:string)=>`<FEFF${Buffer.from(s,'utf16le').swap16().toString('hex').toUpperCase()}>`;
/**
 * 이미지마다 한 페이지인 PDF 1.4를 만든다(외부 라이브러리 없음).
 * 페이지 크기는 픽셀 × 0.75pt(96dpi 기준), 이미지는 RGB를 Flate로 압축해 넣는다.
 */
export function buildPdf(images:Png[],title:string):Buffer{
 const objects:Buffer[]=[];
 const add=(body:Buffer|string)=>{objects.push(typeof body==='string'?Buffer.from(body,'latin1'):body);return objects.length;};
 const catalog=add(''),pages=add(''),info=add(`<< /Title ${pdfText(title.slice(0,200))} /Producer (NAEO) >>`);
 const kids:number[]=[];
 for(const img of images){
  const data=deflateSync(toRgb(img));
  const image=add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${data.length} >>\nstream\n`,'latin1'),data,Buffer.from('\nendstream','latin1')]));
  const w=num(img.width*0.75),h=num(img.height*0.75);
  const draw=`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
  const content=add(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
  kids.push(add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${content} 0 R >>`));
 }
 objects[catalog-1]=Buffer.from(`<< /Type /Catalog /Pages ${pages} 0 R >>`,'latin1');
 objects[pages-1]=Buffer.from(`<< /Type /Pages /Kids [${kids.map(k=>`${k} 0 R`).join(' ')}] /Count ${kids.length} >>`,'latin1');
 const parts:Buffer[]=[Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n','latin1')];
 const offsets:number[]=[];
 let size=parts[0].length;
 objects.forEach((body,i)=>{offsets.push(size);const chunk=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`,'latin1'),body,Buffer.from('\nendobj\n','latin1')]);parts.push(chunk);size+=chunk.length;});
 const xref=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.map(o=>`${String(o).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${size}\n%%EOF\n`;
 parts.push(Buffer.from(xref,'latin1'));
 return Buffer.concat(parts);
}
