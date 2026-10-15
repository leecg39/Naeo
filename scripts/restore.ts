/** 사용: 서버·작업자를 멈춘 뒤 npm run restore -- <백업 폴더> --offline [--force]. 중단 복구는 --offline --recover. */
import {restoreBackup,recoverRestore} from '../src/server/ops/backup';
import {uploadDir} from '../src/server/writing/writing-api';

const args=process.argv.slice(2),dirs=args.filter(a=>!a.startsWith('--')),flags=args.filter(a=>a.startsWith('--')),dir=dirs[0];
const dbPath=process.env.NAEO_DATABASE_PATH||'var/naeo.sqlite';
if(!flags.includes('--offline')||dirs.length>1||flags.some(a=>!['--offline','--force','--recover'].includes(a))||(!dir&&!flags.includes('--recover'))||(dir&&flags.includes('--recover'))){process.stderr.write('Usage: npm run restore -- <backup-dir> --offline [--force]\nRecovery: npm run restore -- --offline --recover\n웹 서버와 작업자를 먼저 멈추세요.\n');process.exitCode=1;}
else try{
 if(flags.includes('--recover'))process.stdout.write(JSON.stringify(recoverRestore(dbPath))+'\n');
 else{const r=restoreBackup(dir,{dbPath,uploadsDir:uploadDir(),force:flags.includes('--force')});
 process.stdout.write(`restored: schema ${r.schemaVersion}, users ${r.counts.users??0}${r.previousDb?`, previous DB kept at ${r.previousDb}`:''}${r.previousUploads?`, previous uploads kept at ${r.previousUploads}`:''}\n`);
 }}catch(e){process.stderr.write(`[restore] ${e instanceof Error?e.message:String(e)}\n`);process.exitCode=1;}
