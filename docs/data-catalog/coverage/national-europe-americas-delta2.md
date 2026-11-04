# 欧洲与美洲国家来源增量：第二批

10个经济体；9个V1 BOP/组合统计入口，1个C机构入口（斯洛伐克）。均非已验证纯股权连接器。证据日期2026-11-04。未修改原始矩阵。

|国家|官方入口|频率|验证边界|
|---|---|---|---|
|波兰 POL|[NBP](https://static.nbp.pl/dane/bilans-platniczy/bopa_en.pdf)|monthly|P2 / V1；官方月度BOP说明，依据企业月/季报等估计；当前文件中的股权交易表尚未核查|
|斯洛文尼亚 SVN|[Banka Slovenije](https://px.bsi.si/pxweb/en/serije_ang/serije_ang__30_EOT__10_PLACILNA_BILANCA/?tablelist=true)|monthly|P2 / V1；官方 PxWeb 列 Balance of Payments BPM6 月度百万欧元；股权筛选值和API待试|
|斯洛伐克 SVK|[NBS](https://nbs.sk/en/statistics/)|unknown|P2 / C；官方统计入口有BOP；IMF SDDS明确国家银行发布职责，但未确认具体股权表或频率|
|塞尔维亚 SRB|[National Bank of Serbia](https://www.nbs.rs/en/drugi-nivo-navigacije/statistika/platni_bilans/)|unknown_pending_download|P2 / V1；官方BPM6 BOP 2007-2025归档入口；月/季度和纯股权需下载核验|
|希腊 GRC|[Bank of Greece](https://www.bankofgreece.gr/en/statistics/external-sector/balance-of-payments/financial-account)|monthly BOP; equity series frequency pending|P2 / V1；官方解释明确证券区分股权与债务，组合净额为资产减负债；SDDS方法确认月BOP，纯股权序列待查|
|卢森堡 LUX|[STATEC / official statistics portal](https://statistiques.public.lu/en/actualites/2026/bop-s1-26.html)|half-year release; underlying frequency pending|P2 / V1；2026上半年官方BOP发布有组合投资资产/负债；不能推断是纯股权或半年唯一频率|
|多米尼加共和国 DOM|[BCRD](https://bancentral.gov.do/a/CustomView/2532-sector-externo)|quarterly; annual|P2 / V1；官方BPM6 BOP与IIP分开提供；季度2010-2026、年度2010-2025，股权子表待核查|
|危地马拉 GTM|[Banco de Guatemala](https://banguat.gob.gt/page/balanza-de-pagos-trimestral-2008-en-adelante)|quarterly since 2008|P2 / V1；官方季度BOP入口及MBP6 HTML长表；不要误用并存的MBP5旧表；股权子行待核查|
|厄瓜多尔 ECU|[BCE](https://contenido.bce.fin.ec/documentos/PublicacionesNotas/S_externo.html)|quarterly|P2 / V1；官方外部部门目录列季度BOP数据；另有2026Q2发布佐证，但机器表和纯股权未定位|
|巴拉圭 PRY|[BCP](https://www.bcp.gov.py/en/balanza-de-pagos-y-posicion-de-inversion-internacional)|quarterly; annual|P2 / V1；官方页明确BOP/IIP流量存量、季度和年度公布；股权组合交易子项需核查|

所有单位（除斯洛文尼亚百万欧元）、API、许可、费用及纯股权子项仍需验证。两批合计32个经济体，不应宣传32个可用股权流接口。
未充分核实：罗马尼亚只有历史官方PDF；克罗地亚只有历史公报；立陶宛有季度发布但尚未定位当前数据入口；拉脱维亚只确认发布日历，搜索得到的支付系统统计不是BOP；均未编造相应源记录。
