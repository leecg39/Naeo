import type {RecommendationList} from '../server/keywords/recommendations';
import type {KeywordSuggestion} from '../server/keywords/member-keywords';
export type KeywordWorkspaceData={list:RecommendationList;suggestions:KeywordSuggestion[];metricsConfigured:boolean};
