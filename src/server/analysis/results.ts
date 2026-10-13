import {randomUUID} from 'node:crypto';
import type {Database} from '../database';
import {AppError} from '../errors';
import {paginationInput} from '../validation';
import type {AnalysisReport} from './rules';
import {createActionItems} from './action-items';

export type ScanResult=AnalysisReport&{id:string;blogId:string;jobId:string|null;postCount:number;measuredAt:number};
type Row={id:string;blog_id:string;job_id:string|null;score:number;method_version:string;report_json:string;post_count:number;measured_at:number};
const SELECT='SELECT id,blog_id,job_id,score,method_version,report_json,post_count,measured_at FROM scan_results';
const toResult=(r:Row):ScanResult=>({...(JSON.parse(r.report_json) as AnalysisReport),id:r.id,blogId:r.blog_id,jobId:r.job_id,score:r.score,methodVersion:r.method_version,postCount:r.post_count,measuredAt:r.measured_at});

function assertOwnBlog(db:Database,ownerId:string,blogId:string){
 if(!db.prepare('SELECT 1 FROM blogs WHERE id=? AND owner_id=?').get(blogId,ownerId))throw new AppError(404,'BLOG_NOT_FOUND','블로그를 찾을 수 없습니다.');
}

export function saveScanResult(db:Database,{ownerId,blogId,jobId,report,postCount,measuredAt}:{ownerId:string;blogId:string;jobId:string;report:AnalysisReport;postCount:number;measuredAt:number}):string{
 const id=randomUUID();
 db.prepare('INSERT INTO scan_results(id,owner_id,blog_id,job_id,score,method_version,report_json,post_count,measured_at) VALUES(?,?,?,?,?,?,?,?,?)')
  .run(id,ownerId,blogId,jobId,report.score,report.methodVersion,JSON.stringify(report),postCount,measuredAt);
 createActionItems(db,ownerId,id,report,measuredAt);
 return id;
}

export function latestScanResult(db:Database,ownerId:string,blogId:string):ScanResult|null{
 assertOwnBlog(db,ownerId,blogId);
 const r=db.prepare(`${SELECT} WHERE blog_id=? ORDER BY measured_at DESC,id LIMIT 1`).get(blogId) as Row|undefined;
 return r?toResult(r):null;
}

export function listScanResults(db:Database,ownerId:string,blogId:string,query:unknown){
 assertOwnBlog(db,ownerId,blogId);
 const {page,pageSize}=paginationInput.parse(query);
 const {total}=db.prepare('SELECT count(*) AS total FROM scan_results WHERE blog_id=?').get(blogId) as {total:number};
 const rows=db.prepare(`${SELECT} WHERE blog_id=? ORDER BY measured_at DESC,id LIMIT ? OFFSET ?`).all(blogId,pageSize,(page-1)*pageSize) as Row[];
 return{data:rows.map(toResult),pagination:{page,pageSize,total}};
}
