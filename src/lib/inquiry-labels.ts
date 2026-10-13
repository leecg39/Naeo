/** 문의 유형·상태 표시 이름. 유형 이름은 원본 /contact 선택 목록과 같다. */
export const INQUIRY_TYPE_LABELS={service:'서비스 이용',technical:'기술 문의',business:'기업/B2B 도입 문의',partnership:'파트너십',etc:'기타'} as const;
export const INQUIRY_STATUS_LABELS={open:'접수',answered:'답변 완료',closed:'종료'} as const;
export type InquiryType=keyof typeof INQUIRY_TYPE_LABELS;
export type InquiryStatus=keyof typeof INQUIRY_STATUS_LABELS;
export const formatKst=(ms:number|null)=>ms?new Date(ms).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'}):'—';
