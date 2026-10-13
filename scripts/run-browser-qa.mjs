// Ego runs Node inside its app, so shell environment variables must be passed explicitly.
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,'');
const batch=Number(process.argv[2]??0);
if(!Number.isInteger(batch)||batch<0||batch>8)throw new Error('Usage: node scripts/run-browser-qa.mjs <batch 0..8>');
const settings={NAEO_QA_ROOT:root,NAEO_QA_BATCH:String(batch),NAEO_QA_SPACE:process.env.NAEO_QA_SPACE||'7',NAEO_AUDIT_BASE:process.env.NAEO_AUDIT_BASE||'http://127.0.0.1:3100'};
const input=`Object.assign(process.env,${JSON.stringify(settings)});\n`+readFileSync(new URL('qa-fullstack-browser.mjs',import.meta.url),'utf8');
const result=spawnSync('ego-browser',['nodejs'],{input,stdio:['pipe','inherit','inherit']});
if(result.error)throw result.error;
process.exitCode=result.status??1;
