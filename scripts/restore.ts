/** 사용: 서버·작업자를 멈춘 뒤 npm run restore -- <백업 폴더> [--force]. 기존 DB·업로드는 .before-restore-시각으로 보존된다. */
import {restoreBackup} from '../src/server/ops/backup';
import {uploadDir} from '../src/server/writing/writing-api';

const [dir,...flags]=process.argv.slice(2);
if(!dir){process.stderr.write('Usage: npm run restore -- <backup-dir> [--force]\n');process.exitCode=1;}
else try{
 const r=restoreBackup(dir,{dbPath:process.env.NAEO_DATABASE_PATH||'var/naeo.sqlite',uploadsDir:uploadDir(),force:flags.includes('--force')});
 process.stdout.write(`restored: schema ${r.schemaVersion}, users ${r.counts.users??0}${r.previousDb?`, previous DB kept at ${r.previousDb}`:''}${r.previousUploads?`, previous uploads kept at ${r.previousUploads}`:''}\n`);
}catch(e){process.stderr.write(`[restore] ${e instanceof Error?e.message:String(e)}\n`);process.exitCode=1;}
