'use client';

import React from 'react';
import type { OrganizedReport } from '@/lib/evidence/report-projection';
import s from './evidence.module.css';

type Props = {
  report: OrganizedReport;
  onDownload?: React.MouseEventHandler<HTMLAnchorElement>;
};

/** The original Japan/TPEx monetary view, preserving their separate units. */
export default function OrganizedMonetaryEvidence({
  report,
  onDownload,
}: Props) {
  const filename = `${report.source_id}-${report.period.end}-organized.json`;

  return (
    <details className={s.panel}>
      <summary>整理后的当前证据 · 统一字段与原值追溯</summary>
      <p>
        仅整理当前页面仍允许展示的已校验快照，不再次获取来源。
        {report.presentation.stale
          ? '当前保留的报告已标记陈旧。'
          : '此处可导出不代表实时数据。'}
        合计与组成项重叠，不能一并求和；不同指标、时期与币种不混加。
      </p>
      <dl>
        <div>
          <dt>来源 / 国家角色</dt>
          <dd>
            {report.source.name} · {report.geography.iso3} ·{' '}
            {report.geography.role === 'issuer_market'
              ? '证券发行人市场'
              : '本地市场'}
          </dd>
        </div>
        <div>
          <dt>观察期间 / 原始单位</dt>
          <dd>
            {`${report.period.start} 至 ${report.period.end} · ${report.period.frequency === 'weekly' ? '周度' : '日度'}`}{' '}
            · {report.unit.code}
          </dd>
        </div>
        <div>
          <dt>原生结构</dt>
          <dd>{report.native_schema}</dd>
        </div>
        <div>
          <dt>来源精确发布时间</dt>
          <dd>未提供，保留 null</dd>
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
        下载仅保存到你的设备，不上传或分享。快照失效后本页入口会撤下，已下载文件不会自动撤回。缺失不是
        0；下表缺失表示当前保存结构未包含该字段，不推断原始来源也没有。
      </p>
      <div className={s.scroll}>
        <table>
          <caption>
            当前证据字段 · {report.rows.length} 条（含单列合计，非额外金额）
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
                <td>
                  {row.role === 'reported_total'
                    ? '来源合计（重叠）'
                    : '组成项'}
                </td>
                <td>{row.metric_label}</td>
                <td>
                  {row.state === 'reported'
                    ? String(row.value)
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
