import {test} from 'node:test';
import assert from 'node:assert/strict';
import {kstDate,kstDateTime,kstTime} from '../../src/lib/kst-time';
import {formatKst} from '../../src/lib/inquiry-labels';

// 기대값은 Chrome의 ko-KR(Asia/Seoul) 출력과 같은 형식이다(2026-10-14 브라우저에서 확인).
test('KST formatting matches the browser ko-KR style regardless of the server ICU',()=>{
 const t=Date.parse('2026-10-14T03:04:05Z');
 assert.equal(kstDateTime(t),'2026. 10. 14. 오후 12:04');
 assert.equal(kstDateTime(t,{date:'short',seconds:true}),'26. 10. 14. 오후 12:04:05');
 assert.equal(kstDateTime(t,{date:'short'}),'26. 10. 14. 오후 12:04');
 assert.equal(kstDate(Date.parse('2026-03-04T15:00:00Z')),'2026. 3. 5.','single-digit month/day, next day in KST');
 assert.equal(kstTime(Date.parse('2026-03-04T15:00:00Z')),'오전 12:00','midnight');
 assert.equal(kstTime(Date.parse('2026-03-05T03:00:00Z')),'오후 12:00','noon');
 assert.equal(kstTime(Date.parse('2026-03-04T19:52:31Z'),true),'오전 4:52:31');
});

test('inquiry timestamps stay Korean when the runtime locale data differs',t=>{
 t.mock.method(Date.prototype,'toLocaleString',()=> '2026. 10. 14. PM 12:04');
 assert.equal(formatKst(Date.parse('2026-10-14T03:04:05Z')),'2026. 10. 14. 오후 12:04');
 assert.equal(formatKst(null),'—');
 assert.equal(formatKst(0),'1970. 1. 1. 오전 9:00');
});

test('KST formatting handles year and leap-day boundaries',()=>{
 assert.equal(kstDateTime(Date.parse('2025-12-31T15:00:00Z')),'2026. 1. 1. 오전 12:00');
 assert.equal(kstDateTime(Date.parse('2024-02-28T15:00:00Z')),'2024. 2. 29. 오전 12:00');
});
