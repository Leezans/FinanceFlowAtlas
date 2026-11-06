'use client';
import React from 'react';
import {useReport} from '@/components/markets/useReport';
import {replySchema,visibleSnapshot,reportAge,REFRESH_MS,STALE_REPORT_DAYS} from '@/lib/futures/taifex/model';
import TaifexMatrix from './TaifexMatrix';
import s from './taifex.module.css';
const parse=(value:unknown)=>replySchema.parse(value);
export default function TaifexFutures(){
 const {reply,loading,failure,now,refresh,coolingDown}=useReport('/api/v1/futures/taifex/snapshot',parse,REFRESH_MS);
 const snapshot=visibleSnapshot(reply,now),blocked=failure==='permission'||reply?.status.state==='denied';
 const stale=!!snapshot&&(failure==='network'||reply?.status.state==='stale'||now-Date.parse(snapshot.fetched_at)>REFRESH_MS||reportAge(snapshot,now)>STALE_REPORT_DAYS);
 const problem=failure==='permission'?'展示權限已失效':blocked?'來源存取已停止':failure==='invalid'?'回應資料未通過校驗':failure==='network'?'更新失敗，僅保留仍有效的舊報表':null;
 return <main className={s.page}><nav className={s.notice} aria-label="期權市場導覽"><a href="/futures">CFTC 期貨持倉</a> · <a href="/options/taiwan">臺灣法人選擇權</a></nav><header className={s.header}><div><p className={s.eyebrow}>TAIFEX / DAILY INSTITUTIONAL FUTURES</p><h1>臺灣法人期貨契約名目成交矩陣</h1><p>TAIFEX 三類法人日報：自營商、投信、外資及陸資。僅涵蓋 TAIFEX 指數、股票及 ETF 期貨，不是全市場投資人或全球期貨覆蓋。</p></div><button type="button" disabled={loading||blocked||coolingDown} onClick={()=>void refresh()}>{loading?'正在檢查…':'檢查更新'}</button></header>
 <div className={s.notice} role="status"><strong>{problem??(snapshot?(stale?'上次有效報表 · 已陳舊':'已核驗官方日報'):'暫無可核驗報表')}</strong><p>API 報表日期：{snapshot?.report_date??'未提供'}（臺北交易日）；不宣稱為交易所最新日期。</p><p>最近成功取得：{snapshot?.fetched_at??'未提供'} · 實際來源發布時間：未知。</p><p>每日統計，每 1 小時檢查更新；不是即時行情。報表超過 4 日或取得超過 1 小時標為陳舊；取得超過 24 小時或報表超過 14 日不再展示。</p></div>
 <div className={s.notice} aria-label="報表覆蓋範圍"><p>{snapshot?`本報表涵蓋 ${snapshot.covered_products.length} 個商品群組、${snapshot.rows.length} 列法人資料；來源共 ${snapshot.source_product_count} 個商品群組，排除 ${snapshot.excluded_product_count} 個群組、${snapshot.excluded_row_count} 列。`:'涵蓋與排除數量：尚無有效報表，未知。'}</p><p>只展示實際收到且通過商品及 TWD 幣別核驗的群組；未核驗群組排除，未提供的商品不補零。指數商品可能重疊，不代表互斥產業。</p></div>
 <TaifexMatrix snapshot={snapshot}/>
 <aside className={s.notice}><p>資金淨流入：此來源不提供。成交金額為成交價 × 契約乘數 × 口數加總的期貨契約名目成交金額（contract notional turnover），不是選擇權權利金、保證金、實際投入現金或現金淨流入。來源買賣淨額也不是資金流向。</p><p>範圍限 TAIFEX 指數、股票及 ETF 期貨，含以新臺幣計價的外國標的指數；不含匯率、商品期貨，也不是全球市場完整覆蓋。選擇權另頁展示，不混算。</p><p>適用商品的交易日報表包含前一夜盤，不是獨立夜盤或即時資料。商品群組可能有標的重疊。未平倉契約名目金額只在明細展示，不與成交金額加總。</p><p>每 1 小時檢查屬本應用 TAIFEX 共用來源預算政策，不是官方 API 配額。API 發布延遲、SLA 與官方請求額度未確認。</p><p>資料提供：TAIFEX / 金融監督管理委員會證券期貨局。依政府資料開放授權條款第 1 版使用；不代表資料提供機關認可本服務。</p><p><a href="https://data.gov.tw/dataset/11596" target="_blank" rel="noreferrer">政府開放資料集</a> · <a href="https://www.taifex.com.tw/cht/3/futContractsDate" target="_blank" rel="noreferrer">官方期貨法人日報</a> · <a href="https://data.gov.tw/license" target="_blank" rel="noreferrer">政府資料開放授權條款 v1</a></p></aside></main>;
}
