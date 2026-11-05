'use client';
import React,{useState} from 'react';
import Forex from './Forex';
import KrakenFxSpot from './KrakenFxSpot';
import s from './workspace.module.css';
/** Only the selected source mounts, so ECB does not poll in the intraday view. */
export default function ForexWorkspace(){
 const [view,setView]=useState<'venue'|'reference'>('venue');
 return <><nav className={s.tabs} aria-label="外汇数据视图"><button aria-pressed={view==='venue'} onClick={()=>setView('venue')}>交易所日内行情</button><button aria-pressed={view==='reference'} onClick={()=>setView('reference')}>ECB 每日参考 · 非实时</button></nav>{view==='venue'?<KrakenFxSpot/>:<Forex/>}</>;
}
