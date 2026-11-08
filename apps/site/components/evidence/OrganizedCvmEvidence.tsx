'use client';

import React from 'react';
import type { OrganizedCvmReport } from '@/lib/evidence/cvm-projection';
import BlobEvidenceDownload from './BlobEvidenceDownload';
import s from './evidence.module.css';

export const CVM_PREVIEW_LIMIT = 120;

type Props = {
  report: OrganizedCvmReport;
  onDownload?: React.MouseEventHandler<HTMLAnchorElement>;
};

export default function OrganizedCvmEvidence({ report, onDownload }: Props) {
  const filename = `${report.source_id}-${report.period.end}-organized.json`;
  const preview = report.rows.slice(0, CVM_PREVIEW_LIMIT);

  return (
    <details className={s.panel}>
      <summary>整理后的当前证据 · 统一字段与原值追溯</summary>
      <p>
        仅整理当前页面仍允许展示的已校验快照，不再次获取来源。
        {report.presentation.stale
          ? '当前保留的报告已标记陈旧。'
          : '此处可导出不代表实时数据。'}
        仅公开披露基金的股票月度买卖，不是全市场资金流。原值保留
        BRL_cents（整数分），不是 BRL 元；1 BRL_cents = 0.01
        BRL，仅提供换算元数据，不改变原值。
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
          <dd>
            {`${report.period.start} 至 ${report.period.end} · 月度`} ·{' '}
            {report.unit.code}
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
          <dt>交易观测月 / 分类获取日</dt>
          <dd>
            {report.period.observation_month} /{' '}
            {report.classification.industry.date}
            ；分类非历史时点，classification_point_in_time: false
          </dd>
        </div>
        <div>
          <dt>证券覆盖 / 保密记录</dt>
          <dd>
            {report.coverage.known_security_count} /{' '}
            {report.coverage.security_count} 只证券有完整公开交易金额；
            {report.coverage.unavailable_security_count} 只不可用；
            {report.coverage.counts.confidential_rows} 条保密汇总未分配
          </dd>
        </div>
        <div>
          <dt>采集开始 / 最近成功获取</dt>
          <dd>
            {report.clocks.acquisition_started_at} / {report.clocks.fetched_at}
          </dd>
        </div>
        <div>
          <dt>来源与许可</dt>
          <dd>CDA / FCA 原始 ZIP 的 SHA-256 均保留于 JSON；ODbL-1.0</dd>
        </div>
      </dl>
      <BlobEvidenceDownload
        report={report}
        filename={filename}
        onDownload={onDownload}
      />
      <p>
        下载仅保存到你的设备，不上传或分享。快照失效后本页入口会撤下，已下载文件不会自动撤回。下载包含当前目录全部证券，不受行业下钻或证券选择影响。金额不可用保留
        null，与已报告零值分开；原字段路径指向实际为 null 的
        flow，不推断具体缺失原因。
      </p>
      <p>
        买入、卖出沿用原适配器对已披露交易的加总；买卖差额沿用其买入减卖出，不是独立的来源净流入字段。不新增行业或市场合计；热图行业小计与这些证券重叠，不能相加。公开与保密基金数也可能重叠，保密金额不分配。没有有效记录、金额不全或重复隔离都可能使
        flow 为 null。
      </p>
      <div className={s.scroll}>
        <table>
          <caption>
            当前证据字段 · {report.rows.length} 条
            {`（预览前 ${preview.length} 条，JSON 包含全部；仅证券组成项，无额外合计）`}
          </caption>
          <thead>
            <tr>
              <th>证券</th>
              <th>官方行业</th>
              <th>行类型</th>
              <th>指标</th>
              <th>原值 / {report.unit.code}</th>
              <th>原字段路径</th>
              <th>值的来源</th>
            </tr>
          </thead>
          <tbody>
            {preview.map((row) => (
              <tr key={row.id}>
                <td>
                  {row.dimension.label}
                  <small className={s.identity}>
                    {row.dimension.namespace}:{row.dimension.id}
                  </small>
                </td>
                <td>
                  {row.industry.label}
                  <small className={s.identity}>
                    {row.industry.namespace}:{row.industry.id} ·{' '}
                    {row.industry.classification_date} · 非历史时点
                  </small>
                </td>
                <td>组成项</td>
                <td>{row.metric_label}</td>
                <td>
                  {row.state === 'reported'
                    ? String(row.value)
                    : row.state === 'source_aggregate_unavailable'
                      ? '公开交易金额不可用 · null'
                      : '未保留 · null'}
                </td>
                <td>{row.native_locator ?? '无对应字段'}</td>
                <td>
                  {row.value_origin === 'adapter_sum_of_disclosed_transactions'
                    ? '原适配器汇总公开交易'
                    : row.value_origin === 'adapter_difference_of_aggregates'
                      ? '原适配器买入减卖出'
                      : '汇总金额不可用'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
