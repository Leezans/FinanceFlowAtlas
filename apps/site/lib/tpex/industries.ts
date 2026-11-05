/** Official TPEx code table, IP market-information specification v5.4l (2025-05-13).
 * https://dsp.tpex.org.tw/storage/eb_data/11405/1140500476-1.pdf
 * Classification facts only; this is not a license for that separate quote feed.
 */
export const INDUSTRY_REFERENCE='https://dsp.tpex.org.tw/storage/eb_data/11405/1140500476-1.pdf';
export const INDUSTRY_NAMES:Readonly<Record<string,string>>={
 '02':'食品工業','03':'塑膠工業','04':'紡織纖維','05':'電機機械','06':'電器電纜','10':'鋼鐵工業','14':'建材營造','15':'航運業','16':'觀光餐旅','17':'金融業','20':'其他','21':'化學工業','22':'生技醫療業','23':'油電燃氣業','24':'半導體業','25':'電腦及週邊設備業','26':'光電業','27':'通信網路業','28':'電子零組件業','29':'電子通路業','30':'資訊服務業','31':'其他電子業','32':'文化創意業','33':'農業科技業','35':'綠能環保','36':'數位雲端','37':'運動休閒','38':'居家生活',
};
export const industryLabel=(code:string)=>INDUSTRY_NAMES[code]?`${INDUSTRY_NAMES[code]} · ${code}`:`产业 ${code}（名称未核验）`;
