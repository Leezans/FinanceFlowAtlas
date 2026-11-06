'use client';
import React,{useState} from 'react';
import MatrixHeatmap from '@/components/matrix/MatrixHeatmap';
import {replySchema,visibleSnapshot,REFRESH_MS,STALE_REPORT_DAYS,reportAge} from '@/lib/japan/model';
import {assetLabels,japanGroups,japanMoney,type JapanAsset} from '@/lib/japan/view';
import {useReport} from './useReport';
import s from './markets.module.css';

const parse=(value:unknown)=>replySchema.parse(value);
const stamp=(value:string|null|undefined)=>value?value.replace('T',' ').replace('Z',' UTC'):'未取得';
export default function JapanMoney(){
  const {reply,loading,failure,now,refresh,nextDeadline,coolingDown}=useReport('/api/v1/japan/mof/snapshot',parse,REFRESH_MS);
  const [assetId,setAssetId]=useState<JapanAsset|null>(null);
  const snapshot=visibleSnapshot(reply,now),denied=reply?.status.state==='denied'||failure==='permission';
  const stale=!!snapshot&&(failure==='network'||reply?.status.state==='stale'||now-Date.parse(snapshot.fetched_at)>REFRESH_MS||reportAge(snapshot,now)>STALE_REPORT_DAYS);
  const nextCheck=nextDeadline>0?(Number.isFinite(nextDeadline)&&nextDeadline<=8.64e15?stamp(new Date(nextDeadline).toISOString()):'来源要求暂停，恢复时间超出可显示范围'):'未取得';
  const selected=snapshot?.assets.find(asset=>asset.id===assetId);
  return <section aria-label="日本证券非居民净买卖金额">
    <div className={s.ownStatus} role="status"><div><strong>{denied?'来源访问已停止，金额保持空白':loading&&!snapshot?'正在核验日本财务省周报':snapshot?stale?'保留最近已核验周报 · 注意时效':'已取得日本证券跨境交易周报':'暂无可核验的日本证券周报'}</strong>
      <p>{denied?'停止自动获取，不切换来源地址绕过限制。':failure==='invalid'?'响应未通过校验，已清空金额。':failure==='network'?'连接失败；仅保留仍有效的已核验周报，原获取时间不变。':'页面可见时按来源许可检查，正常间隔 6 小时；更长暂停会保留。这里是非居民买卖日本证券的周度统计，不是实时资金流。'}</p>
    </div><button onClick={()=>void refresh()} disabled={loading||denied||coolingDown}>{loading?'正在检查…':'检查周报'}</button></div>
    <div className={s.ownTimes}>
      <span>交易统计期间 <b>{snapshot?`${snapshot.report_start} 至 ${snapshot.report_end}`:'未取得'}</b></span>
      <span>文件更新日期 <b>{snapshot?.updated_date??'未取得'}</b></span>
      <span>来源实际发布时间 <b>文件未提供精确时间</b></span>
      <span>最近成功获取 <b>{stamp(snapshot?.fetched_at)}</b></span>
      <span>下次可检查 <b>{denied?'已停止':nextCheck}</b></span>
      <span>最近尝试 <b>{stamp(reply?.status.last_attempt_at)}</b></span>
    </div>
    {snapshot&&<div className={s.ownNet}><span>报告证券合计 · 非居民{snapshot.total_net>0?'净取得':snapshot.total_net<0?'净处置':'零净额'}</span><strong>{japanMoney(snapshot.total_net)}</strong><span>仅指定报告机构样本，不是日本全国资金流总计</span></div>}
    <MatrixHeatmap groups={japanGroups(snapshot)} title="日本证券 · 非居民净买卖矩阵" description={`${snapshot?`${snapshot.report_start} 至 ${snapshot.report_end}`:'等待来源周报'} · 亿日元 · 资产类别，不是行业`}
      colorMeaning="红色净取得、绿色净处置；保留官方净额及其方向。" areaMeaning="同周三类证券净额绝对值；来源合计单独显示，不重复占面积。"
      scopeKey={`japan-mof:${snapshot?.report_end??'empty'}`} selectedItemId={assetId??undefined} onSelect={item=>setAssetId(item.id as JapanAsset)}
      emptyTitle="日本证券净买卖暂无可用周报" emptyMessage="来源未通过校验、缓存过期或访问停止时金额留空。不以美国 TIC、价格涨跌或模拟值代替。"/>
    {selected&&<section className={s.participantDetail} aria-label="所选日本证券类别证据"><h3>{assetLabels[selected.id]}</h3><dl>
      <div><dt>取得金额</dt><dd>{japanMoney(selected.acquisitions)}</dd></div>
      <div><dt>处置金额</dt><dd>{japanMoney(selected.dispositions)}</dd></div>
      <div><dt>官方净额</dt><dd>{japanMoney(selected.net)}</dd></div>
    </dl><p className={s.ownFootnote}>正值为非居民净取得，负值为净处置。债务证券处置包括到期偿还。源表按亿日元四舍五入，官方净额和合计可能与展示分项相差少量单位，保留来源原值。</p></section>}
    <p className={s.ownFootnote}>来源为日本财务省指定主要金融机构报告，按证券发行人居住地识别日本证券，不按计价货币识别。股票与投资基金份额合并；不包含所有日本投资者或完整国际收支，不提供行业、公司或投资者来源国家分解，因此不制造行业或个股下钻。</p>
    <details className={s.ownDisclosure}><summary>官方来源、授权与统计时效</summary>
      <p>资料来源：<a href="https://www.mof.go.jp/english/policy/international_policy/reference/itn_transactions_in_securities/index.htm" target="_blank" rel="noreferrer">日本财务省 International Transactions in Securities ↗</a> · <a href="https://www.mof.go.jp/policy/international_policy/reference/itn_transactions_in_securities/week.csv" target="_blank" rel="noreferrer">官方周度 CSV ↗</a></p>
      <p><a href="https://www.mof.go.jp/english/about_mof/notice/index.html" target="_blank" rel="noreferrer">财务省复用说明 ↗</a> · <a href="https://www.digital.go.jp/en/resources/open_data/public_data_license_v1.0" target="_blank" rel="noreferrer">Public Data License 1.0 ↗</a>。本应用提取对内证券投资栏目并绘图，不代表财务省制作或背书。</p>
      <p>统计按成交日（偿还按偿还日）计入。一般按周公布，节假日按<a href="https://www.mof.go.jp/english/policy/international_policy/reference/itn_transactions_in_securities/schedule.htm" target="_blank" rel="noreferrer">官方日程 ↗</a>调整；可能修订旧期。文件更新日期、统计期间和成功获取时间分别保留，不把计划发布时间当作实际发布证据。</p>
      <p>报告期末超过 14 天标记陈旧，超过 35 天或获取缓存超过 7 天后隐藏金额。页面关闭后没有后台采集。JPX 投资者分类是另一来源，目前未启用，不能与本表混称。</p>
    </details>
  </section>;
}
