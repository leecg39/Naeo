import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>JSON.parse(readFileSync(new URL(`../docs/fullstack/${name}`,import.meta.url),'utf8'));
test('fullstack plan covers every discovered URL and every dynamic route exactly once',()=>{
 const source=read('source-page-inventory.json'),rows=read('page-coverage.json');
 assert.equal(source.paths.length,79);assert.equal(source.dynamic.length,4);
 assert.deepEqual(rows.map(r=>r.path).sort(),[...source.paths,...source.dynamic.map(r=>r.path)].sort());
 assert.equal(new Set(rows.map(r=>r.path)).size,83);
 for(const row of rows){assert.ok(row.models.length);assert.ok(row.operations);assert.ok(row.acceptance);assert.ok(Array.isArray(row.evidence));if(row.status==='complete')assert.ok(row.evidence.length);}
 assert.equal(rows.filter(r=>r.path.startsWith('/admin')).length,11);
});
