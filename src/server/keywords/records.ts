export type Metric={id:string;pcVolume:number;mobileVolume:number;documentCount:number;source:'manual'|'naver_searchad';measuredAt:number};
export type Keyword={id:string;phrase:string;category:string;status:'active'|'hidden';note:string;version:number;createdAt:number;updatedAt:number};
export const KEYWORD_SELECT='SELECT id,phrase,category,status,note,version,created_at AS createdAt,updated_at AS updatedAt FROM keywords';
export const METRIC_SELECT='SELECT id,pc_volume AS pcVolume,mobile_volume AS mobileVolume,document_count AS documentCount,source,measured_at AS measuredAt FROM keyword_metrics';
export const plain=<T extends object>(r:T):T=>({...r});
export const likeOf=(q:string)=>`%${q.replace(/[\\%_]/g,v=>'\\'+v)}%`;

export type Classification={total:number|null;saturation:number|null;golden:boolean;preempt:boolean;level:'여유'|'보통'|'포화'|null};
/**
 * 새 규칙(원본 기준 미확인): 포화도 = 문서수 ÷ (PC+모바일 월 검색량).
 * 황금 키워드 = 포화도 1 미만이고 검색량 1,000 이상, 선점기회 = 황금이 아니면서 포화도 3 미만이고 검색량 300 이상.
 */
export function classify(m:Pick<Metric,'pcVolume'|'mobileVolume'|'documentCount'>|null):Classification{
 if(!m)return{total:null,saturation:null,golden:false,preempt:false,level:null};
 const total=m.pcVolume+m.mobileVolume;
 if(total===0)return{total,saturation:null,golden:false,preempt:false,level:null};
 const saturation=Math.round(m.documentCount/total*100)/100;
 const golden=saturation<1&&total>=1000;
 const preempt=!golden&&saturation<3&&total>=300;
 return{total,saturation,golden,preempt,level:saturation<1?'여유':saturation<3?'보통':'포화'};
}
