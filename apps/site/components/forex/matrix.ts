import type {FxSnapshot} from '@/lib/fx/model';
import type {MatrixGroup} from '@/lib/matrix/model';

export const currencyNames:Readonly<Record<string,string>>={EUR:'欧元',USD:'美元',CNY:'人民币',JPY:'日元',GBP:'英镑',HKD:'港元',CHF:'瑞士法郎',AUD:'澳元',CAD:'加拿大元',SGD:'新加坡元',KRW:'韩元',INR:'印度卢比',NZD:'新西兰元',BRL:'巴西雷亚尔',MXN:'墨西哥比索',ZAR:'南非兰特',SEK:'瑞典克朗',NOK:'挪威克朗',DKK:'丹麦克朗',CZK:'捷克克朗',PLN:'波兰兹罗提',HUF:'匈牙利福林',RON:'罗马尼亚列伊',ISK:'冰岛克朗',TRY:'土耳其里拉',IDR:'印尼卢比',ILS:'以色列新谢克尔',MYR:'马来西亚林吉特',PHP:'菲律宾比索',THB:'泰铢'};

/** Exact reference quotes only. Currency denominations are not comparable magnitudes. */
export function fxReferenceGroups(snapshot:FxSnapshot|null,query=''):MatrixGroup[]{
 if(!snapshot)return [];
 const normalized=query.trim().toLowerCase();
 const rates=snapshot.rates.filter(rate=>`${rate.currency} ${currencyNames[rate.currency]??''}`.toLowerCase().includes(normalized));
 if(!rates.length)return [];
 return [{id:'ecb-reference',label:`ECB · ${snapshot.reference_date} · 1 EUR 对应的报价币`,items:rates.map(rate=>({
  id:rate.currency,label:`${rate.currency} · ${currencyNames[rate.currency]??'来源新增币种'}`,
  displayValue:`${rate.per_eur} ${rate.currency}`,
  detail:`1 EUR = ${rate.per_eur} ${rate.currency} · 来源原始精度 · ${snapshot.reference_date}`,
  colorValue:null,
 }))}];
}
