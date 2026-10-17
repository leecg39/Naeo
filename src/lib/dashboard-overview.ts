import type {CitationPoint,DashboardSubject,DashboardVisualization} from './dashboard-visualization';

export type DashboardBriefing={id:string;title:string;keyword:string;cited:boolean;checkedAt:number;markdown:string;media:{title:string;url:string;thumbnail:string}[];references:{title:string;url:string}[];href:string};
export type DashboardRankCard={period:'all'|'month'|'week';label:string;periodLabel:string;rank:number|null;participants:number;public:boolean;delta:number|null;history:{at:number;rank:number}[]};
export type DashboardChange={id:string;kind:'citation_gained'|'citation_lost'|'exposure_gained'|'exposure_lost'|'rank'|'scan';title:string;description:string;at:number;href:string};
export type DashboardOverview={
 now:number;subject:DashboardSubject|null;category:string;connected:boolean;citationState:DashboardVisualization['citationState'];citationHref:string;recommendationHref:string;
 metrics:{checked:number|null;cited:number|null;exposed:number|null;briefing:number|null;revisit:number;opportunity:number;recommendations:number};
 monitoring:DashboardBriefing[];citations:CitationPoint[];
 rankings:{scope:'all'|'category';label:string;cards:DashboardRankCard[]}[];
 citedPosts:{id:string;title:string;keyword:string;textRank:number|null;imageRank:number|null;volume:number|null;saturation:number|null;href:string}[];
 recommendations:{id:string;phrase:string;signal:'new'|'revisit'|'rewritten'|'opportunity';volume:number|null;saturation:number|null;href:string}[];
 changes:DashboardChange[];
};
