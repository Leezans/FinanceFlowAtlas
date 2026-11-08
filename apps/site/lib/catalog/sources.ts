import geography from '@/components/atlas/countries.json';
import {HOSTS,YEARS} from '@/lib/asean/dimensions';
/** Discovery metadata only: never observations, availability, classifications or aggregation keys. */
export const assetLabels = {equity:'股票', securities:'跨境证券', direct:'直接投资', crypto:'加密现货', futures:'期货', options:'期权', fx:'外汇', prediction:'预测市场'} as const;
export type AssetClass = keyof typeof assetLabels;
export type EvidenceSource = {
 id:string; label:string; href:string; asset:AssetClass; country:string; geographyRole:string;
 period?:string; relatedIds?:readonly string[]; provider:string; metric:string; unit:string; frequency:string; drilldown:string; boundary:string;
};
export const evidenceSources: readonly EvidenceSource[] = [
 {"id": "ashare", "label": "A 股热力图", "href": "/ashare", "asset": "equity", "country": "CHN", "geographyRole": "本地市场", "provider": "东方财富", "metric": "订单分类估算", "unit": "CNY", "frequency": "盘中检查；来源时间可能未知", "drilldown": "提供商行业 → 成分股", "boundary": "大单与超大单净额，不是全市场新增资金。"},
 {"id": "tpex-shares", "label": "台股法人矩阵", "href": "/taiwan", "asset": "equity", "country": "TWN", "geographyRole": "本地市场", "provider": "TPEx", "metric": "机构净股数", "unit": "股", "frequency": "日度", "drilldown": "TPEx 公司行业 → 个股", "boundary": "股数不能与 TWD 金额相加；仅上柜范围。"},
 {"id": "cvm", "label": "巴西基金矩阵", "href": "/brazil", "asset": "equity", "country": "BRA", "geographyRole": "本地市场", "provider": "CVM", "metric": "披露基金股票净交易", "unit": "BRL", "frequency": "月度", "drilldown": "CVM 公司行业 → 证券", "boundary": "部分披露基金；分类不是历史时点分类，未匹配交易不分摊。"},
 {"id": "cboe", "label": "欧洲延迟价格", "href": "/europe", "asset": "equity", "country": "", "geographyRole": "交易场所", "provider": "Cboe BXE", "metric": "延迟成交价", "unit": "各证券报价币种", "frequency": "至少延迟 15 分钟", "drilldown": "交易证券", "boundary": "BXE 部分成交窗口；不是国家净资金流或完整市场覆盖。"},
 {"id": "worldbank", "label": "全球股市年度", "href": "/equities", "asset": "equity", "country": "", "geographyRole": "国家统计", "provider": "World Bank / WFE", "metric": "市值与成交额", "unit": "USD", "frequency": "年度", "drilldown": "国家；无行业 / 个股", "boundary": "市值是存量，成交额是交易量，均非净流入。"},
 {"id": "asean", "label": "东盟 FDI 行业", "href": "/asean", "asset": "direct", "country": "", "geographyRole": "投资目的地", "provider": "ASEANstats", "metric": "净流入直接投资", "unit": "百万 USD", "frequency": "年度", "drilldown": "东盟目的地 → 经济行业", "boundary": "FDI 非证券交易；行业分类不能与股票行业拼接。"},
 {"id": "kraken", "relatedIds": ["deribit"], "label": "加密现货", "href": "/crypto", "asset": "crypto", "country": "", "geographyRole": "交易场所", "provider": "Kraken", "metric": "价格、成交与主动买卖差", "unit": "所选报价币种", "frequency": "来源成交窗口", "drilldown": "币种 → 现货交易对", "boundary": "单交易所；主动买卖差不代表全市场资本流入。"},
 {"id": "polymarket", "label": "预测市场矩阵", "href": "/polymarket", "asset": "prediction", "country": "", "geographyRole": "事件市场", "provider": "Polymarket", "metric": "概率、成交量与未平仓量", "unit": "概率 / USD 口径分别保留", "frequency": "来源快照", "drilldown": "事件 → 市场 / 结果", "boundary": "概率与成交量、持仓不能相加，不归入某国股市。"},
 {"id": "cftc", "label": "期货持仓", "href": "/futures", "asset": "futures", "country": "USA", "geographyRole": "监管报告市场", "provider": "CFTC", "metric": "持仓与持仓变化", "unit": "各合约自身张数", "frequency": "周度滞后", "drilldown": "市场组 → 合约市场", "boundary": "美国报告场所不等于标的国家；跨品种张数不作金额。"},
 {"id": "taifex-futures", "label": "台湾期货日报", "href": "/futures/taiwan", "asset": "futures", "country": "TWN", "geographyRole": "交易场所", "provider": "TAIFEX", "metric": "期货成交及持仓名义金额", "unit": "TWD / 合约张数", "frequency": "日度", "drilldown": "产品 → 三类法人", "boundary": "名义金额不是实际现金流，不与期权权利金合计。"},
 {"id": "deribit", "relatedIds": ["kraken"], "label": "加密期权成交", "href": "/options", "asset": "options", "country": "", "geographyRole": "交易场所", "provider": "Deribit", "metric": "期权成交、价格与持仓", "unit": "USD 成交额 / BTC、ETH 报价", "frequency": "来源快照；延迟未确认", "drilldown": "标的 → 到期 / 合约", "boundary": "单交易所；成交额不是净流入。"},
 {"id": "taifex-options", "label": "台湾期权日报", "href": "/options/taiwan", "asset": "options", "country": "TWN", "geographyRole": "交易场所", "provider": "TAIFEX", "metric": "权利金交易与持仓", "unit": "TWD / 合约张数", "frequency": "日度", "drilldown": "产品 → 看涨 / 看跌 → 法人", "boundary": "权利金与期货名义金额不是同一量。"},
 {"id": "fx", "label": "外汇行情", "href": "/forex", "asset": "fx", "country": "", "geographyRole": "货币对", "provider": "Kraken / ECB", "metric": "现货价格与每日参考汇率", "unit": "报价货币 / 基础货币", "frequency": "现货窗口；ECB 日度分别保留", "drilldown": "货币 → 货币对", "boundary": "ECB 参考汇率不是可成交价格；币种不等于国家净流量。"},
 {"id": "tpex-money", "label": "台湾上柜法人金额", "href": "/markets?country=TWN", "asset": "equity", "country": "TWN", "geographyRole": "本地市场", "provider": "TPEx", "metric": "机构净买卖金额", "unit": "TWD", "frequency": "日度", "drilldown": "三类法人；无行业金额", "boundary": "行业股数页仅相关证据，不是此金额的下级分解。"},
 {"id": "mof", "label": "日本跨境证券交易", "href": "/markets?country=JPN", "asset": "securities", "country": "JPN", "geographyRole": "发行人市场", "provider": "日本财务省 MOF", "metric": "非居民证券净取得", "unit": "亿 JPY", "frequency": "周度", "drilldown": "股票及基金份额 / 长债 / 短债", "boundary": "指定主要机构样本；无行业与个股分解。"},
 {"id": "tic", "label": "美国 TIC 跨境交易", "href": "/markets?country=USA#us-tic-supplement", "asset": "equity", "country": "USA", "geographyRole": "发行人市场", "provider": "U.S. Treasury TIC", "metric": "外国居民净购买美国股权", "unit": "USD（原始百万 USD）", "frequency": "月度", "drilldown": "投资者居住地；无行业 / 个股", "boundary": "居住地是交易对手，不是当地股市流向；国家行不穷尽总额。"},
 ];
/** Geography is a query identity, never proof of a financial observation. */
const countryCodes=new Set(geography.map(country=>country.iso3));
const baseSource=(id:string)=>evidenceSources.find(source=>source.id===id)!;
export function annualCountrySources(iso3:string):EvidenceSource[] {
 if(!countryCodes.has(iso3)) return [];
 const annual:EvidenceSource={...baseSource('worldbank'),country:iso3,href:`/equities?country=${iso3}#country-equity`,label:'核验该国年度股市指标',period:'各指标实际年份在目标矩阵分别核验；此处未加载观测',boundary:'国家仅用于查询定位，不保证来源有该国数据。市值是年末存量，成交额是全年交易量；都不是净资金流。'};
 const host=HOSTS.find(host=>host.iso3===iso3);
 return host?[annual,{...baseSource('asean'),country:iso3,href:`/asean?country=${iso3}&year=${YEARS.at(-1)}`,period:`请求观察年度 ${YEARS.at(-1)}；有无观测待目标矩阵核验`}]:[annual];
}
export function sourcesForCountry(iso3:string) {
 return [...evidenceSources.filter(source=>source.country===iso3),...annualCountrySources(iso3)];
}
export function sourcesForPath(path:string) { return evidenceSources.filter(source => source.href === path || (path === '/' && source.id === 'ashare')); }
export function relatedSources(source:EvidenceSource) {
 const candidates=[...evidenceSources.filter(other=>other.asset===source.asset||source.relatedIds?.includes(other.id)),...(source.country?sourcesForCountry(source.country):[])];
 return [...new Map(candidates.filter(other=>other.id!==source.id).map(other=>[other.id,other])).values()];
}
/** Canonical query identities ignore unrelated parameters, never infer TIC from country alone. */
export function sourceForLocation(path:string, search='', hash='') {
 const query=new URLSearchParams(search),country=query.get('country');
 if(path==='/equities'&&countryCodes.has(country??'')) return annualCountrySources(country!).find(source=>source.id==='worldbank');
 if(path==='/asean') {
  const source=country?annualCountrySources(country).find(source=>source.id==='asean'):undefined;
  const year=Number(query.get('year'));
  const selectedYear=YEARS.some(value=>value===year)?year:YEARS.at(-1)!;
  return {...(source??baseSource('asean')),period:`请求观察年度 ${selectedYear}；有无观测待目标矩阵核验`};
 }
 if(path !== '/markets') return sourcesForPath(path)[0];
 const id=country==='TWN'?'tpex-money':country==='JPN'?'mof':country==='USA'&&hash==='#us-tic-supplement'?'tic':null;
 return evidenceSources.find(source=>source.id===id);
}
