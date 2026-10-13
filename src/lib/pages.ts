import fs from 'node:fs/promises';
import path from 'node:path';
import type { CapturedPageData } from '@/types/site';
import index from '@/data/page-index.json';
export async function getCapturedPage(route:string):Promise<CapturedPageData|null>{const file=(index as Record<string,string>)[route];if(!file)return null;try{return JSON.parse(await fs.readFile(path.join(process.cwd(),'src/data/pages',file),'utf8'))}catch{return null}}
export const capturedPaths=Object.keys(index);
