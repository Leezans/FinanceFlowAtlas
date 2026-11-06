import geography from '../atlas/countries.json';
import {ASHARE_FLOW_METHODOLOGY_URL} from '@/lib/ashare/metric-semantics';
// Geography only. Existing coverage fields are intentionally not used as market evidence.
export const markets = geography.map(({iso3,iso2,name,numeric,region})=>({iso3,iso2,name,numeric,region}));
export type Market = typeof markets[number];
const chinese = new Intl.DisplayNames(['zh-CN'], {type:'region'});
export function marketName(market:Market){return chinese.of(market.iso2)||market.name}
export function searchMarkets(query:string){const q=query.trim().toLocaleLowerCase();return markets.filter(m=>`${m.iso3} ${m.iso2} ${m.name} ${marketName(m)}`.toLocaleLowerCase().includes(q))}
export type MarketRoute = {href:string;label:string;shortLabel:string;metric:string;frequency:string;unit:string;scope:string;reference:string;sourceLabel:string;drilldown:string};
/** Only sources describing this market. TIC residence is never an own-market route. */
export const marketRoutes: Record<string, MarketRoute> = {
 CHN:{sourceLabel:'东方财富资金流说明',href:'/ashare',label:'进入 A 股行业 → 个股',shortLabel:'订单分类估算',metric:'东方财富大单与超大单主力净额',frequency:'每分钟检查；来源时间未知',unit:'人民币（CNY）',scope:'中国 A 股行业与成分股的主力净额，仅东方财富大单与超大单分类估算，不是所有交易资金净流入，也非新增入市资金；不声称每分钟更新。',drilldown:'提供商一级行业 → 成分股',reference:ASHARE_FLOW_METHODOLOGY_URL},
 TWN:{href:'/markets?country=TWN',label:'进入台股上柜本地净买卖',shortLabel:'每日法人净买卖',metric:'TPEx 三大法人上柜净买卖金额',frequency:'每日报告；每小时检查',unit:'新台币（TWD）；行业页另为股数',scope:'台湾上柜市场官方三大法人汇总，证券范围按来源；不包含全台湾市场，不是行业金额或全市场资金净流入。金额与公司股数分开。',drilldown:'金额按参与者；行业 / 个股仅有净股数',reference:'https://data.gov.tw/dataset/11743',sourceLabel:'TPEx 官方开放数据'},
 JPN:{href:'/markets?country=JPN',label:'进入日本证券非居民净买卖',shortLabel:'周度跨境净买卖',metric:'MOF 非居民买卖日本证券净额',frequency:'周度报告；每 6 小时检查；非实时',unit:'亿日元（100 million JPY）',scope:'日本财务省指定主要金融机构报告的非居民日本证券净取得 / 净处置。日本发行人，非美国基准；仅跨境证券交易样本，不是全国所有资金流或 JPX 投资者分类。',drilldown:'按资产类别；无行业 / 公司分解',reference:'https://www.mof.go.jp/english/policy/international_policy/reference/itn_transactions_in_securities/index.htm',sourceLabel:'日本财务省官方统计'},
 BRA:{sourceLabel:'CVM 官方开放数据',href:'/brazil',label:'进入巴西基金行业 → 股票',shortLabel:'月度基金交易',metric:'公开基金股票月度买卖净额',frequency:'月度披露，每日检查；非实时',unit:'巴西雷亚尔（BRL）',scope:'CVM 已公开基金交易，按官方行业连接。部分覆盖，保密及未匹配交易不分摊；不是全部机构或全市场资金流。',drilldown:'官方公司行业 → 证券',reference:'https://dados.cvm.gov.br/dataset/fi-doc-cda'},
};
