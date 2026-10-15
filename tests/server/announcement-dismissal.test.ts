import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ANNOUNCEMENT_DISMISSAL_KEY as key,dismissAnnouncementToday,isAnnouncementDismissed} from '../../src/components/content/announcement-dismissal';
function storage(){const values=new Map<string,string>();return {getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);}};}
test('daily dismissal survives reload, merges IDs, and expires at UTC midnight (09:00 KST)',()=>{
 const s=storage(),before=new Date('2026-10-16T08:59:59+09:00'),after=new Date('2026-10-16T09:00:00+09:00');
 dismissAnnouncementToday(s,'first',before);dismissAnnouncementToday(s,'second',before);dismissAnnouncementToday(s,'first',before);
 assert.deepEqual(JSON.parse(s.getItem(key)!),{date:'2026-10-15',ids:['first','second']});
 assert.equal(isAnnouncementDismissed(s,'first',before),true);
 assert.equal(isAnnouncementDismissed(s,'other',before),false);
 assert.equal(isAnnouncementDismissed(s,'first',after),false);
 dismissAnnouncementToday(s,'third',after);
 assert.deepEqual(JSON.parse(s.getItem(key)!),{date:'2026-10-16',ids:['third']});
});
test('legacy permanent entries and corrupt storage do not permanently hide announcements',()=>{
 const s=storage(),now=new Date('2026-10-15T10:00:00Z');
 s.setItem('naeo-announcement-dismissed:first:1','1');
 assert.equal(isAnnouncementDismissed(s,'first',now),false);
 for(const value of ['broken','null','[]','{"date":"2026-10-15","ids":{}}','{"date":"2026-10-15","ids":[7,null]}']){
  s.setItem(key,value);assert.equal(isAnnouncementDismissed(s,'first',now),false);
  dismissAnnouncementToday(s,'first',now);assert.equal(isAnnouncementDismissed(s,'first',now),true);
 }
 const blocked={getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('quota');}};
 assert.equal(isAnnouncementDismissed(blocked,'first',now),false);
 assert.doesNotThrow(()=>dismissAnnouncementToday(blocked,'first',now));
});
