/** Fixed, publicly verified portal dimensions, not a claim of complete ASEAN coverage. */
export const YEARS=[2017,2018,2019,2020,2021,2022,2023,2024,2025] as const;
export const HOSTS=[
 {code:'BN',label:'文莱',source:'Brunei Darussalam'}, {code:'KH',label:'柬埔寨',source:'Cambodia'},
 {code:'ID',label:'印度尼西亚',source:'Indonesia'}, {code:'LA',label:'老挝',source:'Lao PDR'},
 {code:'MY',label:'马来西亚',source:'Malaysia'}, {code:'MM',label:'缅甸',source:'Myanmar'},
 {code:'PH',label:'菲律宾',source:'Philippines'}, {code:'SG',label:'新加坡',source:'Singapore'},
 {code:'TH',label:'泰国',source:'Thailand'}, {code:'TL',label:'东帝汶',source:'Timor Leste'},
 {code:'VN',label:'越南',source:'Viet Nam'},
] as const;
export const SECTORS=[
 {code:'A',label:'农林渔业',source:'Agriculture, forestry, and fishing'},
 {code:'B',label:'采矿采石',source:'Mining and quarrying'},
 {code:'C',label:'制造业',source:'Manufacturing'},
 {code:'D',label:'电力燃气',source:'Electricity, gas, steam and air conditioning supply'},
 {code:'E',label:'供水与环境治理',source:'Water supply; sewerage, waste management and remediation activities'},
 {code:'F',label:'建筑业',source:'Construction'},
 {code:'G',label:'批发零售与车辆维修',source:'Wholesale and retail trade; repair of motor vehicles and motor cycles'},
 {code:'H',label:'交通仓储',source:'Transportation and storage'},
 {code:'I',label:'住宿餐饮',source:'Accommodation and food service activities'},
 {code:'J',label:'信息通信',source:'Information and communication'},
 {code:'K',label:'金融保险',source:'Financial and Insurance activities'},
 {code:'L',label:'房地产业',source:'Real estate activities'},
 {code:'M',label:'专业科研技术服务',source:'Professional, scientific and technical activities'},
 {code:'N',label:'行政支持服务',source:'Administrative and support service activities'},
 {code:'O',label:'公共行政与社会保障',source:'Public administration and defence; compulsory social security'},
 {code:'P',label:'教育',source:'Education'},
 {code:'Q',label:'医疗与社会工作',source:'Human health and social work activities'},
 {code:'R',label:'文体娱乐',source:'Arts, entertainment and recreation'},
 {code:'S',label:'其他服务',source:'Other services activities.'},
 {code:'Z',label:'未指定行业',source:'Unspecified activity'},
] as const;
export const HOST_CODES=HOSTS.map(h=>h.code),SECTOR_CODES=SECTORS.map(s=>s.code);
export const CELL_COUNT=YEARS.length*HOSTS.length*SECTORS.length;
export const SOURCE_DOMAIN='data.aseanstats.org';
/** Terms require permission before website hyperlinks/framing. Render attribution as plain text. */
export const SOURCE_ATTRIBUTION='资料来源：ASEANstats（东盟秘书处统计部门），FDI by AMS Economic Sectors – Inward，data.aseanstats.org。';
