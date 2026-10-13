import type { SVGProps } from 'react';
type Props=SVGProps<SVGSVGElement>;
const base={viewBox:'0 0 24 24',width:24,height:24,fill:'currentColor','aria-hidden':true as const};
export const CheckCircleIcon=(p:Props)=><svg {...base} {...p}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>;
export const ArrowRightIcon=(p:Props)=><svg {...base} {...p}><path d="m12 4-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg>;
export const ChevronDownIcon=(p:Props)=><svg {...base} {...p}><path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>;
export const CloseIcon=(p:Props)=><svg {...base} {...p}><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>;
export const MenuIcon=(p:Props)=><svg {...base} {...p}><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>;
