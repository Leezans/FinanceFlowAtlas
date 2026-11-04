# 欧洲/美洲第五批：产品增量与统计归属分开

核验日期：2026-11-04。仅新增研究文件，不改主表。按此前已提交区域轮次及本轮记录去重，无重叠。

## 来源研究增量：3个经济体

2项V1，1项C。V1仅说明产品/数值证据，未认证API、生产可用或再分发权。

### PRI 波多黎各 · P2 / V1
- 官方机构：Junta de Planificación。入口：https://jp.pr.gov/wp-content/uploads/2025/06/Balanza-de-Pagos-2024-1.pdf
- 频率：annual fiscal years；单位：million dollars; USD currency code requires metadata confirmation。
- 证据：已打开官方2024报告的数值表：Table 1为财政年度标准BOP，证券投资资产与负债均分别列Equity and investment fund shares以及Debt securities。表列2015起至2024，纯股票与基金未拆开，符号约定和财政年度日期待核。另见2025产品目录，尚未读取2025文件。美国BEA ITA把属地纳入美国经济领土，而本地BOP采用地区边界；不可与美国总量简单相加。
- 其他证据：https://www.jp.pr.gov/estudios-e-investigacion/informe-economico-a-la-gobernadora-y-a-la-asamblea-legislativa?f3c90564_page=1；https://bea.gov/index.php/help/faq/1188
- 自动化/分发/费用：未知。series_id为空，不是已测试API。

### FRO 法罗群岛 · P2 / V1
- 官方机构：Statistics Faroe Islands / Hagstova Føroya。入口：https://hagstova.fo/en/economy/national-accounts/balance-payments
- 频率：annual release schedule; individual series frequency pending；单位：unknown。
- 证据：已打开官方BOP页，2026-10-05更新，下一次2027-10-04；实际链接PxWeb TB01目录。未核具体金融账户/股权系列；丹麦现行BOP明确排除此地区。
- 其他证据：https://statbank.hagstova.fo/pxweb/fo/H2/H2__TB__TB01/；https://www.dst.dk/en/Statistik/dokumentation/documentationofstatistics/balance-of-payments/statistical-presentation
- 自动化/分发/费用：未知。series_id为空，不是已测试API。

### SLV 萨尔瓦多 · P2 / C
- 官方机构：Banco Central de Reserva de El Salvador。入口：https://redibacen.bcr.gob.sv/conferencia.php?cod=304
- 频率：unknown；单位：unknown。
- 证据：BCR官方REDIBACEN材料确认编制发布BOP职责及金融账户解释；仅为机构方法证据，不是可下载series。国家经济数据库具体股权表仍未锁定，不采用IMF工作人员预测替代国家观测。
- 其他证据：https://redibacen.bcr.gob.sv/sitios.php
- 自动化/分发/费用：未知。series_id为空，不是已测试API。

## 统计归属/缺口：10个地区，不计为新增数据源

机器文件：territorial-scope-europe-americas-delta5.json 与 .csv。所有记录的national_source_id为空；不可把它们提升为国家数据已覆盖。

- **LIE 列支敦士登**：SNB现行调查说明明确Swiss BOP包含Liechtenstein，CH/LI均属居民。该覆盖证据不意味着有LIE独立股权序列。 证据：https://surveys.snb.ch/public/erlaeuterungen/D_CAS_1.0.html
- **MCO 摩纳哥**：法国国家提供的Eurostat BOP元数据明确包含本地区。未验证本地区独立证券股权流；IEDOM通用地理选择框不能证明每个指标均有每个地区数据。 证据：https://ec.europa.eu/eurostat/cache/metadata/en/bop_6_simsb62_fr.htm
- **GLP 瓜德罗普**：法国国家提供的Eurostat BOP元数据明确包含本地区。未验证本地区独立证券股权流；IEDOM通用地理选择框不能证明每个指标均有每个地区数据。 证据：https://ec.europa.eu/eurostat/cache/metadata/en/bop_6_simsb62_fr.htm
- **GUF 法属圭亚那**：法国国家提供的Eurostat BOP元数据明确包含本地区。未验证本地区独立证券股权流；IEDOM通用地理选择框不能证明每个指标均有每个地区数据。 证据：https://ec.europa.eu/eurostat/cache/metadata/en/bop_6_simsb62_fr.htm
- **MTQ 马提尼克**：法国国家提供的Eurostat BOP元数据明确包含本地区。未验证本地区独立证券股权流；IEDOM通用地理选择框不能证明每个指标均有每个地区数据。 证据：https://ec.europa.eu/eurostat/cache/metadata/en/bop_6_simsb62_fr.htm
- **SPM 圣皮埃尔和密克隆**：法国国家提供的Eurostat BOP元数据明确包含本地区。未验证本地区独立证券股权流；IEDOM通用地理选择框不能证明每个指标均有每个地区数据。 证据：https://ec.europa.eu/eurostat/cache/metadata/en/bop_6_simsb62_fr.htm
- **BLM 圣巴泰勒米**：法国国家提供的Eurostat BOP元数据明确包含本地区。未验证本地区独立证券股权流；IEDOM通用地理选择框不能证明每个指标均有每个地区数据。 证据：https://ec.europa.eu/eurostat/cache/metadata/en/bop_6_simsb62_fr.htm
- **MAF 法属圣马丁**：法国国家提供的Eurostat BOP元数据明确包含本地区。未验证本地区独立证券股权流；IEDOM通用地理选择框不能证明每个指标均有每个地区数据。 证据：https://ec.europa.eu/eurostat/cache/metadata/en/bop_6_simsb62_fr.htm
- **VIR 美属维尔京群岛**：BEA FAQ明确ITA把美国属地纳入国内经济领土，而NIPA处理不同。未找到本地独立股权BOP系列，不应复制美国总量。 证据：https://bea.gov/index.php/help/faq/1188
- **GRL 格陵兰**：现行丹麦BOP统计范围明确排除格陵兰。当地独立股权序列尚未找到；不能把排除误写成纳入，也不能据此断言无本地BOP。 证据：https://www.dst.dk/en/Statistik/dokumentation/documentationofstatistics/balance-of-payments/statistical-presentation

## 其他仍未解决的调查，不制造来源

- BLR：本轮未锁定白俄罗斯央行实际数据表。
- VEN：国家提供的IMF储备元数据提及BCV BOP年鉴，但不是股权数据；BOP元数据请求不可访问。
- CUB：仅见第三方指向ONEI年鉴，未取得可靠官方股权来源。
- VAT、GGY、JEY、IMN、GIB及其他属地：不将英国/意大利等国家总量按政治关系赋源。独立BOP/股权系列需继续核验。
- 发现母体统计范围不代表地方没有独立报表。波多黎各就是反例：纳入美国ITA，同时本地发布自己的BOP。

## 收购/接入建议

先取得波多黎各2025表及其元数据，确认美元代码、财政年度起止和资产负债符号，再与2024样本比对；保持股权加基金独立指标。法罗检查TB01的金融账户和工具维度。统计归属表用于防重和缺口解释，不用于补值。
