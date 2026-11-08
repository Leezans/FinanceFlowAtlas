import {HOSTS,YEARS} from './dimensions';
/** Fixed source dimensions only. A URL selects a query, not a reported observation. */
export function fdiSelection(search:string) {
 const query=new URLSearchParams(search),requestedCountry=query.get('country'),requestedYear=query.get('year');
 const host=HOSTS.find(host=>host.iso3===requestedCountry);
 const year=requestedYear===null?YEARS.at(-1)!:Number(requestedYear);
 const validYear=YEARS.some(value=>value===year);
 return {host:host?.code??'',year:validYear?year:YEARS.at(-1)!,invalidCountry:requestedCountry!==null&&!host,invalidYear:requestedYear!==null&&!validYear};
}
export function fdiSelectionUrl(current:string,host:string,year:number) {
 const url=new URL(current),country=HOSTS.find(country=>country.code===host);
 if(country) url.searchParams.set('country',country.iso3); else url.searchParams.delete('country');
 url.searchParams.set('year',String(year));
 return url;
}
