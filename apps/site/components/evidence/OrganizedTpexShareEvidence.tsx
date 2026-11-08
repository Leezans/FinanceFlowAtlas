'use client';

import React from 'react';
import type { OrganizedTpexShareReport } from '@/lib/evidence/tpex-share-projection';
import BlobEvidenceDownload from './BlobEvidenceDownload';
import s from './evidence.module.css';

export const TPEX_SHARE_PREVIEW_LIMIT = 120;

type Props = {
  report: OrganizedTpexShareReport;
  onDownload?: React.MouseEventHandler<HTMLAnchorElement>;
};

export default function OrganizedTpexShareEvidence({
  report,
  onDownload,
}: Props) {
  const filename = `${report.source_id}-${report.period.end}-organized.json`;
  const preview = report.rows.slice(0, TPEX_SHARE_PREVIEW_LIMIT);

  return (
    <details className={s.panel}>
      <summary>整理后的当前证据 · 统一字段与原值追溯</summary>
      <p>
        仅整理当前页面仍允许展示的已校验快照，不再次获取来源。
        {report.presentation.stale
          ? '当前保留的报告已标记陈旧。'
          : '此处可导出不代表实时数据。'}
        每家公司保留全部法人类别的买进、卖出与净股数。法人合计与分项重叠，不能一并求和；股数不是金额，不换算币种，也不代表全市场资金净流入。
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
            {`${report.period.start} 至 ${report.period.end} · 日度`} ·{' '}
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
          <dt>官方行业分类日期 / 命名空间</dt>
          <dd>
            {report.classification.industry.date} ·{' '}
            {report.classification.industry.namespace}
          </dd>
        </div>
        <div>
          <dt>公司覆盖 / 未匹配证券</dt>
          <dd>
            {report.coverage.matched_company_count} /{' '}
            {report.coverage.company_count} 家有报告；
            {report.coverage.missing_company_count} 家缺少法人记录；
            {report.coverage.excluded_security_count} /{' '}
            {report.coverage.source_security_count} 条来源证券未匹配公司名册
          </dd>
        </div>
        <div>
          <dt>采集开始 / 最近成功获取</dt>
          <dd>
            {report.clocks.acquisition_started_at} / {report.clocks.fetched_at}
          </dd>
        </div>
      </dl>
      <BlobEvidenceDownload
        report={report}
        filename={filename}
        onDownload={onDownload}
      />
      <p>
        下载仅保存到你的设备，不上传或分享。快照失效后本页入口会撤下，已下载文件不会自动撤回。下载包含全部公司与全部法人类别，不受行业下钻或法人选择影响。缺少法人记录保留
        null，与已报告零值分开；缺失行路径指向实际为 null 的 flow。
      </p>
      <p>
        合计买进、卖出沿用原适配器对三类法人的加总，合计净股数来自官方字段，不重新计算。外资不含外资自营商，后者已包含在自营商。未提供行业汇总或跨来源行业映射。
      </p>
      <div className={s.scroll}>
        <table>
          <caption>
            当前证据字段 · {report.rows.length} 条
            {`（预览前 ${preview.length} 条，JSON 包含全部；法人合计与分项重叠）`}
          </caption>
          <thead>
            <tr>
              <th>公司</th>
              <th>官方行业</th>
              <th>法人类别</th>
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
                    {row.industry.classification_date}
                  </small>
                </td>
                <td>
                  {row.participant.label}
                  <small className={s.identity}>
                    {row.participant.namespace}:{row.participant.id}
                  </small>
                </td>
                <td>
                  {row.role === 'participant_total'
                    ? '法人合计（重叠）'
                    : '组成项'}
                </td>
                <td>{row.metric_label}</td>
                <td>
                  {row.state === 'reported'
                    ? String(row.value)
                    : row.state === 'source_record_missing'
                      ? '法人记录缺失 · null'
                      : '未保留 · null'}
                </td>
                <td>{row.native_locator ?? '无对应字段'}</td>
                <td>
                  {row.value_origin === 'adapter_sum_of_participants'
                    ? '原适配器加总'
                    : row.value_origin === 'source_reported'
                      ? '来源已报告'
                      : '来源记录缺失'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
