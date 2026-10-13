/** 작업자가 진행률을 보고하지 않고 이 시간이 지나면 죽은 것으로 보고 다른 작업자가 넘겨받는다. */
export const LEASE_MS=60_000;
/** 재시도 대기: 30초, 60초, 120초 … */
export const backoffMs=(attempt:number)=>30_000*2**Math.max(0,attempt-1);
