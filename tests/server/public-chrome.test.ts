import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getCapturedPage} from '../../src/lib/pages';
import {publicChrome} from '../../src/server/content/public-chrome';
import {findAll,textOf} from '../../src/server/content/tree';

test('public navigation shows current identity or guest actions without captured profile',async()=>{
 for(const path of ['/','/mcp','/contact','/pricing','/event','/blog']){
  const captured=(await getCapturedPage(path))!,before=JSON.stringify(captured);
  for(const nickname of [null,'현재 회원']){
   const view=publicChrome(captured,nickname);
   const nav=findAll([...view.body,...Object.values(view.states??{}).flat()],n=>n.tag==='nav');
   assert.doesNotMatch(nav.map(textOf).join(''),/NAEO 블로거/,path);
   if(!nickname)assert.equal(findAll(nav,n=>n.attrs.href==='/dashboard').length,0,path);
   else assert.ok(findAll(nav,n=>n.attrs.href==='/dashboard').length>0,path);
  }
  assert.equal(JSON.stringify(captured),before);
 }
});
