/** 사용: 웹·작업자를 멈춘 뒤 npm run backup -- [백업 폴더] --offline. */
import {database} from '../src/server/database';
import {existsSync} from 'node:fs';
import {createBackup} from '../src/server/ops/backup';
import {uploadDir} from '../src/server/writing/writing-api';

const args=process.argv.slice(2),dest=args.find(a=>!a.startsWith('--'))||'var/backups';
if(!args.includes('--offline')||args.filter(a=>!a.startsWith('--')).length>1||args.some(a=>a.startsWith('--')&&a!=='--offline')){
 process.stderr.write('Usage: npm run backup -- [backup-dir] --offline\n웹 서버·작업자·기타 DB/업로드 기록기를 멈춘 뒤 --offline을 지정하세요.\n');process.exitCode=1;
}else{
let db:ReturnType<typeof database>|undefined;
try{
 if(!existsSync(process.env.NAEO_DATABASE_PATH||'var/naeo.sqlite'))throw new Error('백업할 DB가 없습니다. NAEO_DATABASE_PATH를 확인하세요. 빈 DB를 새로 만들지 않습니다.');
 db=database();
 const {dir,manifest}=createBackup(db,{uploadsDir:uploadDir(),destDir:dest});
 process.stdout.write(`backup: ${dir}\nschema ${manifest.schemaVersion}, users ${manifest.counts.users??0}, files ${manifest.files}, sha256 ${manifest.sha256.slice(0,12)}…\n`);
}catch(e){process.stderr.write(`[backup] ${e instanceof Error?e.message:String(e)}\n`);process.exitCode=1;}
finally{db?.close();}
}
