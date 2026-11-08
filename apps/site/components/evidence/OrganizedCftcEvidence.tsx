'use client';

import React from 'react';
import type { OrganizedCftcReport } from '@/lib/evidence/cftc-projection';
import BlobEvidenceDownload from './BlobEvidenceDownload';
import s from './evidence.module.css';

export const CFTC_PREVIEW_LIMIT = 120;

type Props = {
  report: OrganizedCftcReport;
  onDownload?: React.MouseEventHandler<HTMLAnchorElement>;
};

export default function OrganizedCftcEvidence({ report, onDownload }: Props) {
  const filename = `${report.source_id}-${report.period.end}-organized.json`;
  const preview = report.rows.slice(0, CFTC_PREVIEW_LIMIT);

  return (
    <details className={s.panel}>
      <summary>整理后的当前证据 · 统一字段与原值追溯</summary>
      <p>
        仅整理当前页面仍允许展示的已校验快照，不再次获取来源。
        {report.presentation.stale
          ? '当前保留的报告已标记陈旧。'
          : '此处可导出不代表实时数据。'}
        本期与前期的原始持仓字段，单位是各市场自身合约张数，不是资金流、成交量或名义金额。多空两侧、spreading
        与未平仓量（OI）重叠，不一起相加，也不跨品种合计。
      </p>
      <dl>
        <div>
          <dt>来源 / 国家角色</dt>
          <dd>
            {report.source.name} · {report.geography.iso3} ·
            监管报告市场（不代表标的所在地）
          </dd>
        </div>
        <div>
          <dt>观察期间 / 原始单位</dt>
          <dd>
            {`本期持仓时点 ${report.period.current_report_date}；前期按每行日期保留，不是两期之间的流量`}{' '}
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
        <div>
          <dt>实际覆盖 / 结构版本</dt>
          <dd>
            {report.coverage.legacy
              ? '旧版 4 市场，未扩展为 52 市场'
              : '当前 52 市场'}{' '}
            · {report.coverage.market_count} 个市场 /{' '}
            {report.coverage.category_count} 个应用导航品类；不代表全球覆盖
          </dd>
        </div>
        <div>
          <dt>保留的前期日期</dt>
          <dd>
            {report.period.previous_report_dates.join(' / ')}
            ；各行保留对应日期，不强制推断为 7 天
          </dd>
        </div>
        <div>
          <dt>采集开始 / 最近成功获取</dt>
          <dd>
            {report.clocks.acquisition_started_at} / {report.clocks.fetched_at}
          </dd>
        </div>
        <div>
          <dt>来源与发布安排</dt>
          <dd>
            <a href={report.source.urls[0]} target="_blank" rel="noreferrer">
              CFTC Legacy Futures Only · 6dca-aqww
            </a>{' '}
            ·{' '}
            <a href={report.source.urls[1]} target="_blank" rel="noreferrer">
              官方发布日历
            </a>
            ；通常周度，实际发布时间未知，许可链接未确认
          </dd>
        </div>
      </dl>
      <BlobEvidenceDownload
        report={report}
        filename={filename}
        onDownload={onDownload}
      />
      <p>
        下载仅保存到你的设备，不上传或分享。快照失效后本页入口会撤下，已下载文件不会自动撤回。下载包含全部保留市场、本期与前期以及八个持仓字段，不受交易者选择或品种选择影响。严格校验原生结构，不补造缺失市场或字段，不重新计算净持仓与变化。
      </p>
      <p>
        品类来自本应用导航清单，不是 CFTC
        行业分类。合约规格原文不是金额换算系数；每个市场涵盖所有到期月份。每份未平仓合约同时有多头与空头，非商业
        spreading 分别进入两侧的 OI
        平衡关系。美国报告场所不等于标的国家；不提供全球标的归属或总量。
      </p>
      <div className={s.scroll}>
        <table>
          <caption>
            当前证据字段 · {report.rows.length} 条
            {`（预览前 ${preview.length} 条，JSON 包含全部；持仓字段重叠，不求和）`}
          </caption>
          <thead>
            <tr>
              <th>合约市场</th>
              <th>应用导航品类 / 合约规格</th>
              <th>持仓观测日期</th>
              <th>行类型</th>
              <th>指标</th>
              <th>原值 / {report.unit.code}</th>
              <th>原字段路径</th>
            </tr>
          </thead>
          <tbody>
            {preview.map((row) => (
              <tr key={row.id}>
                <td>
                  {`${row.dimension.label} · ${row.dimension.id}`}
                  <small className={s.identity}>
                    {row.dimension.namespace}:{row.dimension.id}
                  </small>
                </td>
                <td>
                  {row.category.label}
                  <small className={s.identity}>
                    {row.category.namespace}:{row.category.id} · 非来源行业分类
                  </small>
                  <small className={s.identity}>{row.contract.units}</small>
                </td>
                <td>
                  {row.observation.slot === 'current' ? '本期' : '前期'} ·{' '}
                  {row.observation.date}
                  <small className={s.identity}>
                    {row.observation.native_locator}
                  </small>
                </td>
                <td>持仓字段（重叠）</td>
                <td>{row.metric_label}</td>
                <td>{String(row.value)}</td>
                <td>{row.native_locator ?? '无对应字段'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
