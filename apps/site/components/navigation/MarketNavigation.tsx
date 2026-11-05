'use client';

import React from 'react';
import {usePathname} from 'next/navigation';
import s from './navigation.module.css';

export const marketLinks = [
  {href: '/ashare', label: 'A 股热力图'},
  {href: '/markets', label: '全球市场'},
  {href: '/crypto', label: '加密现货'},
  {href: '/', label: '首页 / 美国 TIC'},
] as const;

/** Plain links avoid prefetching gated source pages from a navigation surface. */
export default function MarketNavigation() {
  const pathname = usePathname();
  return <div className={s.bar}>
    <nav className={s.links} aria-label="市场导航">
      {marketLinks.map(link => <a key={link.href} href={link.href}
        aria-current={pathname === link.href ? 'page' : undefined}
        className={link.href === '/ashare' ? s.primary : undefined}>
        {link.label}
      </a>)}
      <span className={s.upcoming}>外汇参考 <small>即将接入</small></span>
    </nav>
    <span className={s.note}>各来源独立展示</span>
  </div>;
}
