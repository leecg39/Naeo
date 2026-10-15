import type {ProviderPayment} from './provider';

// Toss retains idempotency keys for 15 days. Never repeat a money-moving call beyond that window.
export const IDEMPOTENCY_WINDOW=15*86_400_000;
export function validAmounts(p:ProviderPayment){
 return Number.isSafeInteger(p.totalAmount)&&p.totalAmount>=0&&Number.isSafeInteger(p.balanceAmount)&&p.balanceAmount>=0&&p.balanceAmount<=p.totalAmount;
}
export function samePayment(p:ProviderPayment,expected:{orderId:string;amount:number;paymentKey:string|null}){
 return Boolean(p.paymentKey)&&p.paymentKey===expected.paymentKey&&p.orderId===expected.orderId&&p.totalAmount===expected.amount&&validAmounts(p);
}
export function canceledSnapshot(p:ProviderPayment){
 return validAmounts(p)&&((p.status==='CANCELED'&&p.balanceAmount===0)||(p.status==='PARTIAL_CANCELED'&&p.balanceAmount>0&&p.balanceAmount<p.totalAmount));
}
