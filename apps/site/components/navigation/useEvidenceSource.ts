'use client';
import {useEffect,useState} from 'react';
import {usePathname} from 'next/navigation';
import {sourceForLocation} from '@/lib/catalog/sources';

/** Country controls use pushState + atlas-country-change; native history/hash also matter. */
export function useEvidenceSource() {
 const pathname=usePathname();
 const path=pathname?.replace(/\/+$/, '') || '/';
 const [location,setLocation]=useState<{path:string;search:string;hash:string}|null>(null);
 useEffect(()=>{
  const sync=()=>setLocation({path:window.location.pathname.replace(/\/+$/, '') || '/',search:window.location.search,hash:window.location.hash});
  sync();
  const events=['popstate','hashchange','atlas-country-change'];
  events.forEach(event=>window.addEventListener(event,sync));
  return ()=>events.forEach(event=>window.removeEventListener(event,sync));
 },[path]);
 return pathname===null?undefined:sourceForLocation(path,location?.path===path?location.search:'',location?.path===path?location.hash:'');
}
