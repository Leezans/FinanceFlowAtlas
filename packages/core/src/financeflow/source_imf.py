"""One explicit IMF PIP adapter. Never interprets positions as transactions."""
import csv, hashlib, io, re, json, math
from collections import Counter
from datetime import datetime,timezone
from .contracts import Metadata, Position, Source, Snapshot
from .registry import countries
SOURCE_ID='imf-pip-equity'
INDICATOR='P_F51_P_USD'
ADAPTER_VERSION='imf-pip-equity-v0.2.1'
def source_url(period):
    if not re.fullmatch(r'\d{4}-S[12]',period):raise ValueError('Expected YYYY-S1 or YYYY-S2')
    return 'https://api.imf.org/external/sdmx/2.1/data/IMF.STA,PIP,5.0.0/.A.'+INDICATOR+'.S1.S1..S?startPeriod='+period+'&endPeriod='+period+'&format=csvfile'
def normalize(raw:bytes, period:str, retrieved_at:str, unit_verified:bool=False):
    if not unit_verified: raise ValueError('Unit semantics are not verified; monetary normalization blocked')
    valid={c.iso3 for c in countries()}; seen=set(); records=[]; excluded=Counter(); examples={}; publication=set()
    def mark(reason,r):
        excluded[reason]+=1
        sample=examples.setdefault(reason,[])
        if len(sample)<3:sample.append({k:r.get(k) for k in ['COUNTRY','COUNTERPART_COUNTRY','TIME_PERIOD','OBS_VALUE','STATUS']})
    for r in csv.DictReader(io.StringIO(raw.decode('utf-8-sig'))):
        if r.get('INDICATOR')!=INDICATOR or r.get('ACCOUNTING_ENTRY')!='A' or r.get('SECTOR')!='S1' or r.get('COUNTERPART_SECTOR')!='S1' or r.get('FREQUENCY')!='S' or r.get('TIME_PERIOD')!=period:
            mark('outside_contract',r);continue
        a,b=r.get('COUNTRY'),r.get('COUNTERPART_COUNTRY')
        if a not in valid or b not in valid: mark('aggregate_or_non_iso_geography',r);continue
        if a==b: mark('domestic',r);continue
        if r.get('UNIT')!='USD':raise ValueError('Unexpected unit')
        # IMF OBS_VALUE is retained exactly in USD; SCALE is metadata, never blindly multiplied.
        if r.get('SCALE') != '6':raise ValueError('Unexpected SCALE requires source review')
        status=r.get('OBS_STATUS') or r.get('STATUS') or ''
        if status not in ('','A'):mark('flagged_observation',r);continue
        if not r.get('OBS_VALUE','').strip():mark('missing_value',r);continue
        key=(a,b,period)
        if key in seen:raise ValueError('Duplicate bilateral observation')
        seen.add(key)
        value=float(r['OBS_VALUE'])
        if not math.isfinite(value):raise ValueError('Non-finite source position')
        if value < 0:
            mark('negative_position_not_supported',r);continue
        records.append(Position(record_id=hashlib.sha256('|'.join(key).encode()).hexdigest()[:24],reporter_iso3=a,counterpart_iso3=b,value_usd=value,period=period,source_id=SOURCE_ID))
        if r.get('PUBLICATION_DATE'):publication.add(r['PUBLICATION_DATE'])
    if not records:raise ValueError('No valid equity position records')
    digest=hashlib.sha256(raw).hexdigest(); now=datetime.now(timezone.utc).isoformat()
    reporters={r.reporter_iso3 for r in records};counterparts={r.counterpart_iso3 for r in records}
    version=hashlib.sha256(json.dumps({'raw':digest,'period':period,'adapter':ADAPTER_VERSION,'registry':'pycountry-24.6.1','unit_verified':unit_verified},sort_keys=True).encode()).hexdigest()[:20]
    return Snapshot(metadata=Metadata(version=version,as_of=now,period=period,coverage_note=f'{len(reporters)} reporting economies; {len(counterparts)} counterpart economies with observations. Global ISO registry is not complete data coverage. Holdings, not fund flows. Negative source positions are excluded with counts, not clamped to zero.',unit_verified=True,raw_sha256=digest,excluded_records=dict(excluded),excluded_examples=examples,adapter_version=ADAPTER_VERSION),sources=[Source(id=SOURCE_ID,name='IMF Portfolio Investment Positions — Equity',url=source_url(period),published_at=max(publication) if publication else None,retrieved_at=retrieved_at,status='available',frequency='semiannual',license_note='IMF source terms apply; source code license does not license provider data')],countries=countries(reporters,counterparts),positions=records)
