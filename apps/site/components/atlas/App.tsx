"use client";
import React,{useEffect,useState} from 'react';
import TicLayer from './TicLayer';
import MarketLanding from '@/components/home/MarketLanding';
import AshareWorkspace from '@/components/ashare/AshareWorkspace';
import './styles.css';
/** The homepage opens the industry matrix itself, not a directory of cards. */
export default function App(){
 const [ticOpen,setTicOpen]=useState(false);
 useEffect(()=>{const sync=()=>{if(window.location.hash==='#tic-view')setTicOpen(true)};sync();window.addEventListener('hashchange',sync);return()=>window.removeEventListener('hashchange',sync)},[]);
 return <main className="hosted-atlas"><MarketLanding onOpenTic={()=>setTicOpen(true)}/><AshareWorkspace embedded/>
  <details id="tic-view" className="homepage-tic" open={ticOpen} onToggle={event=>setTicOpen(event.currentTarget.open)}>
   <summary><span>美国 TIC · 跨境净交易矩阵</span><small>按境外居住地分组，来源不提供行业归属</small></summary>
   {ticOpen&&<TicLayer/>}
  </details>
 </main>
}
