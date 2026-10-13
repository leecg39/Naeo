import type {Database} from '../database';

export type FaqStatus='draft'|'published';
export type FaqItem={id:string;category:string;question:string;answer:string;status:FaqStatus;position:number;version:number;createdAt:number;updatedAt:number};
export const FAQ_SELECT='SELECT id,category,question,answer,status,position,version,created_at AS createdAt,updated_at AS updatedAt FROM faq_items';

/** node:sqlite 행은 prototype이 없어 클라이언트 컴포넌트로 넘길 수 있도록 일반 객체로 바꾼다. */
export const plainFaq=(r:FaqItem):FaqItem=>({...r});

/** 공개 FAQ. 분류는 그 분류의 가장 앞 항목 순서대로, 항목은 순서·생성 순으로 정렬한다. */
export function listPublishedFaq(db:Database):FaqItem[]{
 return (db.prepare(`${FAQ_SELECT} f WHERE status='published'
  ORDER BY (SELECT min(position) FROM faq_items g WHERE g.status='published' AND g.category=f.category),category,position,created_at`).all() as FaqItem[]).map(plainFaq);
}

/** 분류별로 묶는다(입력 순서 유지). */
export function groupFaq(items:FaqItem[]):{category:string;items:FaqItem[]}[]{
 const order=[...new Set(items.map(i=>i.category))];
 return order.map(category=>({category,items:items.filter(i=>i.category===category)}));
}
