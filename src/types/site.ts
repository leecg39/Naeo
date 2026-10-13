export type CapturedNode = string | { tag: string; attrs: Record<string,string>; children: CapturedNode[] };
export interface CapturedPageData { path: string; title: string; description: string; css: string; body: CapturedNode[]; source: string; capturedAt: string; states?: Record<string, CapturedNode[]>; }
export interface RouteRecord { path: string; title: string; kind: "public"|"dashboard"|"admin"|"auth"|"utility"|"redirect"; evidence: "observed"|"static"|"unavailable"; }
export interface DemoProfile { nickname:string; blogId:string; blogTitle:string; credits:number; tokens:number; plan:"free"|"basic"; }
export interface Keyword { id:string; keyword:string; pc:number; mobile:number; documents:number; saturation:number; golden:boolean; status:"new"|"recommended"|"written"; }
export interface Draft { id:string; title:string; keyword:string; content:string; createdAt:string; status:"draft"|"published"; imageCount:number; }
