/** Explicit TWD admission list. Never infer currency from an index's country. */
export const PRODUCTS=[
 {id:'tx',label:'臺股期貨',definition_url:'https://www.taifex.com.tw/cht/2/tX'},
 {id:'mtx',label:'小型臺指期貨',definition_url:'https://www.taifex.com.tw/cht/2/mTX'},
 {id:'tmf',label:'微型臺指期貨',definition_url:'https://www.taifex.com.tw/cht/2/tMF'},
 {id:'te',label:'電子期貨',definition_url:'https://www.taifex.com.tw/cht/2/tE'},
 {id:'zef',label:'小型電子期貨',definition_url:'https://www.taifex.com.tw/cht/2/zEF'},
 {id:'tf',label:'金融期貨',definition_url:'https://www.taifex.com.tw/cht/2/tF'},
 {id:'zff',label:'小型金融期貨',definition_url:'https://www.taifex.com.tw/cht/2/zFF'},
 {id:'xif',label:'非金電期貨',definition_url:'https://www.taifex.com.tw/cht/2/xIF'},
 {id:'gtf',label:'櫃買指數期貨',definition_url:'https://www.taifex.com.tw/cht/2/gTF'},
 {id:'g2f',label:'富櫃200期貨',definition_url:'https://www.taifex.com.tw/cht/2/g2F'},
 {id:'e4f',label:'臺灣永續期貨',definition_url:'https://www.taifex.com.tw/cht/2/e4F'},
 {id:'btf',label:'臺灣生技期貨',definition_url:'https://www.taifex.com.tw/cht/2/bTF'},
 {id:'sof',label:'半導體30期貨',definition_url:'https://www.taifex.com.tw/cht/2/sOF'},
 {id:'shf',label:'航運期貨',definition_url:'https://www.taifex.com.tw/cht/2/sHF'},
 {id:'tjf',label:'東證期貨',definition_url:'https://www.taifex.com.tw/cht/2/tJF'},
 {id:'spf',label:'美國標普500期貨',definition_url:'https://www.taifex.com.tw/cht/2/sPF'},
 {id:'unf',label:'美國那斯達克100期貨',definition_url:'https://www.taifex.com.tw/cht/2/uNF'},
 {id:'udf',label:'美國道瓊期貨',definition_url:'https://www.taifex.com.tw/cht/2/uDF'},
 {id:'sxf',label:'美國費城半導體期貨',definition_url:'https://www.taifex.com.tw/cht/2/sXF'},
 {id:'f1f',label:'英國富時100期貨',definition_url:'https://www.taifex.com.tw/cht/2/f1F'},
 {id:'m1f',label:'臺灣中型100期貨',definition_url:'https://www.taifex.com.tw/cht/2/m1F'},
 // Official statistics explicitly label both aggregate amounts as TWD and
 // use the same execution-price × multiplier × contracts formula.
 {id:'equity',label:'股票期貨',definition_url:'https://www.taifex.com.tw/cht/7/monthlyFutData'},
 {id:'etf',label:'ETF期貨',definition_url:'https://www.taifex.com.tw/cht/7/monthlyFutData'},
] as const;
export type Product=typeof PRODUCTS[number]['id'];
export const PRODUCT_IDS=PRODUCTS.map(product=>product.id) as [Product,...Product[]];
