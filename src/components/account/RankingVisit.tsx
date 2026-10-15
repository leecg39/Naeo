'use client';
import {useEffect} from 'react';
import {api} from '@/lib/api-client';

/** Record a member page mount; prefetch/SSR alone must not grant a visit. */
export default function RankingVisit(){
 useEffect(()=>{void api('/api/tutorial/ranking-visit',{method:'POST'}).catch(()=>{/* The tutorial stays locked until a successful visit. */});},[]);
 return null;
}
