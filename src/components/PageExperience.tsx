'use client';
import CapturedView from '@/components/captured/CapturedView';
import StatefulExperience from '@/components/StatefulExperience';
import type { CapturedPageData } from '@/types/site';
import type { InstallBehavior } from '@/lib/behavior';
import { installLanding } from '@/behaviors/landing';
import { installWrite } from '@/behaviors/write';
import { installAnalysis } from '@/behaviors/analysis';
import { installContent } from '@/behaviors/content';
import { installRanking } from '@/behaviors/ranking';
import { installAuxiliary } from '@/behaviors/auxiliary';
import { installMateHistory } from '@/behaviors/mate-history';
import { installCompetitorsPage } from '@/behaviors/competitors';
import { installPricing } from '@/behaviors/pricing';
import RecommendationWorkspace from '@/components/keywords/RecommendationWorkspace';
import DashboardOverview from '@/components/analysis/DashboardOverview';
import DashboardBlogChange from '@/components/analysis/DashboardBlogChange';
import BlogAnalysisForm from '@/components/home/BlogAnalysisForm';
const install:InstallBehavior=(root,tools)=>{
 const page=tools.pathname;
 const adapter=(page==='/'||page==='/mate'||page==='/mate/s')?installLanding:page==='/dashboard/mate'?installMateHistory:page==='/dashboard/competitors'?installCompetitorsPage:page==='/dashboard/write'?installWrite:page==='/ranking'?installRanking:page==='/pricing'?installPricing:(page==='/dashboard'||page==='/dashboard/ai-picks')?installAnalysis:(page.startsWith('/blog')||page==='/updates'||page==='/contact')?installContent:undefined;
 const cleanup=adapter?.(root,tools), shared=installAuxiliary(root,tools);
 return()=>{cleanup?.();shared?.()};
};
export default function PageExperience({data}:{data:CapturedPageData}) { return ['/mcp','/social/aeo-carousel','/youtube/aeo-intro'].includes(data.path)?<StatefulExperience key={data.path} data={data}/>:<CapturedView key={`${data.path}:${data.dashboard?.subject?.naverId??''}`} data={data} install={install} slots={data.path==='/'?{'home-blog-analysis':<BlogAnalysisForm/>}:data.path==='/dashboard'&&data.dashboard&&data.dashboardOverview?{'dashboard-overview':<DashboardOverview data={data.dashboardOverview} diagnosis={data.dashboard}/>, 'dashboard-blog-change':<DashboardBlogChange subjects={data.dashboard.subjects} selected={data.dashboard.subject?.naverId??null}/>} : data.path==='/dashboard/recommendations'&&data.recommendations&&data.recommendationFeed?{'keyword-workspace':<RecommendationWorkspace key={JSON.stringify([data.recommendationFeed.query,data.recommendationView])} initial={data.recommendationFeed} library={data.recommendations} initialView={data.recommendationView}/>} : undefined}/> }
