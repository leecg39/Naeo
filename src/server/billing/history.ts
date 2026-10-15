import {z} from 'zod';
import type {Database} from '../database';
import {paginationInput} from '../validation';
import {listMyPayments} from './payments';
import {listMyRefunds,refundsForPayments} from './refunds';
const queryInput=z.object({paymentsPage:paginationInput.shape.page,refundsPage:paginationInput.shape.page});
/** The authenticated caller supplies userId; query parameters never select another account. */
export function billingHistory(db:Database,userId:string,query:unknown={}){
 const q=queryInput.parse(query);
 const payments=listMyPayments(db,userId,q.paymentsPage),refunds=listMyRefunds(db,userId,q.refundsPage);
 return {payments:payments.data,refunds:refunds.data,paymentPagination:payments.pagination,refundPagination:refunds.pagination,paymentRefunds:refundsForPayments(db,userId,payments.data)};
}
