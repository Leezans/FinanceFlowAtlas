'use client';

import React, {useState} from 'react';
import type {NewsCategory, NewsItem, NewsSnapshot, NewsSourceStatus, ScheduledEvent} from '@/lib/news/types';
import {categoryLabels, eventTimeLabel, formatTime, publicationLabel, relatedMarketLinks, visibleSnapshot} from './presentation';
import {useNewsFeed} from './useNewsFeed';
import s from './news.module.css';

type Section = 'news' | 'events' | 'sources';
const regions: Record<string, string> = {USA: '美国', GBR: '英国', CHN: '中国', JPN: '日本', EU: '欧盟', GLOBAL: '全球', TWN: '台湾', BRA: '巴西'};
const regionLabel = (region: string) => regions[region] || region;
const eventStatus = {scheduled: '已排期', tentative: '暂定', cancelled: '已取消'};
const sourceStatus = {ok: '已获取', stale: '上次可用副本', error: '获取失败'};

function SourceLink({url, children}: {url: string; children: React.ReactNode}) {
  return <a href={url} target="_blank" rel="noopener noreferrer">{children}<span aria-hidden="true"> ↗</span><span className={s.srOnly}>（在新标签页打开）</span></a>;
}

function RelatedMarkets({ids}: {ids: string[]}) {
  const links = relatedMarketLinks(ids);
  if (!links.length) return null;
  return <div className={s.related}><span>相关市场入口</span><nav aria-label="相关市场">{links.map(link => <a key={link.id} href={link.href}>{link.label} ↗</a>)}</nav><small>按主题关联，未验证价格影响或资金流因果关系。</small></div>;
}

function NewsCard({item, source, retained}: {item: NewsItem; source?: NewsSourceStatus; retained: boolean}) {
  return <article className={s.card} aria-label={item.title}>
    <div className={s.cardMeta}><span className={s.category}>{categoryLabels[item.category]}</span><span>{item.sourceName}</span>{(retained || source?.status === 'stale') && <span className={s.staleTag}>旧副本</span>}</div>
    <h3><SourceLink url={item.url}>{item.title}</SourceLink></h3>
    <p className={s.time}>{publicationLabel(item)}</p>
    <p className={s.unknown}>事件发生时间：未核验，不能以发布时间代替。</p>
    <div className={s.origin}>来源原文标题 · 单一来源陈述，未独立交叉核验{item.regions.length ? ` · 来源 / 主题地区：${item.regions.map(regionLabel).join('、')}` : ''}</div>
    {item.summary && <details className={s.summary}><summary>查看来源摘要原文</summary><p>{item.summary}</p></details>}
    <RelatedMarkets ids={item.relatedMarkets}/>
  </article>;
}

function EventCard({event, source, retained}: {event: ScheduledEvent; source?: NewsSourceStatus; retained: boolean}) {
  return <article className={s.eventCard} aria-label={event.title}>
    <div className={s.cardMeta}><span className={s.category}>{categoryLabels[event.category]}</span><span className={event.status === 'cancelled' ? s.cancelledTag : s.scheduledTag}>{eventStatus[event.status]}</span>{(retained || source?.status === 'stale') && <span className={s.staleTag}>旧副本 · 请回原站确认</span>}</div>
    <p className={s.eventTime}>{eventTimeLabel(event)}</p>
    <h3><SourceLink url={event.url}>{event.title}</SourceLink></h3>
    <p className={s.time}>来源：{event.sourceName} · 原始时区：{event.timeZone || '未提供'}{!event.startsAt && '；未换算为北京时间'}</p>
    <p className={s.unknown}>{event.status === 'cancelled' ? '来源标记此日程已取消。' : '官方计划日程，不代表事件已经发生；临时变更请以原站为准。'}</p>
    <p className={s.origin}>日程条目发布时间：{event.publishedAt ? `${formatTime(event.publishedAt)}（北京时间）` : '未知'} · 未独立交叉核验</p>
    <RelatedMarkets ids={event.relatedMarkets}/>
  </article>;
}

function SourcePanel({snapshot}: {snapshot: NewsSnapshot}) {
  return <section aria-labelledby="news-sources-title" className={s.sourcePanel}>
    <div className={s.sectionHeading}><div><p className={s.eyebrow}>SOURCE OBSERVATORY</p><h2 id="news-sources-title">逐个来源核验</h2></div><span>{snapshot.sources.length} 个接入来源</span></div>
    <p className={s.help}>仅覆盖下列来源，不是全球新闻全量。来源失败不等于没有发生新闻。官方发布也仅代表发布机构的陈述，来源数量不等于独立证实数量。</p>
    <div className={s.sourceGrid}>{snapshot.sources.map(source => <article className={s.sourceCard} key={source.id}>
      <div className={s.cardMeta}><span>{source.kind === 'events' ? '官方日程' : '新闻发布'}</span><span className={source.status === 'ok' ? s.goodTag : s.staleTag}>{sourceStatus[source.status]}</span></div>
      <h3>{source.name}</h3>
      <dl><div><dt>上次成功获取</dt><dd>{formatTime(source.fetchedAt)}</dd></div><div><dt>最近尝试</dt><dd>{formatTime(source.lastAttemptAt)}</dd></div><div><dt>缓存下次可检查</dt><dd>{source.halted ? '已停止自动重试' : formatTime(source.nextRefreshAt)}</dd></div><div><dt>来源条目</dt><dd>{source.itemCount} 条（筛选前）</dd></div></dl>
      {source.error && <p className={s.sourceError}>获取情况：{source.error}</p>}
      {source.warnings.length > 0 && <ul className={s.warnings}>{source.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
      <p className={s.license}>{source.attribution}<br/>{source.license}</p>
      <div className={s.sourceLinks}><SourceLink url={source.websiteUrl}>官方网站</SourceLink><SourceLink url={source.url}>数据来源</SourceLink><SourceLink url={source.termsUrl}>使用条款</SourceLink></div>
    </article>)}</div>
  </section>;
}

export default function NewsWorkspace() {
  const feed = useNewsFeed();
  const [section, setSection] = useState<Section>('news');
  const [category, setCategory] = useState<NewsCategory | 'all'>('all');
  const [region, setRegion] = useState('all');
  const [query, setQuery] = useState('');
  const [eventState, setEventState] = useState('all');
  const snapshot = feed.snapshot;
  const visible = snapshot && feed.now !== null ? visibleSnapshot(snapshot, feed.now) : {news: [], events: []};
  const allItems = [...visible.news, ...visible.events];
  const regionOptions = [...new Set(allItems.flatMap(item => item.regions))].sort();
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = (item: NewsItem | ScheduledEvent) => (category === 'all' || item.category === category) && (region === 'all' || item.regions.includes(region)) && (!normalizedQuery || `${item.title} ${item.sourceName} ${'summary' in item ? item.summary || '' : ''}`.toLocaleLowerCase().includes(normalizedQuery));
  const news = visible.news.filter(matches);
  const events = visible.events.filter(item => matches(item) && (eventState === 'all' || item.status === eventState));
  const selectedCount = section === 'news' ? news.length : events.length;
  const resetFilters = () => {setCategory('all'); setRegion('all'); setQuery(''); setEventState('all');};
  const filtered = category !== 'all' || region !== 'all' || query.trim() !== '' || (section === 'events' && eventState !== 'all');
  const failedSources = snapshot?.sources.filter(source => source.status !== 'ok').length || 0;
  const agingSources = snapshot && feed.now !== null ? snapshot.sources.filter(source => source.status === 'ok' && source.fetchedAt && feed.now! - Date.parse(source.fetchedAt) > snapshot.cacheTtlSeconds * 1000).length : 0;
  const retainedSource = (id: string) => feed.browserStale || !!(snapshot && feed.now !== null && snapshot.sources.some(source => source.id === id && source.fetchedAt && feed.now! - Date.parse(source.fetchedAt) > snapshot.cacheTtlSeconds * 1000));
  const expiredCount = snapshot ? snapshot.news.length - visible.news.length : 0;
  const getSource = (id: string) => snapshot?.sources.find(source => source.id === id);

  return <main className={s.workspace}>
    <header className={s.hero}>
      <div><p className={s.eyebrow}>FINANCE FLOW ATLAS / GLOBAL BRIEFING</p><h1>全球新闻与日程</h1><p className={s.intro}>跟踪科技、地缘政治与金融的公开发布。<br/>先看来源与时间，再进入相关市场。</p></div>
      <div className={s.timezone}><span>统一阅读时区</span><strong>北京时间 · UTC+8</strong><small>仅对已知时刻换算；日期型日程保留原始日期</small></div>
    </header>

    <section className={s.monitor} aria-label="新闻检查状态">
      <div className={s.statusLine}><span className={s.statusDot} data-state={feed.error || failedSources || agingSources ? 'warning' : snapshot ? 'ok' : 'loading'}/><strong>{feed.browserStale ? '检查失败 · 保留上次结果' : feed.error ? '本次检查未完成' : snapshot?.status === 'unavailable' ? '来源暂不可用' : snapshot?.status === 'partial' ? '部分来源未更新' : agingSources ? '来源快照待更新' : snapshot ? '来源快照已载入' : '正在连接公开来源'}</strong><button type="button" className={s.refresh} disabled={feed.pending || feed.blocked} onClick={feed.refresh}>{feed.pending ? '正在检查…' : '重新检查'}</button></div>
      <p>本页前台约每 5 分钟检查；服务端来源缓存约 {snapshot ? Math.round(snapshot.cacheTtlSeconds / 60) : 15} 分钟。关闭页面或切到后台后不保证检查，不提供后台推送。</p>
      <div className={s.checkMeta}><span>浏览器最近成功检查：{formatTime(feed.lastCheckedAt)}</span><span>服务端快照生成：{formatTime(snapshot?.generatedAt || null)}</span><span>获取时间不是新闻发生时间。</span></div>
      <label className={s.notify}><input type="checkbox" checked={feed.notifications} onChange={event => feed.setNotifications(event.target.checked)}/>开启本页新条目提示<span>仅此次打开，不申请系统通知权限</span></label>
    </section>

    {feed.newCount > 0 && <div role="status" className={s.arrivals}><span>本次打开期间新增 {feed.newCount} 条新闻 / 日程，已加入下方列表；当前筛选可能隐藏部分条目。</span><button type="button" onClick={feed.dismissNew}>知道了</button></div>}
    {feed.error && <p role="alert" className={s.error}>{feed.error}{feed.browserStale && ' 仅保留 24 小时内获取的副本；原始时间不变。'}</p>}
    {!!failedSources && <p className={s.notice}>{failedSources} 个来源获取失败或使用旧副本。{snapshot?.status === 'unavailable' ? '当前没有可展示的来源内容。' : '以下结果不完整。'} <button type="button" onClick={() => setSection('sources')}>查看来源状态</button></p>}
    {agingSources > 0 && <p className={s.notice}>{agingSources} 个来源副本已超过缓存检查间隔，请重新检查；页面上的获取时间仍是原始获取时间。</p>}
    {expiredCount > 0 && <p className={s.notice}>已隐藏 {expiredCount} 条超出副本保留期或来源不可用的新闻，请重新检查。</p>}

    <nav className={s.sections} aria-label="新闻与日程视图">
      <button type="button" aria-pressed={section === 'news'} onClick={() => setSection('news')}>新闻发布 <span>{visible.news.length}</span></button>
      <button type="button" aria-pressed={section === 'events'} onClick={() => setSection('events')}>未来日程 <span>{visible.events.length}</span></button>
      <button type="button" aria-pressed={section === 'sources'} onClick={() => setSection('sources')}>来源状态 <span>{snapshot?.sources.length ?? '—'}</span></button>
    </nav>

    {section !== 'sources' && <section className={s.filters} aria-label="筛选新闻与日程">
      <div className={s.categories} role="group" aria-label="主题分类">{(['all', 'technology', 'geopolitics', 'finance'] as const).map(value => <button type="button" key={value} aria-pressed={category === value} onClick={() => setCategory(value)}>{value === 'all' ? '全部主题' : categoryLabels[value]}</button>)}</div>
      <div className={s.filterFields}><label>搜索标题 / 来源<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="输入关键词，也可搜索原文"/></label><label>来源 / 主题地区<select value={region} onChange={event => setRegion(event.target.value)}><option value="all">全部地区</option>{region !== 'all' && !regionOptions.includes(region) && <option value={region}>{regionLabel(region)}（当前无条目）</option>}{regionOptions.map(value => <option key={value} value={value}>{regionLabel(value)}</option>)}</select></label>{section === 'events' && <label>日程状态<select value={eventState} onChange={event => setEventState(event.target.value)}><option value="all">全部状态</option>{Object.entries(eventStatus).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>}{filtered && <button type="button" className={s.clear} onClick={resetFilters}>清除筛选</button>}</div>
    </section>}

    {feed.pending && !snapshot && <div role="status" className={s.loading}><span className={s.loader}/><h2>正在获取来源快照</h2><p>各来源独立检查；无可用数据时会如实显示，不填入示例新闻。</p></div>}

    {section === 'sources' ? snapshot ? <SourcePanel snapshot={snapshot}/> : !feed.pending && <div className={s.empty}><h2>暂未收到来源状态</h2><p>请重新检查。连接失败不代表没有新闻。</p></div> : snapshot && <section aria-labelledby="news-list-title" aria-busy={feed.pending}>
      <div className={s.sectionHeading}><div><p className={s.eyebrow}>{section === 'news' ? 'PUBLISHED UPDATES' : 'OFFICIAL CALENDAR'}</p><h2 id="news-list-title">{section === 'news' ? '最近 30 天的公开发布' : '未来 90 天的官方日程'}</h2></div><span>{selectedCount} 条{filtered ? '符合筛选' : ''}</span></div>
      <p className={s.help}>{section === 'news' ? '发布时间未知的条目仍保留并标注。标题与摘要保留来源原文；不同来源并列不代表交叉证实。' : '日程单独展示，不混入已发布新闻。仅日期条目不推断具体时刻；时区未知时以 UTC 日期筛选，仍需回原站确认。'}</p>
      {selectedCount ? <div className={s.feed}>{section === 'news' ? news.map(item => <NewsCard key={item.id} item={item} source={getSource(item.sourceId)} retained={retainedSource(item.sourceId)}/>) : events.map(event => <EventCard key={event.id} event={event} source={getSource(event.sourceId)} retained={retainedSource(event.sourceId)}/>)}</div> : <div className={s.empty}><p className={s.eyebrow}>NO MATCHING ITEMS</p><h3>{filtered ? '没有符合筛选的条目' : section === 'events' ? '当前来源没有可展示的未来日程' : '当前没有可展示的新闻'}</h3><p>{filtered ? '试试其他主题、地区或关键词。' : '可能暂无条目、来源暂不可用或副本已过期；不代表全球没有相关事件。'}</p>{filtered && <button type="button" onClick={resetFilters}>清除筛选</button>}</div>}
    </section>}
    {!feed.pending && !snapshot && section !== 'sources' && <div className={s.empty}><h2>新闻列表等待可用来源</h2><p>当前未展示新闻或日程。上方「重新检查」可再次尝试。</p></div>}

    <footer className={s.footer}><strong>读新闻，也保留边界。</strong><p>{snapshot?.disclaimer || '这是精选公开来源的阅读入口，不是完整新闻服务、事实裁决或投资建议。'}</p><p>新闻按规范化原文链接去重；日程还保留事件标识与开始时间，避免合并不同日期的同名发布。不做同一事件的语义合并。{snapshot && `本次去重移除新闻 ${snapshot.dedup.newsRemoved} 条、日程 ${snapshot.dedup.eventsRemoved} 条。`}同一事件的不同报道可能并列，不能据此认定已获得独立证实。</p><p>地区是来源 / 主题标签，不代表影响范围。相关市场入口仅帮助浏览，不能证明新闻导致价格变化或资金流入。</p><a href="/markets">回到全球市场矩阵 ↗</a></footer>
  </main>;
}
