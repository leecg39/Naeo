/** 사용: npm run backup -- [백업 폴더, 기본 var/backups]. 서버 실행 중에도 일관된 사본을 만든다. */
import {database} from '../src/server/database';
import {createBackup} from '../src/server/ops/backup';
import {uploadDir} from '../src/server/writing/writing-api';

const dest=process.argv[2]||'var/backups';
const db=database();
try{
 const {dir,manifest}=createBackup(db,{uploadsDir:uploadDir(),destDir:dest});
 process.stdout.write(`backup: ${dir}\nschema ${manifest.schemaVersion}, users ${manifest.counts.users??0}, files ${manifest.files}, sha256 ${manifest.sha256.slice(0,12)}…\n`);
}catch(e){process.stderr.write(`[backup] ${e instanceof Error?e.message:String(e)}\n`);process.exitCode=1;}
finally{db.close();}
