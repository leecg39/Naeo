'use client';
import DemoPreview from '@/components/DemoPreview';
import CapturedView from '@/components/captured/CapturedView';
import StatefulExperience from '@/components/StatefulExperience';
import type { CapturedPageData } from '@/types/site';
import type { InstallBehavior } from '@/lib/behavior';
import { installLanding } from '@/behaviors/landing';
import { installRecommendations } from '@/behaviors/recommendations';
import { installWrite } from '@/behaviors/write';
import { installSettings } from '@/behaviors/settings';
import { installAnalysis } from '@/behaviors/analysis';
import { installContent } from '@/behaviors/content';
import { installRanking } from '@/behaviors/ranking';
import { installAuxiliary } from '@/behaviors/auxiliary';
import { installMateHistory } from '@/behaviors/mate-history';
import { installCompetitorsPage } from '@/behaviors/competitors';
import { installPricing } from '@/behaviors/pricing';
const install:InstallBehavior=(root,tools)=>{
 const page=tools.pathname;
 const adapter=(page==='/'||page==='/mate'||page==='/mate/s')?installLanding:page==='/dashboard/recommendations'?installRecommendations:page==='/dashboard/mate'?installMateHistory:page==='/dashboard/competitors'?installCompetitorsPage:page==='/dashboard/write'?installWrite:page==='/dashboard/settings'?installSettings:page==='/ranking'?installRanking:page==='/pricing'?installPricing:(page==='/dashboard'||page==='/dashboard/ai-picks')?installAnalysis:(page.startsWith('/blog')||page==='/updates'||page==='/contact')?installContent:undefined;
 const cleanup=adapter?.(root,tools), shared=installAuxiliary(root,tools);
 return()=>{cleanup?.();shared?.()};
};
export default function PageExperience({data}:{data:CapturedPageData}) { return data.path==='/preview'?<DemoPreview/>:['/mcp','/social/aeo-carousel','/youtube/aeo-intro'].includes(data.path)?<StatefulExperience key={data.path} data={data}/>:<CapturedView key={data.path} data={data} install={install}/> }
