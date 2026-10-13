import type {CapturedNode} from '../../types/site';
import type {DashboardResult} from './dashboard-data';
import {stamp} from './dashboard-data';

type El=Exclude<CapturedNode,string>;
const el=(tag:string,attrs:Record<string,string>,children:CapturedNode[]=[]):El=>({tag,attrs,children});
const W=600,H=200,PAD=28;

/** 진단 점수 추이(0~100점) SVG. 오래된 결과가 왼쪽. 결과가 없으면 안내 문구. */
export function scoreChart(history:DashboardResult[]):El{
 if(!history.length)return el('div',{'data-score-chart':'true',style:'padding:32px 0;text-align:center;color:#a3a3a3;font-size:14px'},['스캔 기록이 쌓이면 진단 점수 추이를 보여드립니다.']);
 const points=[...history].reverse();
 const x=(i:number)=>points.length===1?W/2:PAD+i*(W-2*PAD)/(points.length-1);
 const y=(score:number)=>H-PAD-(score/100)*(H-2*PAD);
 const label=`진단 점수 추이: ${points.map(p=>`${stamp(p.measuredAt)} ${p.score}점`).join(', ')}`;
 const grid=[0,50,100].flatMap(v=>[el('line',{x1:String(PAD),x2:String(W-PAD),y1:String(y(v)),y2:String(y(v)),stroke:'#ffffff1f','stroke-dasharray':'4 4'}),el('text',{x:'2',y:String(y(v)+4),fill:'#a3a3a3','font-size':'11'},[String(v)])]);
 return el('div',{'data-score-chart':'true',style:'width:100%'},[
  el('svg',{viewBox:`0 0 ${W} ${H}`,role:'img','aria-label':label,style:'width:100%;height:auto;display:block'},[
   ...grid,
   ...(points.length>1?[el('polyline',{points:points.map((p,i)=>`${x(i)},${y(p.score)}`).join(' '),fill:'none',stroke:'#03c75a','stroke-width':'3','stroke-linejoin':'round'})]:[]),
   ...points.map((p,i)=>el('circle',{cx:String(x(i)),cy:String(y(p.score)),r:'5',fill:'#03c75a'},[el('title',{},[`${stamp(p.measuredAt)} · ${p.score}점`])])),
   el('text',{x:String(x(0)),y:String(H-6),fill:'#a3a3a3','font-size':'11','text-anchor':points.length===1?'middle':'start'},[stamp(points[0].measuredAt).slice(0,5)]),
   ...(points.length>1?[el('text',{x:String(x(points.length-1)),y:String(H-6),fill:'#a3a3a3','font-size':'11','text-anchor':'end'},[stamp(points.at(-1)!.measuredAt).slice(0,5)])]:[])
  ])
 ]);
}
