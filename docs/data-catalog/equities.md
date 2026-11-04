# 全球股市、机构交易与跨境证券资金来源目录

验证日期：2026-11-04。本文为 FinanceFlowAtlas 的来源与采集规划，不含采集代码或用户私人数据。

[返回总索引与统一实施队列](index.md) · [跨资产补充](cross-asset.md) · [展示设计](display-design.md)

## 状态、优先级与边界

- **V1**：已通过官方网页/搜索索引确认数据产品或文档存在；并不代表已测试 API、下载完整样本或获得使用许可。
- **V1-H**：仅确认历史官方样例，最新连续供给未确认。
- **C**：待验证候选；不可标为已接入、免费 API 或已授权转载。
- **P0**：优先构建全球可比基线；**P1**：高价值国家/机构交易补充；**P2**：补覆盖、历史或许可依赖来源。这是本专题排序；跨专题执行以总索引为准，BIS 银行统计在跨资产产品中的优先级高于股票专题。
- “公开”仅指页面或下载可见，不等于可自动抓取、商业使用或公开再分发。除特别列明，费用、API 认证、速率和分发许可均待核验。
- 本目录不宣称全球每个市场都有日频机构资金流。跨境居民统计、投资者国籍、托管地、基金注册地及机构分类不可混同。

## 国际可比基线

|优先级/状态|来源、入口|数据语义与范围|频率、单位、获取方式|采集与限制|
|---|---|---|---|---|
|P0 / V1|[IMF BOP](https://data.imf.org/Datasets/BOP)，[API 文档](https://data.imf.org/en/Resource-Pages/IMF-API)|居民与非居民交易；证券投资股权/基金份额和债务；资产、负债及部分机构部门|季度/年度；单位和倍率从元数据读取；门户下载，SDMX 2.1/3.0|当前数据流与代码表需发现和测试，勿直接依赖旧端点。双边与机构细分并非所有国家都有。文档提及 Swagger 登录；实际生产认证待验证。|
|P0 / V1|[IMF PIP，原 CPIS](https://data.imf.org/datasets/IMF.STA%3APIP)|按对手经济体的双边证券投资**头寸**；股权/基金份额、长短期债务|年度/半年度；API/下载；单位待代码表确认|自愿报送、保密和缺期须保留。用于敞口网络，不是资金流；不可用未调整头寸差冒充净买入。|
|P1 / V1|[BIS LBS](https://data.bis.org/topics/LBS/tables-and-dashboards)，[批量下载](https://data.bis.org/bulkdownload)，[API v2](https://stats.bis.org/api-doc/v2/)|按银行所在地、对手国家/部门、币种/工具的跨境银行债权债务；**并非股票流**|季度；CSV/SDMX；倍率从元数据读取|仅作跨境银行背景层；优先采用官方调整后变化量。[使用条款](https://www.bis.org/about/legal/permitted-use-statistics)须核验。|

## 美洲

|优先级/状态|来源、入口|数据语义与范围|频率、单位、获取方式|采集与限制|
|---|---|---|---|---|
|P0 / V1|美国 [Treasury TIC](https://home.treasury.gov/data/treasury-international-capital-tic-system/)|外国持有美国证券、美国持有外国证券；股权、国债、机构债和企业债交易；国家及部分官方/私人分类|SLT 月度、年度基准调查；公开表格/文件；百万美元|扩展 SLT 于 2023-02 开始；更早流量需分段方法。托管地不必是最终持有人地。保存发布版本。|
|P0 / V1|加拿大 [StatCan 36-10-0030-01](https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=3610003001)|加拿大与外国证券交易，按地区分类，实际证券投资流量|月度；百万，币种核对表元数据；CSV 全表、SDMX、开发者入口|优先机器可读下载；工具细分表 36-10-0028-01 为下一验证目标，尚未单独测试。|
|P1 / V1|巴西 [B3 Dados de Mercado](https://www.b3.com.br/pt_br/market-data-e-indices/servicos-de-dados/market-data/consultas/mercado-a-vista/dados-de-mercado/)|投资者参与比例、外国投资者金融净额；现货及相关市场|每日发布；投资者数据 D+2；月/年累计表；外国金额为百万 BRL|**页面明确禁止自动采集，包括 AI，商业与非商业均在内。不得抓取；申请许可或授权 feed。**2020–22 借券剔除修订、2023 大宗市场和一级市场方法变化应标记。|
|P2 / V1|巴西 [CVM 外国投资](https://www.gov.br/cvm/pt-br/centrais-de-conteudo/publicacoes/series-historicas/investimento-estrangeiro/)|非居民组合流量/头寸、国家组合表|XLS/ODS；已看到截至 2024-12 文件；频率/单位依表|历史补充；最新连续更新未确认，不能代替日频 B3。数据由法律代表报送。|
|P1 / V1|智利 [中央银行 BDE API](https://si3.bcentral.cl/estadisticas/Principal1/Web_Services/acceso_api.html)|BOP 金融账户及证券投资，按表可有部门细分|BDE 表格/API；频率、币种与倍率依系列|[API 条款](https://si3.bcentral.cl/estadisticas/Principal1/Web_Services/terminos_condiciones.html)要求注册并接受；账号、实际系列映射与许可待落实。|

## 欧洲

|优先级/状态|来源、入口|数据语义与范围|频率、单位、获取方式|采集与限制|
|---|---|---|---|---|
|P0 / V1|欧元区 [ECB SHSS](https://data.ecb.europa.eu/methodology/securities-holdings-statistics)|上市股票、基金份额和债务；持有人国家/部门及发行人分类；头寸与**净交易**分别提供|季度；CSV/SDMX；细分从 2021Q1，旧 SHS 总量从 2013Q4；单位逐系列核验|机构配置重要基线。底层逐证券报送不代表公开微观证券级数据。净交易是购买减出售，不是头寸变化。|
|P1 / V1|英国 [ONS Pink Book](https://www.ons.gov.uk/economy/nationalaccounts/balanceofpayments/bulletins/unitedkingdombalanceofpaymentsthepinkbook/2026)|金融账户证券投资资产/负债，股权/基金与债务|年度详表及季度 BOP；GBP 系列，倍率依表；链接到 07 Financial account 数据集|季度股权负债系列 XBLW 在当前发布中出现；具体下载/系列 API 待验证。|
|P1 / V1|土耳其 [TCMB Securities Statistics](https://www.tcmb.gov.tr/wps/wcm/connect/EN/TCMB%2BEN/Main%2BMenu/Statistics/Monetary%2Band%2BFinancial%2BStatistics/Securities%2BStatistics/)|非居民股票、债券持仓及每周净交易|周度；报告为百万美元；ZIP/PDF、EVDS 时间序列|直接官方净交易可用；EVDS API、认证和系列配置待验证。不可将美元持仓变化直接称作买入。|

## 亚洲

|优先级/状态|来源、入口|数据语义与范围|频率、单位、获取方式|采集与限制|
|---|---|---|---|---|
|P0 / V1|日本 [MOF International Transactions in Securities](https://www.mof.go.jp/english/policy/international_policy/reference/itn_transactions_in_securities/index.htm)|居民境外、非居民境内股票/基金和债务买卖；月度有投资者类别|周/月；周表亿日元；历史文件/PDF|指定大型机构样本，不是完整 BOP。**2014-01 起对外投资净额正号由净卖出改为净买入**。按成交日；债券处置含偿还。|
|P0 / V1|日本 [JPX investor type](https://www.jpx.co.jp/english/markets/statistics-equities/investor-type/index.html)，[J-Quants Pro 产品](https://pro.jpx-jquants.com/datasets/1)|海外、个人及细分机构买/卖/净额；市场分部；股票、ETF、REIT 有分别统计|周/月/年；数量和金额分文件；周报约下周第 4 工作日；Pro REST/SFTP/Snowflake、CSV/JSON、历史从 2008-01|原文件金额倍率必须核验；市场分部重组设断点。Pro 商业报价/授权待确认，不可假定免费。|
|P0 / V1|印度 [SEBI FPI 来源目录](https://www.sebi.gov.in/curation/fpi.html)，链接 NSDL/CDSL|FPI 投资、历史汇总及行业统计|日/月/年，行业为半月；公开网页及归档；单位依报告|校验成交/结算日期、一级市场范围与币种；不得与交易所现货净额混接。|
|P0 / V1|印度 [NSE FII/FPI & DII](https://www.nseindia.com/reports/fii-dii?os=___)|资本市场的境内机构和外国投资者交易；NSE 单独及 NSE/BSE/MSEI 合计|日度；INR crore/billion 可选；CSV|与 NSDL 范围不同，分开保存。自动化和再分发权待确认。|
|P1 / V1|韩国 [KRX Data Marketplace](https://data.krx.co.kr/contents/MDC/MAIN/main/index.cmd?locale=en)|KOSPI/KOSDAQ/KONEX 按投资者买/卖/净额；期货期权另表|日度；主仪表盘十亿 KRW；网页门户|官方产品确认；稳定 API、历史权限和商业再分发未验证。不得把非官方抓取接口视为承诺的 API。|
|P1 / V1|台湾 [TWSE 日机构交易数据产品](https://eshop.twse.com.tw/en/product/detail/6edec1b6e62345cb9f1244acbbcefae0)|逐证券外国/大陆、外国自营、投信、自营/避险买卖，字段为**股数**|日度，2004-10-01 起；TEXT/Excel；18:00/20:00 不含/含大宗版本|标价内部使用 NT$1,500/月、外部使用 NT$3,000/月；**外部使用仍不允许公开披露**，须谈产品分发权。股数乘收盘价只是估计，不是实际成交资金。|
|P1 / V1|泰国 [SET 投资者统计](https://www.set.or.th/en/market/statistics/investor-type?market=settrade)|外国、本地机构、个人、自营交易金额|日度/汇总视图；币种与倍率核查报告|区分 SET、mai、排除 DR 版本；API、历史和分发权限未确认。|
|P1 / V1|印尼 [IDX Stock Summary](https://idx.co.id/id/data-pasar/ringkasan-perdagangan/ringkasan-saham/)|逐证券 Foreign Buy/Sell 及全市场成交数据|日度；网页下载；Foreign 字段单位待样本验证|外资字段可能为股数，不能当货币额；优先官方授权数据，不依赖未文档化端点。|
|P1 / V1|中国内地/香港 [HKEX Stock Connect](https://www.hkex.com.hk/Mutual-Market/Connect-Hub/Stock-Connect?sc_lang=en)，[披露调整公告](https://www.hkex.com.hk/News/Market-Communications/2024/2404122news?sc_lang=en)|互联互通渠道交易和持仓，不是全部跨境证券流|日度/定期取决字段；RMB/HKD|2024 年披露变化，2024-08-19 为重要实施断点。不得承诺当前北向日净流连续可得；额度使用也不等于净买入。|

## 中东

|优先级/状态|来源、入口|数据语义与范围|频率、单位、获取方式|采集与限制|
|---|---|---|---|---|
|P1 / V1|沙特 [Saudi Exchange 定期报告](https://www.saudiexchange.sa/wps/portal/saudiexchange/newsandreports/reports-publications/annual-reports?locale=ar)|国籍/投资者类别交易与持仓，主板及 Nomu|周/月 PDF；SAR 金额与百分比|交易和所有权变化分开。公开 API、完整历史及许可未验证。|
|P1 / V1|阿联酋迪拜 [DFM 国籍交易](https://www.dfm.ae/the-exchange/statistics-reports/historical-data/trade-by-nationality)，[日公报](https://service.dfm.ae/Bulletins?L=1)|国籍买/卖/净投资；另有客户类别；公报有外资和机构净额|日度/日期范围；AED；下载/导出|自助最多 2 年，老历史需登录提交申请；收费与再分发权待确认。未验证公开 API。|
|P2 / V1|科威特 [Boursa 国籍与类别统计](https://reports.boursakuwait.com.kw/ar/analysis/trading-volumes-according-to-nationality-and-category)|按国籍及投资者类别的月交易|月度索引从 2008 起；下载格式/金额单位需样本核查|可先人工验证报告，API、复用权及连续性未知。|

## 非洲

|优先级/状态|来源、入口|数据语义与范围|频率、单位、获取方式|采集与限制|
|---|---|---|---|---|
|P1 / V1|尼日利亚 [NGX 外资组合报告](https://ngxgroup.com/exchange/data/foreign-portfolio-investment-report/)|国内/外国参与、外资流入/流出、国内机构/散户分类|月 PDF；单位逐报告检查|当前官方索引确认；API 与再分发许可未确认。|
|P2 / V1-H|南非 [JSE 市场概况历史样例](https://www.jse.co.za/sites/default/files/media/documents/jse-markets-profile-20230731/JSE%20Markets%26%23039%3B%20Profile%2020230731.pdf)|外资 JSE 股票交易、净买/卖|市场概况报告；百万 ZAR|只确认历史官方样例，最新连续获取路线未验证；可谈授权交易所统计，BOP 作国家级回退。|
|P2 / V1-H|肯尼亚 [CMA 季度统计公报](https://www.cmarcp.or.ke/images/bulletin/Statistical%20Bulletin/2025/CMA-Quarterly-Statistical-Bulletin-Q3.-2025.pdf)|Nairobi 股票外资参与趋势|季度 PDF；单位与净额字段待抽样|用于官方核对/回填；不能据此声称有已验证的日频交易所资金流。|

## 大洋洲

|优先级/状态|来源、入口|数据语义与范围|频率、单位、获取方式|采集与限制|
|---|---|---|---|---|
|P1 / V1|澳大利亚 [ABS BOP/IIP](https://www.abs.gov.au/statistics/economy/international-trade/balance-payments-and-international-investment-position-australia/latest-release)|证券投资及其他金融账户股权/债务流量与头寸|季度；表格下载；AUD，倍率依表|选择交易项，不是净股权头寸变化；系列、API 映射和许可需元数据核查。|
|P1 / V1|新西兰 [Stats NZ BOP/IIP](https://www.stats.govt.nz/information-releases/balance-of-payments-and-international-investment-position-year-ended-31-march-2026/)|季度交易/头寸，年度选定对手国家存量流量|季度/年；Excel；单位逐表检查|居民国家层，不是日频机构交易。Infoshare 正迁移至 Aotearoa Data Explorer，采集接口需重新验证。|

## 待验证覆盖队列（均为 C）

以下是研究候选，不是已核实的数据接口；尚未确认确切 URL、频率、单位、成本、自动化及分发权。P2 补齐国家覆盖；若用户需求偏向某市场，可升 P1。

- 美洲：墨西哥 Banxico；哥伦比亚 Banco de la República；秘鲁 BCRP；阿根廷 BCRA。
- 欧洲：瑞士 SNB；挪威 Norges Bank/SSB；瑞典 SCB；其他欧盟国家通过 ECB、Eurostat 与国家统计机构核验。
- 亚洲：中国 SAFE；韩国 BOK/FSS；马来西亚 Bursa/BNM；菲律宾 PSE/BSP；新加坡 MAS/SGX；越南 HOSE/HNX；巴基斯坦 NCCPL；孟加拉 DSE；斯里兰卡 CSE。
- 中东：以色列 BOI/TASE；卡塔尔 QSE；阿布扎比 ADX；巴林 BHB；阿曼 MSX。
- 非洲：埃及 EGX；摩洛哥 Casablanca；加纳 GSE；毛里求斯 SEM；突尼斯 BVMT；西非 BRVM。
- 对于尚无国家/交易所数据的经济体，以 IMF BOP/PIP 检查实际覆盖为基线；这不意味着有同等日频、逐股或机构细分。

## 采集和质量方案

1. 来源契约记录：机构、数据集 ID、来源 URL、文档化下载/API、数据语义、工具、投资者定义、居民/国籍规则、频率/时滞、币种/倍率、历史、成本、自动化权、分发权、证据日期及验证阶段。
2. 首批试验顺序：IMF BOP/PIP → ECB SHSS → TIC → 加拿大 → 日本 MOF/JPX → 印度 NSDL/CDSL/NSE。每源先验证小样本、元数据和权限，再批量获取；本阶段未执行这些试验。
3. 分开保存 `transaction_flow`、`gross_purchase`、`gross_sale`、`position`、`turnover`、`ownership_percentage`、`estimated_flow`。绝不混为同一个“资金流”指标。
4. 保留原币种、倍率、符号、报告日期；美元换算用期间适用汇率并保存派生方法。未知不能填零；月累计不能误当每日值。
5. 保存 observation_date、publication_time、retrieval_time、revision/vintage；历史回测不得使用未来发布或修订数据冒充当时可得数据。
6. 校验买减卖=净额、机构分类是否重复、合计守恒；有估值/汇率/其他调整时检验 stock-flow reconciliation。
7. 区分居民、国籍、托管地、基金注册地和最终受益人；互联互通、交易所统计与同国 BOP 不可直接相加。
8. 网站可见、自动抓取、内部商业使用、外部分发和公开展示分别作为许可门槛。B3 自动采集明确受限；TWSE 外部许可也非公开再分发许可。不得以第三方镜像规避限制。
9. PDF 来源应保存原始报告和抽取审计记录，检查单位、脚注、表格换页及方法断点；API 来源保存代码表版本与请求范围。

## 明确未完成的验证

本轮来源研究未独立执行 API 实测或完整质量/授权审查。项目已有 PIP F51（2025-S2，12,501 条边）和 TIC（2026-08，77 个国家/地区）的真实摄取及连接器提交，详见[总索引项目证据](index.md#32-项目已有实现证据与本轮研究验证分列)；这些明确范围不能扩大为整个数据产品已验证。尚未部署。其余目录 V1 仍仅代表官方产品/文档发现，不是生产可用。全量历史、完整许可、覆盖矩阵、逐源发布日历和自动化质量门槛仍待核验。本文不包含登录凭据或用户私有金融数据。
