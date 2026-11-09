'use client';

import React from 'react';
import {usePathname} from 'next/navigation';
import s from './navigation.module.css';

import {assetLabels, evidenceSources} from '@/lib/catalog/sources';
import EvidenceContext from './EvidenceContext';
import {useEvidenceSource} from './useEvidenceSource';

const sourceLinks = evidenceSources;
export const marketLinks = [
 {href:'/markets',label:'全球市场矩阵'}, {href:'/',label:'首页 / A 股'}, {href:'/news',label:'新闻与日程'},
 ...sourceLinks.map(({href,label})=>({href,label})), {href:'/diagnostics',label:'来源状态'},
];

/** Plain links avoid prefetching gated source pages from a navigation surface. */
export default function MarketNavigation() {
  const pathname = usePathname();
  const activeSource=useEvidenceSource();
  const currentPath = pathname === '/' ? '/' : pathname?.replace(/\/+$/, '');
  return <><div className={s.bar}>
    <nav className={s.links} aria-label="市场导航">
      {marketLinks.filter(link=>['/markets','/','/news','/diagnostics'].includes(link.href)).map(link=><a key={link.href} href={link.href} aria-current={currentPath===link.href&&!activeSource?.href.includes('?')?'page':undefined}>{link.label}</a>)}
      {Object.entries(assetLabels).filter(([asset])=>sourceLinks.some(source=>source.asset===asset)).map(([asset,label])=><details key={`${asset}:${currentPath}`} className={s.group}>
        <summary>{label}{sourceLinks.some(source=>source.asset===asset && source.id===activeSource?.id)?' · 当前':''}</summary>
        <div>{sourceLinks.filter(source=>source.asset===asset).map(source=><a key={source.id} href={source.href} aria-current={source.id===activeSource?.id && currentPath !== '/'?'page':undefined}>{source.label}</a>)}</div>
      </details>)}
    </nav>
  </div><EvidenceContext/></>;
}
