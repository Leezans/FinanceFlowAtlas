import geography from '../atlas/countries.json';
// Geography only. Existing coverage fields are intentionally not used as market evidence.
export const markets = geography.map(({iso3,iso2,name,numeric,region})=>({iso3,iso2,name,numeric,region}));
export type Market = typeof markets[number];
const chinese = new Intl.DisplayNames(['zh-CN'], {type:'region'});
export function marketName(market:Market){return chinese.of(market.iso2)||market.name}
export function searchMarkets(query:string){const q=query.trim().toLocaleLowerCase();return markets.filter(m=>`${m.iso3} ${m.iso2} ${m.name} ${marketName(m)}`.toLocaleLowerCase().includes(q))}
export const marketRoutes:Record<string,{href:string;label:string;metric:string;frequency:string;unit:string;scope:string;reference:string;sourceLabel:string}> = {
 TWN:{href:'/taiwan',label:'进入台股上柜行业 → 股票',metric:'三大法人上柜股票净买卖',frequency:'每日交易统计',unit:'股（shares），非货币金额',scope:'TPEx 上柜市场三大法人净买卖，不包含上市市场，也不是全部市场资金流。未匹配行业不分摊。',reference:'https://data.gov.tw/dataset/11856',sourceLabel:'TPEx 官方来源'},
 BRA:{sourceLabel:'CVM 官方开放数据',href:'/brazil',label:'进入巴西基金行业 → 股票',metric:'公开基金股票月度买卖净额',frequency:'月度披露，每日检查',unit:'巴西雷亚尔（BRL）',scope:'CVM 已公开基金交易，按官方行业连接。部分覆盖，保密及未匹配交易不分摊；不是全部机构或全市场资金流。',reference:'https://dados.cvm.gov.br/dataset/fi-doc-cda'},
 CHN:{sourceLabel:'提供商接口文档',href:'/ashare',label:'进入 A 股行业 → 个股',metric:'提供商按订单分类的主力净额',frequency:'页面每分钟检查；来源更新时间未知',unit:'人民币（CNY）',scope:'A 股行业 → 成分股。不是全市场资金净流入；行业成员口径以来源页为准。',reference:'https://akshare.akfamily.xyz/data/stock/stock_flow.html'},
 USA:{sourceLabel:'美国财政部官方来源',href:'/markets#global-evidence',label:'查看 TIC 跨境补充层',metric:'境外交易对手净买入美国股票',frequency:'月度',unit:'USD；金额在来源页展示',scope:'按外国交易对手居住地分类，不是美国行业资金流，不能下钻为行业或个股。',reference:'https://home.treasury.gov/data/treasury-international-capital-tic-system'},
};
