"use client";
import React from 'react';
import {geoNaturalEarth1,geoPath,geoCentroid,geoGraticule10} from 'd3-geo';
import {feature} from 'topojson-client';
import type {Topology,GeometryCollection} from 'topojson-specification';
import type {FeatureCollection,Geometry} from 'geojson';
import topology from 'world-atlas/countries-110m.json';
import fallback from './countries.json';
import type {Country} from './model';
import {signedMillions, flowDirection, type TicFlow, type TicSnapshot} from '@/lib/tic/model';
const countries=fallback as Country[];
const geometries=feature(topology as unknown as Topology,topology.objects.countries as unknown as GeometryCollection) as FeatureCollection<Geometry>;
const projection=geoNaturalEarth1().fitExtent([[25,15],[975,490]],{type:'Sphere'}),path=geoPath(projection);
const centers=new Map(geometries.features.map(f=>[String(f.id).padStart(3,'0'),geoCentroid(f)]));
const byIso=new Map(countries.map(c=>[c.iso3,c])),byNumeric=new Map(countries.map(c=>[c.numeric,c]));
type Props={rows:TicFlow[];data:TicSnapshot|null;country:string;onCountry:(iso:string)=>void;onRegion:(region:string)=>void};
/** Geographic geometry is loaded only when this secondary evidence view opens. */
export default function TicMap({rows,data,country,onCountry,onRegion}:Props){
 const activePeriod=data?.period||'';
 const observations=new Map((data?.country_flows??[]).map(r=>[r.foreign_economy_iso3,r]));
 const selected=byIso.get(country);
 const arcs=rows.filter(r=>r.net_foreign_purchases_usd!==0&&centers.has(byIso.get(r.foreign_economy_iso3)?.numeric||''));
 const max=Math.max(1,...rows.map(r=>Math.abs(r.net_foreign_purchases_usd)));
 return <div className="map-wrap"><div className="map-heading"><span>{selected?.name||'TIC 美国股权交易 · 境外报告居住地'}</span><span>{activePeriod||'等待来源'} · 静态净交易关系</span></div><div className="map-scroll"><svg viewBox="0 0 1000 510" role="img" aria-label="TIC US equity net transactions by reported foreign residence"><path className="graticule" d={path(geoGraticule10())||''}/>{geometries.features.map((f,i)=>{const c=byNumeric.get(String(f.id).padStart(3,'0'));const row=c&&observations.get(c.iso3);return <path key={`${f.id}-${i}`} d={path(f)||''} className={`country tic-country ${row?row.net_foreign_purchases_usd>0?'tic-positive':row.net_foreign_purchases_usd<0?'tic-negative':'tic-zero':''} ${c?.iso3==='USA'?'tic-us':''} ${c?.iso3===country?'selected':''}`} role={c?'button':undefined} tabIndex={c?0:undefined} aria-label={c?`TIC ${c.name}`:undefined} onClick={()=>{if(c){onCountry(c.iso3);onRegion('')}}} onKeyDown={e=>{if(c&&(e.key==='Enter'||e.key===' ')){e.preventDefault();onCountry(c.iso3);onRegion('')}}}><title>{`${c?.name||f.properties?.name} · ${c?.iso3==='USA'?'证券发行经济体':row?`${signedMillions(row.net_foreign_purchases_usd)} USD millions`:'未报告 / 当前月份无观测'}`}</title></path>})}{arcs.map(r=><path key={r.record_id} data-sign={r.net_foreign_purchases_usd>0?'positive':'negative'} className={`tic-arc ${r.net_foreign_purchases_usd>0?'positive':'negative'}`} strokeWidth={.7+2.5*Math.sqrt(Math.abs(r.net_foreign_purchases_usd)/max)} d={path({type:'LineString',coordinates:[centers.get(byIso.get(r.foreign_economy_iso3)!.numeric)!,centers.get('840')!]})||''}><title>{`${r.foreign_economy_name} · ${flowDirection(r.net_foreign_purchases_usd)} · ${signedMillions(r.net_foreign_purchases_usd)} USD millions`}</title></path>)}</svg></div><div className="map-footer"><span><i className="legend observed-dot"/>正值：净买入 <i className="legend negative-dot"/>负值：净卖出 <i className="legend zero-dot"/>零净额 <i className="legend missing-dot"/>无观测</span><span>177 map geometries · Natural Earth</span></div></div>;
}
