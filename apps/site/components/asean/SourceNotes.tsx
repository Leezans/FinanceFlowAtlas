import React from 'react';
import s from './asean.module.css';
const originalNotes=`n.a (not available) refers to suppressed/confidential, nil, or negligible
unspecified activities include suppressed/confidential data
for the Philippines, disaggregation by industry is limited only to the net equity capital component of FDI, data provided under Unspecified Activity includes net investments on debt instruments and reinvestment of earnings.
for Singapore, data provided under professional, scientific and technical activities is the summation of professional, scientific and technical activities, and administrative and support service activities
last update as of 1 July 2026
Metadata note: data is preliminary as of 1 July 2026`;
export default function SourceNotes(){return <section className={s.notes} aria-label="ASEANstats 对应技术说明"><h2>数据范围与对应技术说明</h2><ul>
<li>官网该指标为 FDI.HOS.X.SECT，数据来自 ASEAN Secretariat – ASEAN FDI Database。FDI 流量衡量一年内跨境直接投资交易，包括股权交易、再投资收益和公司间债务。净流入是非居民对本国企业投资的增加减减少，不是对外直接投资的相减。</li>
<li>官网说明截至 2026-07-01 的数据为初步数据，可能修订。该日期为本应用核验官网时观察到的资料，不是每条 API 记录的发布时间。接口没有逐项初步值标记或实际发布时刻。</li>
<li>n.a 可能表示被抑制／保密、没有／零或微量。不能从该标记区分状态，故一律保留为未知，不转换为数值零。来源未返回的坐标另标“缺失”。</li>
<li>未指定行业 Z 包括被抑制／保密数据。它不是一个与具体产业等同的行业。</li>
<li>菲律宾行业拆分只涵盖净股权资本；债务工具净投资及再投资收益在 Z。新加坡 M（专业、科研和技术活动）同时包括 N（行政支持服务）。国家行业口径并不完全一致。</li>
<li>行业分类采用来源的 A–S 与 Z 代码和标签，本应用另附中文译名；不能保证每个国家的行业覆盖和统计方法完全一致。这里只显示接收国 × 行业，不提供来源国 × 接收国 × 行业的完整多维数据。</li>
<li>同一接收国／行业／年份如有多条记录，无论数值是否一致，均隔离并保留原始值，不相加、不猜选。不会把 n.a 当零计算行业总额，也不以总额减法重建保密数据。</li>
</ul><details><summary>ASEANstats 原文技术说明（与数据一同保留）</summary><div className={s.original}>{originalNotes}</div></details><p>来源引用：ASEANstats，指标 FDI.HOS.X.SECT，data.aseanstats.org，官网资料更新日期 2026-07-01；本应用核验于 2026-11-05。来源条款允许附带署名和对应技术说明的下载、引用与复制。此处只作文字来源标注，不嵌入或建立未经许可的来源网站超链接。</p></section>;}
