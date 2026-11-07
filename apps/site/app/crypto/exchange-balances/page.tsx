import ExchangeBalances from '@/components/crypto/ExchangeBalances';
// 只有明确启用的本地开发会展示个人视图，生产构建始终关闭。
export default function ExchangeBalancesPage(){
 if(process.env.NODE_ENV!=='development'||process.env.FFA_PERSONAL_EXCHANGE_BALANCES!=='1') return <main><h1>个人交易所余额研究未启用</h1><p>仅限本地个人非商业研究。此页面不会请求来源或公开再分发数据。</p><a href="/crypto">返回虚拟货币</a></main>;
 return <ExchangeBalances/>;
}
