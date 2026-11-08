'use client';

import React from 'react';
import {
  ashareExportFilename,
  type OrganizedAshareReport,
} from '@/lib/evidence/ashare-projection';
import s from './evidence.module.css';

type Props = {
  report: OrganizedAshareReport;
  onDownload?: React.MouseEventHandler<HTMLAnchorElement>;
};

/** Display only; the A-share workspace wrapper owns scope and expiry checks. */
export default function OrganizedAshareReportEvidence({
  report,
  onDownload,
}: Props) {
  const filename = ashareExportFilename(report);

  return (
    <details className={s.panel}>
      <summary>整理后的当前证据 · 统一字段与原值追溯</summary>
      <p>
        仅整理当前页面仍允许展示的已校验快照，不再次获取来源。
        {report.presentation.stale
          ? '当前保留的报告已标记陈旧。'
          : '此处可导出不代表实时数据。'}
        仅整理主力净额
        f62，东财大单与超大单口径估算，不是全市场资金净流入。行业层级、行业与成分股、不同范围之间均不求和。
      </p>
      <dl>
        <div>
          <dt>来源 / 国家角色</dt>
          <dd>
            {report.source.name} · {report.geography.iso3} · 本地市场
          </dd>
        </div>
        <div>
          <dt>观察期间 / 原始单位</dt>
          <dd>观察期间与交易日期未知（null） · {report.unit.code}</dd>
        </div>
        <div>
          <dt>原生结构</dt>
          <dd>{report.native_schema}</dd>
        </div>
        <div>
          <dt>来源精确发布时间</dt>
          <dd>未提供，保留 null</dd>
        </div>
        <div>
          <dt>东财分类范围</dt>
          <dd>
            {report.scope.fs} · {report.scope.classification_level}
            ；分类成员互斥性未建立
          </dd>
        </div>
        <div>
          <dt>最近完整采集 / 保留期限</dt>
          <dd>
            {report.clocks.fetched_at}；按最早采集时间保留不足 24
            小时，不是行情有效期
          </dd>
        </div>
      </dl>
      <a
        className={s.download}
        href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(report, null, 2))}`}
        download={filename}
        onClick={onDownload}
      >
        下载整理后的 JSON
      </a>
      <p>
        下载仅保存到你的设备，不上传或分享。快照失效后本页入口会撤下，已下载文件不会自动撤回。包含当前来源范围的全部行，不受矩阵搜索或方向筛选影响。缺失标记与已报告零值分开保留；原生行仅保留已知字段，额外字段不导出。
      </p>
      <p>
        来源资金观测时点、交易日期与延迟均未知；采集时间不代替这些信息。保留的其他原字段不自动解释为
        CNY 或纳入统一指标；再分发许可未确认。
      </p>
      <div className={s.scroll}>
        <table>
          <caption>
            当前证据字段 · {report.rows.length} 条（当前来源范围，无推算合计）
          </caption>
          <thead>
            <tr>
              <th>维度</th>
              <th>行类型</th>
              <th>指标</th>
              <th>原值 / {report.unit.code}</th>
              <th>原字段路径</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <tr key={row.id}>
                <td>
                  {row.dimension.label}
                  <small className={s.identity}>
                    {row.dimension.namespace}:{row.dimension.id}
                  </small>
                </td>
                <td>来源范围成员（不求和）</td>
                <td>{row.metric_label}</td>
                <td>
                  {row.state === 'reported'
                    ? String(row.value)
                    : row.state === 'source_missing_marker'
                      ? '来源缺失标记 · null'
                      : '未保留 · null'}
                </td>
                <td>{row.native_locator ?? '无对应字段'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
