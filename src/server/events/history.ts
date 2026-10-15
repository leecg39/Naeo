import {z} from 'zod';
import type {Database} from '../database';
import {paginationInput} from '../validation';
import {listMyEntries} from './entries';
import {listMyRewards} from './rewards';
export const eventHistoryQuery=z.object({entriesPage:paginationInput.shape.page,rewardsPage:paginationInput.shape.page});
export function eventHistory(db:Database,userId:string,query:unknown={}){
 const q=eventHistoryQuery.parse(query),entries=listMyEntries(db,userId,q.entriesPage),rewards=listMyRewards(db,userId,q.rewardsPage);
 return {entries:entries.data,rewards:rewards.data,entryPagination:entries.pagination,rewardPagination:rewards.pagination};
}
