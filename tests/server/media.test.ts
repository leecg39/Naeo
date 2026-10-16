import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createDraft,deleteDraft} from '../../src/server/writing/drafts';
import {saveUpload,readMedia,listMedia,deleteMedia,attachMedia,publishMedia,readPublishedMedia,revokePublishedMedia,imageMarkdown,sniffImage,MAX_IMAGE_BYTES,MAX_PER_DRAFT} from '../../src/server/writing/media';
import {createShareLink,revokeShareLink,readShared} from '../../src/server/writing/shares';

const PNG=Buffer.from('89504e470d0a1a0a0000000d49484452','hex');
const JPG=Buffer.from('ffd8ffe000104a464946','hex');
const WEBP=Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WEBPVP8 ')]);
const NOW=Date.parse('2026-10-13T03:00:00Z');
const DAY=86_400_000;

async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const dir=mkdtempSync(path.join(tmpdir(),'naeo-media-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const a=(await register(db,{email:'a@example.test',password:'media-long-password',nickname:'A',termsAccepted:true})).user.id;
 const b=(await register(db,{email:'b@example.test',password:'media-long-password',nickname:'B',termsAccepted:true})).user.id;
 return{db,dir,a,b};
}
const file=(bytes:Buffer,name='photo.png',type='image/png')=>({bytes,name,type});

test('image type is decided by file signature, not by the declared type or name',()=>{
 assert.equal(sniffImage(PNG),'image/png');assert.equal(sniffImage(JPG),'image/jpeg');assert.equal(sniffImage(WEBP),'image/webp');
 assert.equal(sniffImage(Buffer.from('<svg onload=alert(1)>')),null);
 assert.equal(sniffImage(Buffer.from('GIF89a')),null);
});
test('image markdown escapes filename syntax and removes line breaks',()=>{
 assert.equal(imageMarkdown('a[b]\\c\nnext.jpg','https://example.test/x'),'![a\\[b\\]\\\\c next.jpg](https://example.test/x)');
});

test('upload validates type, size and count; files are stored under random keys',async t=>{
 const {db,dir,a}=await fixture(t);
 const m=saveUpload(db,dir,a,file(PNG),NOW);
 assert.match(m.publicId,/^[A-Za-z0-9_-]{22}$/);assert.equal(m.mime,'image/png');assert.equal(m.size,PNG.length);
 assert.equal(readdirSync(dir).length,1);assert.ok(!readdirSync(dir)[0].includes('photo'),'original name not used on disk');
 assert.throws(()=>saveUpload(db,dir,a,file(Buffer.from('<svg/>'),'x.png','image/png'),NOW),{status:415,code:'UNSUPPORTED_IMAGE'});
 assert.throws(()=>saveUpload(db,dir,a,file(Buffer.concat([PNG,Buffer.alloc(MAX_IMAGE_BYTES)])),NOW),{status:413,code:'IMAGE_TOO_LARGE'});
 assert.throws(()=>saveUpload(db,dir,a,file(Buffer.alloc(0)),NOW),{status:415});
 const d=createDraft(db,a,{title:'글',body:'본문'});
 for(let i=0;i<MAX_PER_DRAFT;i++)saveUpload(db,dir,a,{...file(JPG,'p.jpg','image/jpeg'),draftId:d.id},NOW);
 assert.throws(()=>saveUpload(db,dir,a,{...file(JPG),draftId:d.id},NOW),{status:409,code:'TOO_MANY_IMAGES'});
});

test('only the owner reads or deletes media; deleting removes the file; drafts keep photos',async t=>{
 const {db,dir,a,b}=await fixture(t);
 const d=createDraft(db,a,{title:'글',body:'본문'});
 const m=saveUpload(db,dir,a,{...file(PNG),draftId:d.id},NOW);
 assert.deepEqual(readMedia(db,dir,a,m.publicId).bytes,PNG);
 assert.throws(()=>readMedia(db,dir,b,m.publicId),{status:404});
 assert.throws(()=>attachMedia(db,b,m.publicId,{draftId:d.id}),{status:404});
 assert.equal(listMedia(db,a,{draftId:d.id}).data.length,1);
 deleteDraft(db,a,d.id,{version:1});
 assert.equal(listMedia(db,a,{}).data[0].draftId,null,'photo stays in my library after the draft is deleted');
 assert.throws(()=>deleteMedia(db,dir,b,m.publicId),{status:404});
 deleteMedia(db,dir,a,m.publicId);
 assert.equal(readdirSync(dir).length,0);
 assert.throws(()=>readMedia(db,dir,a,m.publicId),{status:404});
});

test('share links expose only that draft\'s images until expiry or revocation',async t=>{
 const {db,dir,a,b}=await fixture(t);
 const d=createDraft(db,a,{title:'공유 글',body:'본문'});
 const other=createDraft(db,a,{title:'비공개 글',body:'본문'});
 const shared=saveUpload(db,dir,a,{...file(PNG),draftId:d.id},NOW);
 const hidden=saveUpload(db,dir,a,{...file(JPG),draftId:other.id},NOW);
 assert.throws(()=>createShareLink(db,b,d.id,{days:7},NOW),{status:404});
 const link=createShareLink(db,a,d.id,{days:7},NOW);
 assert.match(link.token,/^[A-Za-z0-9_-]{22}$/);
 const view=readShared(db,link.token,NOW+DAY);
 assert.equal(view.title,'공유 글');assert.deepEqual(view.images.map(i=>i.publicId),[shared.publicId]);
 assert.deepEqual(readShared(db,link.token,NOW+DAY,shared.publicId,dir).bytes,PNG);
 assert.throws(()=>readShared(db,link.token,NOW+DAY,hidden.publicId,dir),{status:404},'other drafts\' images are not reachable');
 assert.throws(()=>readShared(db,link.token,NOW+8*DAY),{status:404,code:'SHARE_EXPIRED'});
 assert.throws(()=>createShareLink(db,a,d.id,{days:31},NOW),{name:'ZodError'});
 revokeShareLink(db,a,link.token,NOW+DAY);
 assert.throws(()=>readShared(db,link.token,NOW+DAY),{status:404});
 assert.ok(!existsSync(path.join(dir,'..','nope')));
});

test('markdown image tokens expose exactly one photo and disappear with deletion',async t=>{
 const {db,dir,a,b}=await fixture(t);
 const photo=saveUpload(db,dir,a,file(JPG,'published.jpg','image/jpeg'),NOW);
 const hidden=saveUpload(db,dir,a,file(PNG,'hidden.png'),NOW);
 const token=publishMedia(db,a,photo.publicId,NOW);
 assert.match(token,/^[A-Za-z0-9_-]{22}$/);
 assert.equal(publishMedia(db,a,photo.publicId,NOW+1),token,'publishing is idempotent');
 assert.throws(()=>publishMedia(db,b,photo.publicId,NOW),{status:404});
 assert.deepEqual(readPublishedMedia(db,dir,token).bytes,JPG);
 assert.throws(()=>readPublishedMedia(db,dir,photo.publicId),{status:404},'private publicId is not a public token');
 assert.throws(()=>readPublishedMedia(db,dir,hidden.publicId),{status:404});
 assert.equal(listMedia(db,a,{}).data.find(m=>m.publicId===photo.publicId)?.shareToken,token);
 assert.throws(()=>revokePublishedMedia(db,b,photo.publicId),{status:404});
 assert.deepEqual(revokePublishedMedia(db,a,photo.publicId),{revoked:true});
 assert.throws(()=>readPublishedMedia(db,dir,token),{status:404});
 assert.throws(()=>revokePublishedMedia(db,a,photo.publicId),{status:404},'revocation is explicit about an absent link');
 const replacement=publishMedia(db,a,photo.publicId,NOW+2);assert.notEqual(replacement,token);
 assert.deepEqual(readPublishedMedia(db,dir,replacement).bytes,JPG);
 deleteMedia(db,dir,a,photo.publicId);
 assert.throws(()=>readPublishedMedia(db,dir,replacement),{status:404},'deletion cascades to the public token');
});

test('owner and share downloads reject symlink substitution, missing files and changed metadata',async t=>{
 const {writeFileSync,unlinkSync,symlinkSync}=await import('node:fs');const {db,dir,a}=await fixture(t);const d=createDraft(db,a,{title:'safe',body:'body'});const m=saveUpload(db,dir,a,{...file(PNG),draftId:d.id},NOW);const link=createShareLink(db,a,d.id,{days:7},NOW);const key=readdirSync(dir)[0];const p=path.join(dir,key),outside=path.join(dir,'private.txt');writeFileSync(outside,'private secret');unlinkSync(p);symlinkSync(outside,p);
 assert.throws(()=>readMedia(db,dir,a,m.publicId),{code:'MEDIA_UNAVAILABLE'});assert.throws(()=>readShared(db,link.token,NOW,m.publicId,dir),{code:'MEDIA_UNAVAILABLE'});
 unlinkSync(p);assert.throws(()=>readMedia(db,dir,a,m.publicId),{code:'MEDIA_UNAVAILABLE'});writeFileSync(p,Buffer.concat([PNG,Buffer.from('extra')]));assert.throws(()=>readMedia(db,dir,a,m.publicId),{code:'MEDIA_UNAVAILABLE'});writeFileSync(p,Buffer.alloc(PNG.length));assert.throws(()=>readShared(db,link.token,NOW,m.publicId,dir),{code:'MEDIA_UNAVAILABLE'});
 writeFileSync(p,PNG);assert.deepEqual(readMedia(db,dir,a,m.publicId).bytes,PNG);
});
test('stored keys cannot alias other files through traversal or hard links',async t=>{
 const {linkSync,unlinkSync}=await import('node:fs');const {readStoredFile}=await import('../../src/server/writing/media');const {db,dir,a}=await fixture(t);const m=saveUpload(db,dir,a,file(PNG),NOW);const key=readdirSync(dir)[0];assert.throws(()=>readStoredFile(dir,'../'+key),{code:'MEDIA_UNAVAILABLE'});const second=path.join(dir,'hard-link');linkSync(path.join(dir,key),second);assert.throws(()=>readMedia(db,dir,a,m.publicId),{code:'MEDIA_UNAVAILABLE'});unlinkSync(second);assert.deepEqual(readMedia(db,dir,a,m.publicId).bytes,PNG);
});

test('library page two: all 101 photos remain private and deletion recovers the final page',async t=>{
 const {loadValidPage}=await import('../../src/components/admin/pagination');
 const {db,dir,a,b}=await fixture(t);
 for(let i=0;i<101;i++)saveUpload(db,dir,a,file(PNG,`photo-${i}.png`),NOW);
 saveUpload(db,dir,b,file(PNG,'other-private.png'),NOW);
 const first=listMedia(db,a,{page:1,pageSize:100}),last=listMedia(db,a,{page:2,pageSize:100});
 assert.equal(first.pagination.total,101);assert.equal(last.data.length,1);
 assert.equal(new Set([...first.data,...last.data].map(m=>m.publicId)).size,101);
 const photo=last.data[0];assert.equal(photo.originalName,'photo-0.png');
 assert.deepEqual(readMedia(db,dir,a,photo.publicId).bytes,PNG);
 assert.throws(()=>deleteMedia(db,dir,b,photo.publicId),{status:404});
 deleteMedia(db,dir,a,photo.publicId);
 const recovered=await loadValidPage(async page=>listMedia(db,a,{page,pageSize:100}),2);
 assert.equal(recovered.pagination.page,1);assert.equal(recovered.pagination.total,100);
 assert.throws(()=>readMedia(db,dir,a,photo.publicId),{status:404});
 assert.equal(listMedia(db,b,{}).pagination.total,1);
 assert.equal(readdirSync(dir).length,101,'only the selected own file is deleted');
});
