import type {CapturedNode} from '../../types/site';

export type El=Exclude<CapturedNode,string>;
export const isEl=(n:CapturedNode):n is El=>typeof n!=='string';
export const hasClass=(c:string)=>(n:El)=>(n.attrs.class??'').split(/\s+/).includes(c);
export const textOf=(n:CapturedNode):string=>isEl(n)?n.children.map(textOf).join(''):n;

export function find(nodes:CapturedNode[],pred:(n:El)=>boolean):El|undefined{
 for(const n of nodes){if(!isEl(n))continue;if(pred(n))return n;const r=find(n.children,pred);if(r)return r;}
 return undefined;
}
export function findAll(nodes:CapturedNode[],pred:(n:El)=>boolean,out:El[]=[]):El[]{
 for(const n of nodes){if(!isEl(n))continue;if(pred(n))out.push(n);findAll(n.children,pred,out);}
 return out;
}
export function mustFind(nodes:CapturedNode[],pred:(n:El)=>boolean,what:string):El{
 const n=find(nodes,pred);
 if(!n)throw new Error(`template node not found: ${what}`);
 return n;
}

/**
 * 원본 트리를 바꾸지 않고 새 트리를 만든다. visit이 배열을 돌려주면 그 노드를 대체하고,
 * undefined면 자식으로 내려간다.
 */
export function mapTree(nodes:CapturedNode[],visit:(n:El)=>CapturedNode[]|undefined):CapturedNode[]{
 return nodes.flatMap(n=>{
  if(!isEl(n))return[n];
  const replaced=visit(n);
  return replaced??[{...n,children:mapTree(n.children,visit)}];
 });
}

export const withChildren=(n:El,children:CapturedNode[]):El=>({...n,attrs:{...n.attrs},children});
export const withAttrs=(n:El,attrs:Record<string,string>):El=>({...n,attrs:{...n.attrs,...attrs}});
