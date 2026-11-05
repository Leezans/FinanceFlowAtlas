import {createHash} from 'node:crypto';
import {CsvZip} from './zip';
import {snapshotSchema,ATTRIBUTION,sourceUrls,type CvmSnapshot} from './model';
type Row=Record<string,string>;
const joinKey=(r:Row)=>[r.CNPJ_Companhia,r.ID_Documento,r.Versao,r.Data_Referencia].join('|');
function cents(s:string):bigint|null{if(s==='')return null;if(!/^\d{1,18}(?:\.\d{1,2})?$/.test(s))throw new Error('invalid_source_amount');const [a,b='']=s.split('.');return BigInt(a)*BigInt(100)+BigInt(b.padEnd(2,'0'));}
function safe(n:bigint){if(n>BigInt(Number.MAX_SAFE_INTEGER)||n<BigInt(Number.MIN_SAFE_INTEGER))throw new Error('source_amount_overflow');return Number(n);}
function validDay(d:string){return /^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;}
export async function parseCvm(cdaZip:Uint8Array,fcaZip:Uint8Array,period:string,started:string,fetched:string,signal?:AbortSignal):Promise<CvmSnapshot>{
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)||!Number.isFinite(Date.parse(started))||!Number.isFinite(Date.parse(fetched)))throw new Error('invalid_source_period');
 const [year,month]=period.split('-').map(Number),report_date=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10),first=period+'-01';
 if(report_date>new Date(started).toISOString().slice(0,10))throw new Error('future_source_period');
 const budget={consumed:0},fca=new CsvZip(fcaZip,budget),cda=new CsvZip(cdaZip,budget),general=new Map<string,{name:string,industry:string}|null>();
 const fcaKeys=['CNPJ_Companhia','ID_Documento','Versao','Data_Referencia'];
 for await(const r of fca.csv(`fca_cia_aberta_geral_${year}.csv`,[...fcaKeys,'Nome_Empresarial','Setor_Atividade','Pais_Origem'],signal)){
  if(r.Pais_Origem!=='Brasil'||!r.Setor_Atividade.trim()||!r.Nome_Empresarial.trim())continue;
  const k=joinKey(r);if(general.has(k))general.set(k,null);else general.set(k,{name:r.Nome_Empresarial,industry:r.Setor_Atividade});
 }
 type Company={name:string,industry:string,identity:string};
 const companies=new Map<string,Company|null>();
 for await(const r of fca.csv(`fca_cia_aberta_valor_mobiliario_${year}.csv`,[...fcaKeys,'Codigo_Negociacao','Valor_Mobiliario','Mercado','Sigla_Entidade_Administradora','Data_Inicio_Negociacao','Data_Fim_Negociacao'],signal)){
  if(!['Ações Ordinárias','Ações Preferenciais'].includes(r.Valor_Mobiliario)||r.Mercado!=='Bolsa'||r.Sigla_Entidade_Administradora!=='B3')continue;
  const code=r.Codigo_Negociacao;
  if(!/^[A-Z0-9]{4}\d{1,2}$/.test(code))continue;
  if((r.Data_Inicio_Negociacao&&!validDay(r.Data_Inicio_Negociacao))||(r.Data_Fim_Negociacao&&!validDay(r.Data_Fim_Negociacao)))throw new Error('invalid_classification_date');
  if(r.Data_Inicio_Negociacao>report_date||(r.Data_Fim_Negociacao&&r.Data_Fim_Negociacao<first))continue;
  const g=general.get(joinKey(r));if(!g){companies.set(code,null);continue;}
  const old=companies.get(code),identity=joinKey(r)+'|'+r.Valor_Mobiliario;
  if(companies.has(code)&&(old===null||old!.identity!==identity||old!.industry!==g.industry))companies.set(code,null);
  else companies.set(code,{...g,identity});
 }
 const counts={source_rows:0,matched_rows:0,unmatched_rows:0,ambiguous_rows:0,null_amount_rows:0,duplicate_rows:0,confidential_rows:0,public_funds:0,confidential_funds:0};
 const funds=new Set<string>(),confidential=new Set<string>(),seen=new Set<string>();
 const totals=new Map<string,{buy:bigint,sell:bigint,missing:boolean,source_rows:number}>();
 const headers=['TP_FUNDO_CLASSE','CNPJ_FUNDO_CLASSE','DT_COMPTC','TP_APLIC','TP_ATIVO','CD_ATIVO','VL_VENDA_NEGOC','VL_AQUIS_NEGOC','TP_NEGOC','CD_ISIN','DT_INI_VIGENCIA','DT_FIM_VIGENCIA'];
 for await(const r of cda.csv(`cda_fi_BLC_4_${period.replace('-','')}.csv`,headers,signal)){
  // Only verified current FIF classes; legacy FI/FIP/FIE and all other assets are excluded.
  if(r.TP_FUNDO_CLASSE!=='CLASSES - FIF'||r.TP_APLIC!=='Ações'||!['Ação ordinária','Ação preferencial'].includes(r.TP_ATIVO))continue;
  if(r.DT_COMPTC!==report_date||!r.CNPJ_FUNDO_CLASSE)throw new Error('invalid_source_period');
  counts.source_rows++;funds.add(r.CNPJ_FUNDO_CLASSE);
  const code=r.CD_ATIVO,key=[r.CNPJ_FUNDO_CLASSE,r.DT_COMPTC,r.TP_APLIC,r.TP_ATIVO,r.TP_NEGOC,code,r.CD_ISIN,r.DT_INI_VIGENCIA,r.DT_FIM_VIGENCIA].join('|');
  const duplicate=seen.has(key);seen.add(key);
  const buy=cents(r.VL_AQUIS_NEGOC),sell=cents(r.VL_VENDA_NEGOC);if(buy===null||sell===null)counts.null_amount_rows++;
  const company=companies.get(code);
  if(duplicate){counts.duplicate_rows++;const t=totals.get(code);if(t)t.missing=true;continue;}
  if(company===null){counts.ambiguous_rows++;continue;}
  if(!company){counts.unmatched_rows++;continue;}
  counts.matched_rows++;
  const t=totals.get(code)??{buy:BigInt(0),sell:BigInt(0),missing:false,source_rows:0};t.source_rows++;
  if(buy===null||sell===null)t.missing=true;else{t.buy+=buy;t.sell+=sell;}totals.set(code,t);
 }
 for await(const r of cda.csv(`cda_fi_CONFID_${period.replace('-','')}.csv`,['TP_FUNDO_CLASSE','CNPJ_FUNDO_CLASSE','DT_COMPTC','TP_APLIC'],signal)){
  if(r.TP_FUNDO_CLASSE!=='CLASSES - FIF'||r.TP_APLIC!=='Ações')continue;
  if(r.DT_COMPTC!==report_date||!r.CNPJ_FUNDO_CLASSE)throw new Error('invalid_source_period');
  counts.confidential_rows++;confidential.add(r.CNPJ_FUNDO_CLASSE);
 }
 counts.public_funds=funds.size;counts.confidential_funds=confidential.size;
 const rows=[...companies].filter((entry):entry is [string,Company]=>entry[1]!==null).map(([code,c])=>{const t=totals.get(code);return{code,name:c.name,industry:c.industry,flow:!t||t.missing?null:{buy:safe(t.buy),sell:safe(t.sell),net:safe(t.buy-t.sell)},source_rows:t?.source_rows??0};}).sort((a,b)=>a.code.localeCompare(b.code));
 // Also bound full visible totals so client-side aggregation cannot silently lose cents.
 for(const field of ['buy','sell','net'] as const)safe(rows.reduce((sum,r)=>sum+BigInt(r.flow?.[field]??0),BigInt(0)));
 return snapshotSchema.parse({schema:'cvm-fund-equity/1',source:'CVM',license:'ODbL-1.0',attribution:ATTRIBUTION,source_urls:sourceUrls(period),source_sha256:{cda:createHash('sha256').update(cdaZip).digest('hex'),fca:createHash('sha256').update(fcaZip).digest('hex')},market:'Brazil_B3_equities',unit:'BRL_cents',period,report_date,classification_date:new Date(fetched).toISOString().slice(0,10),classification_point_in_time:false,source_released_at:null,acquisition_started_at:started,fetched_at:fetched,net_capital_flow:null,coverage:'public_disclosed_fund_transactions_only',counts,rows});
}
