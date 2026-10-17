/** 서버와 추천 화면이 공유하는 직렬화 계약. 수치는 실측이 없으면 null이다. */
export type RecommendationSignal='new'|'revisit'|'rewritten'|'opportunity';
export type RecommendationFilter='all'|'golden'|'new'|'opportunity'|'revisit'|'rewritten'|'written'|'unwritten';
export type RecommendationFeedQuery={blogId:string;q:string;period:'all'|'week'|'month';filter:RecommendationFilter;sort:'score'|'pc'|'mobile'|'total'|'documents'|'saturation';direction:'asc'|'desc';page:number;pageSize:number};
export type RecommendationMetricPoint={at:number;pcVolume:number;mobileVolume:number;total:number;documentCount:number|null;saturation:number|null;source:string};
export type RecommendationRelated={phrase:string;pcVolume:number|null;mobileVolume:number|null;total:number|null;source:'naver_searchad'|'blog_analysis'};
export type RecommendationCompetitor={title:string;url:string;name:string;date:string};
export type RecommendationCompetition={blogs:RecommendationCompetitor[];news:RecommendationCompetitor[];checkedAt:number|null;error:string|null};
export type DiscoveredRecommendation={
 id:string;blogId:string;phrase:string;category:string;signal:RecommendationSignal;score:number;
 reason:string;source:'blog_analysis'|'citation'|'catalog'|'naver_searchad';
 sourcePost:{id:string;title:string;url:string}|null;
 pcVolume:number|null;mobileVolume:number|null;total:number|null;documentCount:number|null;saturation:number|null;measuredAt:number|null;
 golden:boolean;opportunity:boolean;alreadyPublished?:boolean;written:boolean;dismissed:boolean;saved:boolean;savedKeywordId:string|null;
 history:RecommendationMetricPoint[];related:RecommendationRelated[];competition:RecommendationCompetition;
 recommendedAt:number;updatedAt:number;version:number;
};
export type RecommendationFeed={
 status:'no_blog'|'needs_scan'|'ready'|'no_candidates';
 blogs:{id:string;title:string;naverId:string;isPrimary:boolean}[];selectedBlogId:string|null;
 plan:{paid:boolean;name:string;cycleDays:number;perBuild:number;monthlyLimit:number;goldenLimit:number};
 cap:{used:number;remaining:number};nextBuildAt:number|null;lastBuiltAt:number|null;building:boolean;
 providers:{searchAd:boolean;naverSearch:boolean};notice:string|null;
 summary:{total:number;golden:number;written:number;opportunity:number;revisit:number;rewritten:number;new:number};
 items:DiscoveredRecommendation[];goldenItems:DiscoveredRecommendation[];
 pagination:{page:number;pageSize:number;total:number};query:RecommendationFeedQuery;
};
