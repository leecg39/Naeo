import {test} from 'node:test';
import assert from 'node:assert/strict';
import {crc32,inflateSync} from 'node:zlib';
import {png} from './helpers/png-fixture';
import {parsePng,toRgb} from '../../src/server/creative/png';
import {buildPdf} from '../../src/server/creative/pdf';
import {buildZip} from '../../src/server/creative/zip';

const px=(...v:number[])=>Buffer.from(v);

test('PNG parsing validates structure and undoes every scanline filter',()=>{
 // 3x1 RGBA, the same pixels encoded with each of the five filters must decode identically.
 const raw=px(10,20,30,255,40,50,60,255,70,80,90,255);
 const sub=px(1,10,20,30,255,30,30,30,0,30,30,30,0);
 const up=px(2,...raw);
 const avg=px(3,10,20,30,255,40-5,50-10,60-15,255-127,70-20,80-25,90-30,255-127);
 const paeth=px(4,10,20,30,255,30,30,30,0,30,30,30,0);
 for(const row of [px(0,...raw),sub,up,avg,paeth]){
  const img=parsePng(png(3,1,[row]));
  assert.deepEqual([img.width,img.height],[3,1]);
  assert.deepEqual([...toRgb(img)],[10,20,30,40,50,60,70,80,90],`filter ${row[0]}`);
 }
 const two=parsePng(png(1,2,[px(0,1,2,3,255),px(2,5,5,5,0)]));
 assert.deepEqual([...toRgb(two)],[1,2,3,6,7,8],'Up filter uses the previous row');
 const good=png(1,1,[px(0,0,0,0,255)]);
 assert.throws(()=>parsePng(Buffer.from('not a png at all')),{code:'INVALID_PNG'});
 const badCrc=Buffer.from(good);badCrc[29]^=0xff;
 assert.throws(()=>parsePng(badCrc),{code:'INVALID_PNG'},'chunk CRC is checked');
 assert.throws(()=>parsePng(png(1,1,[px(0,0,0,0)],2).subarray(0,40)),{code:'INVALID_PNG'},'truncated');
 assert.throws(()=>parsePng(png(1,1,[px(0,9,9,9)],3)),{code:'UNSUPPORTED_PNG'},'palette images are not accepted');
});

test('PDF: one page per image, valid cross-reference table, page size follows the image',()=>{
 const a=parsePng(png(2,2,[px(0,255,0,0,255,0,255,0,255),px(0,0,0,255,255,255,255,255,255)])),b=parsePng(png(4,2,[px(0,...Array(16).fill(9)),px(0,...Array(16).fill(9))]));
 const pdf=buildPdf([a,b],'QA 내보내기');
 const text=pdf.toString('latin1');
 assert.ok(text.startsWith('%PDF-1.4'));assert.ok(text.trimEnd().endsWith('%%EOF'));
 assert.equal((text.match(/\/Type \/Page\b/g)??[]).length,2);
 assert.match(text,/\/MediaBox \[0 0 1\.5 1\.5\]/);assert.match(text,/\/MediaBox \[0 0 3 1\.5\]/);
 const start=Number(/startxref\s+(\d+)/.exec(text)![1]);
 assert.equal(text.slice(start,start+4),'xref','startxref points at the table');
 const offsets=[...text.slice(start).matchAll(/^(\d{10}) 00000 n/gm)].map(m=>Number(m[1]));
 for(const [i,o] of offsets.entries())assert.equal(text.slice(o,o+`${i+1} 0 obj`.length),`${i+1} 0 obj`,`object ${i+1} offset`);
 const stream=/\/Width 2 \/Height 2[^]*?stream\n([^]*?)\nendstream/.exec(text)!;
 assert.deepEqual([...inflateSync(Buffer.from(stream[1],'latin1'))],[255,0,0,0,255,0,0,0,255,255,255,255],'RGB pixels without alpha');
});

test('ZIP (stored) lists every file with CRC and a central directory',()=>{
 const zip=buildZip([{name:'slide-01.png',data:Buffer.from('one')},{name:'slide-02.png',data:Buffer.from('second')}],Date.parse('2026-10-14T03:00:00Z'));
 assert.equal(zip.readUInt32LE(0),0x04034b50);
 const end=zip.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
 assert.equal(zip.readUInt16LE(end+10),2,'two entries');
 const dir=zip.readUInt32LE(end+16);
 assert.equal(zip.readUInt32LE(dir),0x02014b50);
 assert.equal(zip.readUInt32LE(dir+16)>>>0,crc32(Buffer.from('one'))>>>0);
 assert.ok(zip.includes(Buffer.from('slide-02.png')));
});
