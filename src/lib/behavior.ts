export interface BehaviorTools {
 pathname: string;
 toast: (message:string)=>void;
 navigate: (href:string)=>void;
 openAuth: ()=>void;
 openDialog: (title:string, content:React.ReactNode)=>void;
 closeDialog: ()=>void;
}
export type InstallBehavior=(root:HTMLElement,tools:BehaviorTools)=>void|(()=>void);
export function text(el:Element|null){return el?.textContent?.replace(/\s+/g,' ').trim()||''}
export function buttons(root:HTMLElement,match:RegExp){return [...root.querySelectorAll<HTMLButtonElement>('button')].filter(b=>match.test(text(b)))}
