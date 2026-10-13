import type {Database} from '../database';
import {expireStalePayments} from './payments';
import {rolloverSubscriptions} from './subscriptions';

export const MAINTENANCE_INTERVAL=60_000;
/** 작업자가 주기적으로 부른다: 끝난 구독 기간 처리(토큰 소멸·갱신·종료)와 버려진 주문 만료. 마지막 실행 후 1분 안이면 건너뛴다. */
export function billingMaintenance(db:Database,last:number,now=Date.now()){
 if(now-last<MAINTENANCE_INTERVAL)return null;
 return{at:now,...rolloverSubscriptions(db,now),expiredOrders:expireStalePayments(db,now)};
}
