'use client';
import React,{useEffect,useState} from 'react';
import type {OrganizedTpexShareReport} from '@/lib/evidence/tpex-share-projection';
import type {OrganizedCvmReport} from '@/lib/evidence/cvm-projection';
import type {OrganizedCftcReport} from '@/lib/evidence/cftc-projection';
import type {OrganizedDeribitReport} from '@/lib/evidence/deribit-projection';
import type {OrganizedKrakenTradeReport} from '@/lib/evidence/kraken-trade-projection';
import s from './evidence.module.css';
type BlobReport=OrganizedTpexShareReport|OrganizedCvmReport|OrganizedCftcReport|OrganizedDeribitReport|OrganizedKrakenTradeReport;

/** A complete local file without a multi-megabyte data URI. No upload or request. */
export default function BlobEvidenceDownload({report,filename,onDownload}:{report:BlobReport;filename:string;onDownload?:React.MouseEventHandler<HTMLAnchorElement>}) {
 const [resource,setResource]=useState<{report:BlobReport;url:string|null}|null>(null);
 useEffect(()=>{
  let url:string|null=null;
  const prepare=setTimeout(()=>{
   try{url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json;charset=utf-8'}));}
   catch{url=null;}
   setResource({report,url});
  },0);
  return()=>{clearTimeout(prepare);if(url)URL.revokeObjectURL(url);};
 },[report]);
 // Never present the preceding report's download while a replacement is preparing.
 if(resource?.report!==report)return <p>正在准备本地 JSON…</p>;
 if(!resource.url)return <p>无法准备本地 JSON，当前证据仍可在下表查看。</p>;
 return <a className={s.download} href={resource.url} download={filename} onClick={onDownload}>下载整理后的 JSON</a>;
}
