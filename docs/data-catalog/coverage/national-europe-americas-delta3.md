# 欧洲与美洲国家官方来源增量：第三批

研究日期：2026-11-04。仅新增研究记录，不修改主注册表或既有54个经济体的研究记录。

本批新增 25 个经济体，既有记录重叠 0；仅与此前批次合计79个经济体；加上本次另29个区域经济体后累计108个（均为研究范围，不等于数据可用）。验证级别：{'V1': 20, 'C': 3, 'V1-H': 2}。

## 证据与适用范围

- V1：已找到官方产品/表目录或官方国家元数据支持的数据产品入口。未实测API、未核验完整历史、未认证股权可用。
- C：只确认机构门户或方法元数据；尚未锁定可下载的具体国家数据产品。
- V1-H：仅核验到官方历史出版物/历史样本，当前更新未证实。
- 所有自动采集权、公开展示和再分发权均为 unknown。公开网页或下载入口不等于授权；成本除芬兰公开免费说明外未知。
- BOP按居民身份统计跨境金融交易，不等于交易所外资买卖，也不等于机构投资者资金流。证券投资总项含债务；股权与基金份额合项不能标为纯股票。
- 本批没有任何生产认证数据源，没有声称已成功运行API或下载数据。单位和频率只按证据范围填写，历史方法不代表当前方法。

## 逐国记录

### FIN 芬兰 · P2 / V1
- 机构：Statistics Finland。入口：https://pxdata.stat.fi/PxWeb/pxweb/en/StatFin/StatFin__mata/statfin_mata_pxt_12gk.px/?action=selectdefault
- 频率：quarterly。单位：EUR million; selected measure must be checked。
- 证据与语义：PxWeb 12gk 为按工具分类金融账户及IIP季度表；有API说明和免费统计数据库说明。默认选项是存量，必须另选交易，不能直接作为资金流。
- 证据链接：https://pxdata.stat.fi/PxWeb/pxweb/en/StatFin/StatFin__mata/statfin_mata_pxt_12gk.px/?action=selectdefault；https://stat.fi/en/publication/cmfm6qh8nvhca07ulpg5bi6we
- 原状态：not_researched。API实测/自动化授权/分发授权：未完成/未知/未知。

### EST 爱沙尼亚 · P2 / C
- 机构：Eesti Pank。入口：https://statistika.eestipank.ee/en
- 频率：unknown。单位：unknown。
- 证据与语义：官方统计门户支持Excel/CSV/XML/HTML及表旁元数据；找到BOP方法页，未确认具体当前股权表。公开汇总与需申请的保密微观数据须分开。
- 证据链接：https://statistika.eestipank.ee/en；https://statistika.eestipank.ee/failid/mbo/kv_mb2_eng.html
- 原状态：not_researched。API实测/自动化授权/分发授权：未完成/未知/未知。

### LTU 立陶宛 · P2 / V1
- 机构：Bank of Lithuania。入口：https://www.lb.lt/en/m_statistics/t-balance-of-payments-2/
- 频率：quarterly。单位：EUR million。
- 证据与语义：官方表展示季度交易及证券投资资产负债；详细筛选包含工具、功能类别、流量/存量、对手方，未提取纯股权序列。
- 证据链接：https://www.lb.lt/en/m_statistics/t-balance-of-payments-2/；https://www.lb.lt/en/external-statistics-3
- 原状态：not_researched。API实测/自动化授权/分发授权：未完成/未知/未知。

### LVA 拉脱维亚 · P2 / V1
- 机构：Latvijas Banka。入口：https://www.bank.lv/en/statistics/stat-data/balance-of-payments-statistics
- 频率：monthly; quarterly/annual tables。单位：unknown。
- 证据与语义：官方外部统计链接INTS；statdb目录0201月BOP、0301季度/年BOP、0401 IIP。未确认股权系列和单位。
- 证据链接：https://www.bank.lv/en/statistics/stat-data/balance-of-payments-statistics；https://statdb.bank.lv/
- 原状态：not_researched。API实测/自动化授权/分发授权：未完成/未知/未知。

### HRV 克罗地亚 · P2 / V1
- 机构：Croatian National Bank。入口：https://www.hnb.hr/en/statistics/statistical-data/rest-of-the-world/balance-of-payments
- 频率：quarterly。单位：unknown。
- 证据与语义：Eurostat国家元数据给出HNB BOP入口及季度发布、三个月时滞；本轮未读取具体表，不能从旧报表推断现行货币。
- 证据链接：https://www.hnb.hr/en/statistics/statistical-data/rest-of-the-world/balance-of-payments；https://ec.europa.eu/eurostat/cache/metadata/EN/bop_6_simsb62_hr.htm
- 原状态：not_researched。API实测/自动化授权/分发授权：未完成/未知/未知。

### ROU 罗马尼亚 · P2 / C
- 机构：National Bank of Romania。入口：https://dsbb.imf.org/sdds/dqaf-base/country/ROU/category/BOP00
- 频率：monthly BOP; quarterly SDDS+。单位：unknown。
- 证据与语义：国家提供的IMF元数据确认NBR月BOP及互动库；尚未解决国家具体下载端点或股权表。此URL为元数据，不是数据API。
- 证据链接：https://dsbb.imf.org/sdds/dqaf-base/country/ROU/category/BOP00；https://www.bnr.ro/en/642-home
- 原状态：not_researched。API实测/自动化授权/分发授权：未完成/未知/未知。

### BGR 保加利亚 · P2 / C
- 机构：Bulgarian National Bank。入口：https://dsbb.imf.org/sdds/dqaf-base/country/BGR/category/BOP00
- 频率：unknown。单位：unknown。
- 证据与语义：2026年国家提供的IMF元数据确认BNB BPM6标准及分析格式；实际当前表端点、频率和股权分项待核验。
- 证据链接：https://dsbb.imf.org/sdds/dqaf-base/country/BGR/category/BOP00
- 原状态：not_researched。API实测/自动化授权/分发授权：未完成/未知/未知。

### MLT 马耳他 · P2 / V1
- 机构：Central Bank of Malta / NSO。入口：https://www.centralbankmalta.org/external-statistics
- 频率：quarterly。单位：EUR; multiplier pending。
- 证据与语义：明确列出可下载Balance of Payments - Financial Accounts (transactions)；NSO季度发布有XLSX。股权子行和单位倍数待验证。
- 证据链接：https://www.centralbankmalta.org/external-statistics；https://nso.gov.mt/balance_of_payments/
- 原状态：not_researched。API实测/自动化授权/分发授权：未完成/未知/未知。

### CYP 塞浦路斯 · P2 / V1
- 机构：Central Bank of Cyprus。入口：https://www.centralbank.cy/en/statistics/external-statistics/data-based-on-bpm6-methodology
- 频率：quarterly。单位：EUR million。
- 证据与语义：BPM6季度BOP/IIP及SPE调整版本分列；NSDP给BOP单位百万欧元。必须分开标准/SPE调整、交易/存量和BPM5旧系列。
- 证据链接：https://www.centralbank.cy/en/statistics/external-statistics/data-based-on-bpm6-methodology；https://www.centralbank.cy/nsdp/nsdp_published.html
- 原状态：not_researched。API实测/自动化授权/分发授权：未完成/未知/未知。

### ALB 阿尔巴尼亚 · P2 / V1
- 机构：Bank of Albania。入口：https://www.bankofalbania.org/Statistics/External_sector_statistics/Balance_of_Payments/
- 频率：quarterly。单位：unknown。
- 证据与语义：官方季度BOP明列C.2.L.1 Equity and investment fund shares与C.2.L.2 Debt；确认股权加基金分类，不等于纯股票或机构交易。单位和实测导出待补。
- 证据链接：https://www.bankofalbania.org/Statistics/External_sector_statistics/Balance_of_Payments/；https://www.bankofalbania.org/Statistics/Monetary_Financial_and_Banking_statistics/Monetary_Financial_and_Banking_statistics.html?CRegtab=705&Cgroups=23&evb=agregate&evn=expand&periudha_id=3
- 原状态：not_researched。API实测/自动化授权/分发授权：未完成/未知/未知。

### BIH 波斯尼亚和黑塞哥维那 · P2 / V1
- 机构：Central Bank of Bosnia and Herzegovina。入口：https://www.cbbh.ba/Content/Archive/35
- 频率：quarterly。单位：unknown。
- 证据与语义：官方季度bulletin含T22 BH BOP；官方日历确认季度BOP。工具分解、单位、机器格式未验证。
- 证据链接：https://www.cbbh.ba/Content/Archive/35；https://fined.cbbh.ba/Content/Read/29?lang=en
- 原状态：not_researched。API实测/自动化授权/分发授权：未完成/未知/未知。

### MKD 北马其顿 · P2 / V1
- 机构：National Bank of North Macedonia。入口：https://nbstat.nbrm.mk/pxweb/en/Eksterni%20statistiki/Eksterni%20statistiki__Platen%20Bilans/
- 频率：monthly; quarterly and annual also documented。单位：unknown。
- 证据与语义：官方PxWeb目录明确月BOP；官方方法/发布说明有月、季、年序列。API请求、工具维度和单位尚未测试。
- 证据链接：https://nbstat.nbrm.mk/pxweb/en/Eksterni%20statistiki/Eksterni%20statistiki__Platen%20Bilans/；https://www.nbrm.mk/content/statistika/Soopstenija/PB/2024/Press_Release_BOP_3_2024.pdf
- 原状态：not_researched。API实测/自动化授权/分发授权：未完成/未知/未知。

### MNE 黑山 · P2 / V1
- 机构：Central Bank of Montenegro。入口：https://www.cbcg.me/me/statistika/statisticki-podaci/ekonomski-odnosi-sa-inostranstvom/platni-bilans
- 频率：quarterly。单位：EUR; multiplier pending。
- 证据与语义：官方页明确季度欧元BOP：BPM6 2010起、BPM5 2005–2009。月度统计公报不代表月BOP，股权维度待验证。
- 证据链接：https://www.cbcg.me/me/statistika/statisticki-podaci/ekonomski-odnosi-sa-inostranstvom/platni-bilans
- 原状态：not_researched。API实测/自动化授权/分发授权：未完成/未知/未知。

### MDA 摩尔多瓦 · P2 / V1
- 机构：National Bank of Moldova。入口：https://www.bnm.md/bdi/pages/reports/dbp/DBP17.xhtml?id=0&lang=en
- 频率：quarterly; annual and cumulative 6/9 months separately selectable。单位：USD or EUR; multiplier pending。
- 证据与语义：BPM6标准报表生成器有2009–2026、年度/季度/半年/九个月及USD/EUR选择、Export/Show。累计期间不可误当单季。
- 证据链接：https://www.bnm.md/bdi/pages/reports/dbp/DBP17.xhtml?id=0&lang=en
- 原状态：not_researched。API实测/自动化授权/分发授权：未完成/未知/未知。

### UKR 乌克兰 · P2 / V1-H
- 机构：National Bank of Ukraine。入口：https://bank.gov.ua/files/ES/BOP_m_en.pdf
- 频率：monthly; quarterly analytical table separately。单位：USD million。
- 证据与语义：官方详细月BPM6表搜索可见2024/2025暂定数据；年度、季度、累计也混在表内，2026更新状态未证实。股权行未读取。
- 证据链接：https://bank.gov.ua/files/ES/BOP_m_en.pdf；https://bank.gov.ua/files/ES/BOP_q_en.pdf
- 原状态：not_researched。API实测/自动化授权/分发授权：未完成/未知/未知。

### JAM 牙买加 · P2 / V1
- 机构：Bank of Jamaica。入口：https://boj.org.jm/statistics/enhanced-general-data-dissemination-system-e-gdds/nsdp/
- 频率：quarterly。单位：USD million in historical quarterly report; current header pending。
- 证据与语义：官方NSDP有BOP Browse/SDMX/Metadata；季度报告目录有2026年3月等更新，证券投资总额不代表纯股权。
- 证据链接：https://boj.org.jm/statistics/enhanced-general-data-dissemination-system-e-gdds/nsdp/；https://boj.org.jm/boj-publications/quarterly-reports/
- 原状态：not_researched。API实测/自动化授权/分发授权：未完成/未知/未知。

### BHS 巴哈马 · P2 / V1
- 机构：Central Bank of The Bahamas。入口：https://www.centralbankbahamas.com/index.php/e-gdds
- 频率：unknown_current。单位：unknown_current。
- 证据与语义：官方eGDDS列BOP和Detailed BOP及SDMX下载。2005方法页的BPM5、季度和B$不能自动当现行定义。
- 证据链接：https://www.centralbankbahamas.com/index.php/e-gdds；https://www.centralbankbahamas.com/publications/reports-and-survey-forms/balance-of-payments-bop-statistics
- 原状态：not_researched。API实测/自动化授权/分发授权：未完成/未知/未知。

### BRB 巴巴多斯 · P2 / V1
- 机构：Central Bank of Barbados。入口：https://www.centralbank.org.bb/news/research/
- 频率：unknown。单位：unknown。
- 证据与语义：官方研究入口介绍CBBWEBSTATS BOP预格式Excel。尚未锁定具体表/频率；金融监管栏目BOP页面是调查说明，不是数据集。
- 证据链接：https://www.centralbank.org.bb/news/research/
- 原状态：not_researched。API实测/自动化授权/分发授权：未完成/未知/未知。

### TTO 特立尼达和多巴哥 · P2 / V1
- 机构：Central Bank of Trinidad and Tobago。入口：https://www.central-bank.org.tt/statistics/data-centre
- 频率：quarterly。单位：USD million in government BOP table。
- 证据与语义：央行2024官方说明链接Data Centre；政府近期BOP表确认季度及百万美元。国家详细股权序列和自动接口未验证。
- 证据链接：https://www.central-bank.org.tt/statistics/data-centre；https://www.central-bank.org.tt/sites/default/files/latest-news/net-errors-omissions-in-the-balance-of-payments-august-2024.pdf；https://www.finance.gov.tt/wp-content/uploads/2026/01/Balance-of-Payment-and-Net-Official-Reserves.pdf
- 原状态：not_researched。API实测/自动化授权/分发授权：未完成/未知/未知。

### BLZ 伯利兹 · P2 / V1-H
- 机构：Central Bank of Belize。入口：https://www.centralbank.org.bz/docs/default-source/about-the-bank/statistical-digest-2024.pdf?sfvrsn=8c19714b_1
- 频率：annual publication; underlying periodicity pending。单位：unknown_current。
- 证据与语义：官方2024统计摘要表48 BOP、表50 IIP；是历史出版物而非已测实时源。2011 IMF方法过旧，不可认定现行BPM5/频率。
- 证据链接：https://www.centralbank.org.bz/docs/default-source/about-the-bank/statistical-digest-2024.pdf?sfvrsn=8c19714b_1；https://dsbb.imf.org/egdds/dqaf-base/country/BLZ/category/BOP00
- 原状态：not_researched。API实测/自动化授权/分发授权：未完成/未知/未知。

### HND 洪都拉斯 · P2 / V1
- 机构：Banco Central de Honduras。入口：https://www.bch.hn/estadisticas-y-publicaciones-economicas/reportes-dinamicos/sector-externo/balanza-pagos
- 频率：quarterly and annual。单位：unknown。
- 证据与语义：官方动态BOP季度/年系列入口。储备项符号注释不能泛化至整个金融账户；股权子项、单位和下载待测试。
- 证据链接：https://www.bch.hn/estadisticas-y-publicaciones-economicas/reportes-dinamicos/sector-externo/balanza-pagos
- 原状态：not_researched。API实测/自动化授权/分发授权：未完成/未知/未知。

### NIC 尼加拉瓜 · P2 / V1
- 机构：Banco Central de Nicaragua。入口：https://www.bcn.gob.ni/resultados-de-balanzas-de-pagos
- 频率：quarterly。单位：unknown_pending_financial_account_header。
- 证据与语义：官方季度BOP报告自2020起，目录有2026Q1；金融账户资产负债可见，股权分项未验证。不可从其他章节推定表单位。
- 证据链接：https://www.bcn.gob.ni/resultados-de-balanzas-de-pagos
- 原状态：not_researched。API实测/自动化授权/分发授权：未完成/未知/未知。

### PAN 巴拿马 · P2 / V1
- 机构：INEC Panama。入口：https://www.inec.gob.pa/Publicaciones/Default3.aspx?ID_CATEGORIA=4&ID_PUBLICACION=1428&ID_SUBCATEGORIA=24
- 频率：quarterly and annual。单位：unknown。
- 证据与语义：官方2024–25及2026上半年表有PDF/Excel，BPM5与BPM6并列；应选BPM6 Cuadro1交易，Cuadro2是IIP。
- 证据链接：https://www.inec.gob.pa/Publicaciones/Default3.aspx?ID_CATEGORIA=4&ID_PUBLICACION=1428&ID_SUBCATEGORIA=24；https://www.inec.gob.pa/Publicaciones/Default2.aspx?ID_CATEGORIA=4&ID_SUBCATEGORIA=24
- 原状态：not_researched。API实测/自动化授权/分发授权：未完成/未知/未知。

### BOL 玻利维亚 · P2 / V1
- 机构：Banco Central de Bolivia。入口：https://www.bcb.gob.bo/?q=content%2Fsector-externo-0
- 频率：unknown_current。单位：unknown。
- 证据与语义：官方外部部门目录列BOP/IIP及报告；旧2005季度报表不足以证明当前频率/工具/单位，下载待核验。
- 证据链接：https://www.bcb.gob.bo/?q=content%2Fsector-externo-0
- 原状态：not_researched。API实测/自动化授权/分发授权：未完成/未知/未知。

### GUY 圭亚那 · P2 / V1
- 机构：Bureau of Statistics / Bank of Guyana。入口：https://statisticsguyana.gov.gy/IMF_NSDP/Guyana_NSDP.htm
- 频率：annual BOP verified historically; current periodicity pending。单位：USD million in 2022 annual report; current header pending。
- 证据与语义：官方NSDP有BOP Browse/SDMX；央行2025年报、2026季报/摘要可用，但有季报不等于有季度股权流量。
- 证据链接：https://statisticsguyana.gov.gy/IMF_NSDP/Guyana_NSDP.htm；https://bankofguyana.org.gy/bog3/publications/recent-publications；https://www.bankofguyana.org.gy/bog/images/research/Reports/ANNREP2022.pdf
- 原状态：not_researched。API实测/自动化授权/分发授权：未完成/未知/未知。

## 剩余缺口与下一步

- 本轮未为萨尔瓦多、海地、苏里南、东加勒比各经济体以及库拉索/圣马丁赋源；尚须逐国查找。货币联盟总量不可复制为成员国数据。
- 本批主要填补国家BOP来源研究，而非交易所每日外资流；纯股权、基金份额、机构类别、资产负债分侧均需进一步逐表确认。
- 建议先验证FIN/LTU/LVA/MKD/MDA的结构化接口，以及ALB明确的股权加基金子项，再推进季度报告型来源；C与V1-H先补实际当前产品。
- 全部为研究增量；与其他区域批次合并时按economy/source标识去重，不自动提升country-readiness到可用。
