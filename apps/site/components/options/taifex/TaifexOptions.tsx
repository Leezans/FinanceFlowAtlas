'use client';
import React from 'react';
import {useReport} from '@/components/markets/useReport';
import {replySchema,visibleSnapshot,reportAge,REFRESH_MS,STALE_REPORT_DAYS} from '@/lib/options/taifex/model';
import TaifexMatrix from './TaifexMatrix';
import s from './taifex.module.css';
const parse=(value:unknown)=>replySchema.parse(value);
export default function TaifexOptions(){
 const {reply,loading,failure,now,refresh,coolingDown}=useReport('/api/v1/options/taifex/snapshot',parse,REFRESH_MS);
 const snapshot=visibleSnapshot(reply,now),blocked=failure==='permission'||reply?.status.state==='denied';
 const stale=!!snapshot&&(failure==='network'||reply?.status.state==='stale'||now-Date.parse(snapshot.fetched_at)>REFRESH_MS||reportAge(snapshot,now)>STALE_REPORT_DAYS);
 const problem=failure==='permission'?'展示權限已失效':blocked?'來源存取已停止':failure==='invalid'?'回應資料未通過校驗':failure==='network'?'更新失敗，僅保留仍有效的舊報表':null;
 return <main className={s.page}><nav className={s.notice} aria-label="期權市場導覽"><a href="/options">Deribit BTC / ETH 期权</a></nav><header className={s.header}><div><p className={s.eyebrow}>TAIFEX / DAILY INSTITUTIONAL OPTIONS</p><h1>臺灣法人選擇權成交矩陣</h1><p><a href="/futures/taiwan">查看臺灣法人期貨名義金額日報</a> · 期貨與期權共用來源檢查及停止狀態。</p><p>TAIFEX 三類法人日報：自營商、投信、外資及陸資。不是全市場投資人或全球期權覆蓋。</p></div><button type="button" disabled={loading||blocked||coolingDown} onClick={()=>void refresh()}>{loading?'正在檢查…':'檢查更新'}</button></header>
 <div className={s.notice} role="status"><strong>{problem??(snapshot?(stale?'上次有效報表 · 已陳舊':'已核驗官方日報'):'暫無可核驗報表')}</strong><p>API 報表日期：{snapshot?.report_date??'未提供'}（臺北交易日）；不宣稱為交易所最新日期。</p><p>最近成功取得：{snapshot?.fetched_at??'未提供'} · 實際來源發布時間：未知。</p><p>每日統計，每 1 小時檢查更新；不是即時行情。報表超過 4 日或取得超過 1 小時標為陳舊；取得超過 24 小時或報表超過 14 日不再展示。</p></div>
 <TaifexMatrix snapshot={snapshot}/>
 <aside className={s.notice}><p>資金淨流入：此來源不提供。成交金額為權利金 × 契約乘數 × 成交口數，不是標的名目曝險。來源買賣淨額也不是現金淨流入。</p><p>包含指數、股票及 ETF 選擇權與鉅額交易。適用商品的交易日報表包含前一夜盤，不是獨立夜盤或即時資料。API 發布延遲、SLA 與請求額度未確認。</p><p>資料提供：TAIFEX / 金融監督管理委員會證券期貨局。依政府資料開放授權條款第 1 版使用；不代表資料提供機關認可本服務。</p><p><a href="https://data.gov.tw/dataset/11600" target="_blank" rel="noreferrer">政府開放資料集</a> · <a href="https://data.gov.tw/license" target="_blank" rel="noreferrer">政府資料開放授權條款 v1</a> · <a href="https://www.taifex.com.tw/cht/3/callsAndPutsDate" target="_blank" rel="noreferrer">官方日報</a> · <a href="https://www.taifex.com.tw/cht/7/monthlyOptData" target="_blank" rel="noreferrer">成交金額單位說明</a></p></aside></main>;
}
