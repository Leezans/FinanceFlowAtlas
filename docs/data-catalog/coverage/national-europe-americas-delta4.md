# 欧洲/美洲官方来源第四批增量

日期：2026-11-04。18个经济体研究记录：7个V1产品/文件证据，11个C候选。与此前已提交的两轮研究记录按经济体代码去重，无交叉。

## 必须保留的限制

- 这里的研究覆盖不等于国家数据可用。所有series_id均为空，均未验证纯股权与机构投资者资金流。
- V1为找到官方产品或读到官方表，不代表完成series验证。C为当前国家端点未解决或成员国拆分未确认。
- ECCB八个成员有年度国家数据编制发布证据，但没有取到逐国表；CBCS两个经济体连独立数据是否存在都未确认。均不能标为国家数据已验证。
- 403是获取失败，已停止相关下载，未采用镜像/代理绕过。XLSX/XML不受web解析器支持与403不同，不能称为服务器无数据。
- 成本、自动采集权、公开展示和再分发权均未知。下载入口不等于使用许可。
- BOP证券投资、直接投资股权、基金份额、市场外资净买卖和机构流量不可混用。

## 逐经济体证据

### HTI 海地 · P2 / V1
- 机构：Banque de la République d’Haïti；覆盖范围：national。
- 官方入口：https://www.brh.ht/statistiques/bdp-et-commerce-exterieur/
- 频率：quarterly; annual separately linked；单位：USD million。
- 具体系列：未验证；series_id=null。
- 证据与限制：已打开官方季度PDF，期间从2009年10–12月至2025年7–9月，标注2026-05-28更新、暂定值；有金融账户/直接投资/其他投资，未识别独立证券股权行。储备负号表示增加，不能把该规则推广到其他项目。
- 其他证据：https://www.brh.ht/wp-content/uploads/bdptrimestrielle.pdf
- 获取状态：official_pdf_numeric_text_opened_equity_not_found。自动化/分发/费用：未知。

### SUR 苏里南 · P2 / V1
- 机构：Centrale Bank van Suriname；覆盖范围：national。
- 官方入口：https://www.cbvs.sr/en/balance-of-payments-en
- 频率：unknown；单位：unknown。
- 具体系列：未验证；series_id=null。
- 证据与限制：官方页面实际打开，链接Excel名为BalanceofPayments_BPM5.xlsx，元数据名含25Apr2017。两者获取均403，停止该下载，未绕过；不能认定数据当前更新或现行BPM6。
- 其他证据：https://www.cbvs.sr/images/content/statistieken/Database/BalanceofPayments_BPM5.xlsx；https://www.cbvs.sr/images/content/statistieken/Metadata/Suriname_GDDS_DQAF_EXT_Balanceofpayments_25Apr2017.pdf
- 获取状态：official_landing_opened_linked_files_403。自动化/分发/费用：未知。

### ABW 阿鲁巴 · P2 / V1
- 机构：Centrale Bank van Aruba；覆盖范围：national。
- 官方入口：https://www.cbaruba.org/quarterly-tables/
- 频率：quarterly；单位：unknown。
- 具体系列：未验证；series_id=null。
- 证据与限制：官方季度表产品说明明确包含BOP；未下载具体表，纯股权、币种倍数和历史覆盖未知。不得采用第三方镜像来认证。
- 其他证据：
- 获取状态：official_web_evidence_only_not_endpoint_tested。自动化/分发/费用：未知。

### BMU 百慕大 · P2 / V1
- 机构：Bermuda Department of Statistics；覆盖范围：national。
- 官方入口：https://www3.gov.bm/print/html/node/447331
- 频率：quarterly；单位：unknown。
- 具体系列：未验证；series_id=null。
- 证据与限制：政府BOP与IIP归档列2025各季以及2024、2023历史；定义含资本金融账户。未核对具体股权表、单位和2026更新。
- 其他证据：
- 获取状态：official_web_evidence_only_not_endpoint_tested。自动化/分发/费用：未知。

### CYM 开曼群岛 · P2 / V1
- 机构：Economics and Statistics Office；覆盖范围：national。
- 官方入口：https://www.eso.ky/foreigntrade.html
- 频率：annual publication；单位：unknown。
- 具体系列：未验证；series_id=null。
- 证据与限制：官方BOP/Foreign Trade目录最新可见2024版于2026发布；有2023用户指南。未证实纯股权，也不能因金融中心地位推断离岸基金完整覆盖。
- 其他证据：https://www.eso.ky/UserFiles/page_docums/files/uploads/bop_user_guide_2023.pdf
- 获取状态：official_web_evidence_only_not_endpoint_tested。自动化/分发/费用：未知。

### RUS 俄罗斯 · P2 / V1
- 机构：Bank of Russia；覆盖范围：national。
- 官方入口：https://www.cbr.ru/eng/statistics/macro_itm/external_sector/pb/
- 频率：quarterly detailed; monthly estimates separate；单位：USD billion in quarterly release; detailed file units pending。
- 具体系列：未验证；series_id=null。
- 证据与限制：官方列BOP标准/分析表及历史；2026Q2报告更新2026-09-30，明确金融账户资产负债和证券投资。月估算只证明汇总，未验证当前纯股权明细；不得把直接投资股权当证券股权。
- 其他证据：https://cbr.ru/eng/statistics/macro_itm/external_sector/pb/p_balance/
- 获取状态：official_web_evidence_only_not_endpoint_tested。自动化/分发/费用：未知。

### SMR 圣马力诺 · P2 / V1
- 机构：Ufficio Nazionale di Statistica；覆盖范围：national。
- 官方入口：https://www.statistica.sm/pub1/StatisticaSM/e-gdds/nsdp.html
- 频率：unknown_pending_file；单位：unknown。
- 具体系列：未验证；series_id=null。
- 证据与限制：已打开官方NSDP，BOP有Browse和SDMX；链接分别响应XLSX、XML但web工具不支持内容类型，未解析series。旧2014未发布BOP的说法不可沿用。
- 其他证据：https://www.statistica.sm/on-line/nsdp/SMR_BOP_SDMX.xml；https://www.statistica.sm/pub1/dam/jcr%3A92a9dbf3-6ed0-464b-a666-4885f676c537/
- 获取状态：official_nsdp_opened_download_format_unsupported_by_web_tool。自动化/分发/费用：未知。

### AND 安道尔 · P2 / C
- 机构：Departament d’Estadística；覆盖范围：national。
- 官方入口：https://www.govern.ad/ca/w/es-publica-per-primera-vegada-la-balanca-de-pagaments-d-andorra-que-mostra-una-capacitat-de-financament-internacional-del-pais-del-18-del-pib
- 频率：annual historical publication; current quarterly implementation unverified；单位：unknown。
- 具体系列：未验证；series_id=null。
- 证据与限制：官方首次发布公告证实历史国家BOP；2022国家元数据指向统计局新闻与数据集。当前具体金融账户下载表未锁定；2024报告的季度统计实施目标不能当已上线。
- 其他证据：https://dsbb.imf.org/e-gdds/dqaf-base/country/AND/category/BOP00；https://www.transparencia.ad/documents/d/guest/signed_memoria_dde_2024_portal-de-transparencia-pdf
- 获取状态：official_web_evidence_only_not_endpoint_tested。自动化/分发/费用：未知。

### ATG 安提瓜和巴布达 · P2 / C
- 机构：ECCB with national statistical office；覆盖范围：monetary_union_compiler_country_series_documented_not_retrieved。
- 官方入口：https://cdn.eccb-centralbank.org/documents/Balance-of-Payments/2024-03-14-05-06-04-ECCU-External-Sector-Statistics-2022.pdf
- 频率：annual country BOP documented; quarterly indicators not full BOP；单位：unknown_country_table。
- 具体系列：未验证；series_id=null。
- 证据与限制：ECCB官方报告明确八个成员经济体加联盟共九套年度BOP/IIP；IMF 2025技术援助报告明确各成员发布BPM6年度数据，及2000–2013回溯。仅验证编制/发布存在，未取得本成员具体表或股权系列。ECCB统计门户本轮403；联盟总数不可复制为本国数值。
- 其他证据：https://www.elibrary.imf.org/view/journals/002/2025/104/article-A003-en.xml；https://www.elibrary.imf.org/view/journals/002/2024/093/article-A002-en.xml
- 获取状态：official_report_and_imf_index_evidence_country_endpoint_unresolved。自动化/分发/费用：未知。

### DMA 多米尼克 · P2 / C
- 机构：ECCB with national statistical office；覆盖范围：monetary_union_compiler_country_series_documented_not_retrieved。
- 官方入口：https://cdn.eccb-centralbank.org/documents/Balance-of-Payments/2024-03-14-05-06-04-ECCU-External-Sector-Statistics-2022.pdf
- 频率：annual country BOP documented; quarterly indicators not full BOP；单位：unknown_country_table。
- 具体系列：未验证；series_id=null。
- 证据与限制：ECCB官方报告明确八个成员经济体加联盟共九套年度BOP/IIP；IMF 2025技术援助报告明确各成员发布BPM6年度数据，及2000–2013回溯。仅验证编制/发布存在，未取得本成员具体表或股权系列。ECCB统计门户本轮403；联盟总数不可复制为本国数值。
- 其他证据：https://www.elibrary.imf.org/view/journals/002/2025/104/article-A003-en.xml；https://www.elibrary.imf.org/view/journals/002/2024/093/article-A002-en.xml
- 获取状态：official_report_and_imf_index_evidence_country_endpoint_unresolved。自动化/分发/费用：未知。

### GRD 格林纳达 · P2 / C
- 机构：ECCB with national statistical office；覆盖范围：monetary_union_compiler_country_series_documented_not_retrieved。
- 官方入口：https://cdn.eccb-centralbank.org/documents/Balance-of-Payments/2024-03-14-05-06-04-ECCU-External-Sector-Statistics-2022.pdf
- 频率：annual country BOP documented; quarterly indicators not full BOP；单位：unknown_country_table。
- 具体系列：未验证；series_id=null。
- 证据与限制：ECCB官方报告明确八个成员经济体加联盟共九套年度BOP/IIP；IMF 2025技术援助报告明确各成员发布BPM6年度数据，及2000–2013回溯。仅验证编制/发布存在，未取得本成员具体表或股权系列。ECCB统计门户本轮403；联盟总数不可复制为本国数值。
- 其他证据：https://www.elibrary.imf.org/view/journals/002/2025/104/article-A003-en.xml；https://www.elibrary.imf.org/view/journals/002/2024/093/article-A002-en.xml
- 获取状态：official_report_and_imf_index_evidence_country_endpoint_unresolved。自动化/分发/费用：未知。

### KNA 圣基茨和尼维斯 · P2 / C
- 机构：ECCB with national statistical office；覆盖范围：monetary_union_compiler_country_series_documented_not_retrieved。
- 官方入口：https://cdn.eccb-centralbank.org/documents/Balance-of-Payments/2024-03-14-05-06-04-ECCU-External-Sector-Statistics-2022.pdf
- 频率：annual country BOP documented; quarterly indicators not full BOP；单位：unknown_country_table。
- 具体系列：未验证；series_id=null。
- 证据与限制：ECCB官方报告明确八个成员经济体加联盟共九套年度BOP/IIP；IMF 2025技术援助报告明确各成员发布BPM6年度数据，及2000–2013回溯。仅验证编制/发布存在，未取得本成员具体表或股权系列。ECCB统计门户本轮403；联盟总数不可复制为本国数值。
- 其他证据：https://www.elibrary.imf.org/view/journals/002/2025/104/article-A003-en.xml；https://www.elibrary.imf.org/view/journals/002/2024/093/article-A002-en.xml
- 获取状态：official_report_and_imf_index_evidence_country_endpoint_unresolved。自动化/分发/费用：未知。

### LCA 圣卢西亚 · P2 / C
- 机构：ECCB with national statistical office；覆盖范围：monetary_union_compiler_country_series_documented_not_retrieved。
- 官方入口：https://cdn.eccb-centralbank.org/documents/Balance-of-Payments/2024-03-14-05-06-04-ECCU-External-Sector-Statistics-2022.pdf
- 频率：annual country BOP documented; quarterly indicators not full BOP；单位：unknown_country_table。
- 具体系列：未验证；series_id=null。
- 证据与限制：ECCB官方报告明确八个成员经济体加联盟共九套年度BOP/IIP；IMF 2025技术援助报告明确各成员发布BPM6年度数据，及2000–2013回溯。仅验证编制/发布存在，未取得本成员具体表或股权系列。ECCB统计门户本轮403；联盟总数不可复制为本国数值。
- 其他证据：https://www.elibrary.imf.org/view/journals/002/2025/104/article-A003-en.xml；https://www.elibrary.imf.org/view/journals/002/2024/093/article-A002-en.xml
- 获取状态：official_report_and_imf_index_evidence_country_endpoint_unresolved。自动化/分发/费用：未知。

### VCT 圣文森特和格林纳丁斯 · P2 / C
- 机构：ECCB with national statistical office；覆盖范围：monetary_union_compiler_country_series_documented_not_retrieved。
- 官方入口：https://cdn.eccb-centralbank.org/documents/Balance-of-Payments/2024-03-14-05-06-04-ECCU-External-Sector-Statistics-2022.pdf
- 频率：annual country BOP documented; quarterly indicators not full BOP；单位：unknown_country_table。
- 具体系列：未验证；series_id=null。
- 证据与限制：ECCB官方报告明确八个成员经济体加联盟共九套年度BOP/IIP；IMF 2025技术援助报告明确各成员发布BPM6年度数据，及2000–2013回溯。仅验证编制/发布存在，未取得本成员具体表或股权系列。ECCB统计门户本轮403；联盟总数不可复制为本国数值。
- 其他证据：https://www.elibrary.imf.org/view/journals/002/2025/104/article-A003-en.xml；https://www.elibrary.imf.org/view/journals/002/2024/093/article-A002-en.xml
- 获取状态：official_report_and_imf_index_evidence_country_endpoint_unresolved。自动化/分发/费用：未知。

### AIA 安圭拉 · P2 / C
- 机构：ECCB with national statistical office；覆盖范围：monetary_union_compiler_country_series_documented_not_retrieved。
- 官方入口：https://cdn.eccb-centralbank.org/documents/Balance-of-Payments/2024-03-14-05-06-04-ECCU-External-Sector-Statistics-2022.pdf
- 频率：annual country BOP documented; quarterly indicators not full BOP；单位：unknown_country_table。
- 具体系列：未验证；series_id=null。
- 证据与限制：ECCB官方报告明确八个成员经济体加联盟共九套年度BOP/IIP；IMF 2025技术援助报告明确各成员发布BPM6年度数据，及2000–2013回溯。仅验证编制/发布存在，未取得本成员具体表或股权系列。ECCB统计门户本轮403；联盟总数不可复制为本国数值。
- 其他证据：https://www.elibrary.imf.org/view/journals/002/2025/104/article-A003-en.xml；https://www.elibrary.imf.org/view/journals/002/2024/093/article-A002-en.xml
- 获取状态：official_report_and_imf_index_evidence_country_endpoint_unresolved。自动化/分发/费用：未知。

### MSR 蒙特塞拉特 · P2 / C
- 机构：ECCB with national statistical office；覆盖范围：monetary_union_compiler_country_series_documented_not_retrieved。
- 官方入口：https://cdn.eccb-centralbank.org/documents/Balance-of-Payments/2024-03-14-05-06-04-ECCU-External-Sector-Statistics-2022.pdf
- 频率：annual country BOP documented; quarterly indicators not full BOP；单位：unknown_country_table。
- 具体系列：未验证；series_id=null。
- 证据与限制：ECCB官方报告明确八个成员经济体加联盟共九套年度BOP/IIP；IMF 2025技术援助报告明确各成员发布BPM6年度数据，及2000–2013回溯。仅验证编制/发布存在，未取得本成员具体表或股权系列。ECCB统计门户本轮403；联盟总数不可复制为本国数值。
- 其他证据：https://www.elibrary.imf.org/view/journals/002/2025/104/article-A003-en.xml；https://www.elibrary.imf.org/view/journals/002/2024/093/article-A002-en.xml
- 获取状态：official_report_and_imf_index_evidence_country_endpoint_unresolved。自动化/分发/费用：未知。

### CUW 库拉索 · P2 / C
- 机构：Centrale Bank van Curaçao en Sint Maarten；覆盖范围：monetary_union_candidate_country_disaggregation_unverified。
- 官方入口：https://www.centralbank.cw/statistics-dashboards/external-sector-statistics/balance-of-payments
- 频率：quarterly workbook; country disaggregation unverified；单位：unknown。
- 具体系列：未验证；series_id=null。
- 证据与限制：已打开央行BOP页，列至2026Q1且链接实际xlsx；web工具返回不支持XLSX内容类型。未读取工作表，不能判断是否有本经济体独立序列，不把货币联盟数据赋给两个国家。
- 其他证据：https://centralbank.cw/storage/app/media/balance_of_payments/20261002_balance_of_payments_-_2026-q1.xlsx
- 获取状态：official_landing_opened_xlsx_format_unsupported_by_web_tool。自动化/分发/费用：未知。

### SXM 荷属圣马丁 · P2 / C
- 机构：Centrale Bank van Curaçao en Sint Maarten；覆盖范围：monetary_union_candidate_country_disaggregation_unverified。
- 官方入口：https://www.centralbank.cw/statistics-dashboards/external-sector-statistics/balance-of-payments
- 频率：quarterly workbook; country disaggregation unverified；单位：unknown。
- 具体系列：未验证；series_id=null。
- 证据与限制：已打开央行BOP页，列至2026Q1且链接实际xlsx；web工具返回不支持XLSX内容类型。未读取工作表，不能判断是否有本经济体独立序列，不把货币联盟数据赋给两个国家。
- 其他证据：https://centralbank.cw/storage/app/media/balance_of_payments/20261002_balance_of_payments_-_2026-q1.xlsx
- 获取状态：official_landing_opened_xlsx_format_unsupported_by_web_tool。自动化/分发/费用：未知。

## 检索未解决记录，不赋国家数据源

- SLV 萨尔瓦多：国家BCR具体表未定位。IMF报告有BCR来源与工作人员估计混合，不能充当国家实测系列。DSBB尝试只返回模板壳。
- BLR 白俄罗斯：俄央行图书馆目录可见2026年白俄罗斯外部账户出版物，但不是国家数据端点；DSBB尝试只返回模板壳。
- LIE 列支敦士登：找到2019年政府档案提及无独立BOP；历史陈述不足认定2026仍无数据。
- MCO/VAT/CUB/VEN及其他欧洲/美洲属地仍需进一步研究。未证实不等于不存在。

## 建议下一步

- 优先解析圣马力诺官方SDMX，再核查阿鲁巴季度表和百慕大/开曼报告具体金融账户。
- 苏里南需确认可获合法访问与当前方法；ECCB/CBCS需取得按成员分列的实际表，再讨论提升状态。
- 海地季度PDF已读到数值及USD百万，但尚无明确证券股权行，可保留为宏观交叉核对，不填充股票资金流。
