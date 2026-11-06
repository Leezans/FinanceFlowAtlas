import React from 'react';
import s from './crypto.module.css';

/** Shared disclosure for both consumers of the access-driven Kraken feed. */
export default function KrakenRefreshNotice(){
 return <p className={s.matrixNote} aria-label="行情检查触发方式">仅在页面打开且可见时约每 60 秒检查；隐藏或关闭后不再安排轮询，没有后台持续采集。已有快照超过 15 分钟会停止展示；暂无快照不等于来源拒绝或故障。检查仍遵守共享冷却和停止状态，不保证每次取得新行情。</p>;
}
