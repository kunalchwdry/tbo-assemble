#!/usr/bin/env python3
"""Scheduled, non-operational forward experiment. State is public route aggregates only.

Runs after checkout of a dedicated archive branch; no account data or credentials
are written. Never generates an estimate when the source is stale. Not proof of
chronology: clocks and Git branch contents are not independently certified.
"""
from __future__ import annotations
import argparse
import datetime as dt
import hashlib
import json
import math
import pathlib
import re
import urllib.parse
import urllib.request
from statistics import mean
from typing import Callable
from statsforecast_traffic import CANDIDATES, fit_stats, history_for_target, shift_month, usable_map
import statsforecast

ROUTES=(('BOM','DEL'),('DEL','BOM'),('DEL','PNQ'),('PNQ','DEL'),('BLR','DEL'),('DEL','BLR'))
URL='https://tbo-assemble.vercel.app/api/india-market/traffic'
STUDY=pathlib.Path('public/research/statsforecast-study.json')
SCHEMA='statsforecast-forward-v1'
LIMIT=104

def iso(now:dt.datetime)->str:
    if now.tzinfo is None: raise ValueError('Time must be timezone-aware')
    return now.astimezone(dt.timezone.utc).isoformat(timespec='seconds').replace('+00:00','Z')

def parse_time(value:str)->dt.datetime:
    value=dt.datetime.fromisoformat(value.replace('Z','+00:00'))
    if value.tzinfo is None:raise ValueError('Time must include timezone')
    return value.astimezone(dt.timezone.utc)

def retrieve(origin:str,destination:str)->dict:
    query=urllib.parse.urlencode({'origin':origin,'destination':destination})
    request=urllib.request.Request(URL+'?'+query,headers={'Accept':'application/json','User-Agent':'tbo-route-forecast-research/1.0'})
    with urllib.request.urlopen(request,timeout=35) as r:
        if r.status!=200:raise ValueError('source-unavailable')
        content=r.read(1_000_001)
    if len(content)>1_000_000:raise ValueError('source-too-large')
    return json.loads(content)

def normalize_source(source:dict,origin:str,destination:str,now:dt.datetime):
    if not isinstance(source,dict) or source.get('route',{}).get('origin')!=origin or source.get('route',{}).get('destination')!=destination:raise ValueError('wrong-route')
    rows=source.get('monthly');manifest=source.get('sourceSha256');retrieved=source.get('retrievedAt');sources=source.get('sources')
    if not isinstance(rows,list) or not (1<=len(rows)<=250) or not isinstance(manifest,str) or not re.fullmatch(r'[0-9a-f]{64}',manifest) or not isinstance(retrieved,str) or not isinstance(sources,list) or not 1<=len(sources)<=13:raise ValueError('invalid-source')
    clean_sources=[]
    for src in sources:
        if not isinstance(src,dict):raise ValueError('invalid-manifest')
        kind,url,digest,month=src.get('kind'),src.get('url'),src.get('sha256'),src.get('month')
        if not isinstance(url,str) or not isinstance(digest,str) or not re.fullmatch(r'[0-9a-f]{64}',digest):raise ValueError('invalid-manifest')
        if kind=='historical-csv':
            if url!='https://raw.githubusercontent.com/Vonter/india-aviation-traffic/main/aggregated/domestic/city.csv' or month is not None:raise ValueError('invalid-manifest')
        elif kind=='dgca-workbook':
            if not url.startswith('https://public-prd-dgca.s3.ap-south-1.amazonaws.com/InventoryList/dataReports/aviationDataStatistics/airTransport/domestic/monthly/') or not url.endswith('.xlsx') or not isinstance(month,str) or not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])',month):raise ValueError('invalid-manifest')
        else:raise ValueError('invalid-manifest')
        clean_sources.append({'kind':kind,'url':url,'sha256':digest,**({'month':month} if month is not None else {})})
    if len({s['url'] for s in clean_sources})!=len(clean_sources):raise ValueError('duplicate-source')
    tuples=[[s['kind'],s['url'],s.get('month',''),s['sha256']] for s in sorted(clean_sources,key=lambda s:s['url'])]
    if hashlib.sha256(json.dumps(tuples,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()!=manifest:raise ValueError('manifest-hash-mismatch')
    seen=parse_time(retrieved);seconds=(now-seen).total_seconds()
    if seconds < -300 or seconds > 36*3600:raise ValueError('source-clock-or-cache')
    # Raw rows, including invalid and ambiguous months, stay visible to usable_map.
    clean=[]
    for r in rows:
        if not isinstance(r,dict):raise ValueError('invalid-row')
        month=r.get('month');quality=r.get('quality');value=r.get('passengers')
        if not isinstance(month,str) or not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])',month) or month>=iso(now)[:7] or quality not in ('ok','ambiguous','invalid'):raise ValueError('invalid-or-current-month')
        if value is not None and (isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or value<0):raise ValueError('invalid-passenger-value')
        clean.append({'month':month,'quality':quality,'passengers':value})
    rows_digest=hashlib.sha256(json.dumps(clean,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
    return clean,manifest,retrieved,rows_digest,clean_sources

def forecast_future(rows:list[dict],now:dt.datetime,selected:str|None,fit:Callable=fit_stats):
    current=iso(now)[:7];data=usable_map(rows)
    if not data or max(data)!=shift_month(current,-1):return None,'stale-or-missing'
    target=shift_month(current,1)
    if target in data: return None,'target-already-observed'
    target_start=dt.datetime.strptime(target+'-01','%Y-%m-%d').replace(tzinfo=dt.timezone.utc)
    if (target_start-now).total_seconds()<=86400:return None,'too-close-to-target'
    history=history_for_target(data,target);last=data.get(shift_month(target,-2));year=data.get(shift_month(target,-12))
    if history is None or last is None or year is None:return None,'insufficient-history'
    if selected not in CANDIDATES:return None,'no-frozen-policy'
    try:predictions=fit(history[0])
    except Exception:return None,'fit-failed'
    if set(predictions)!={'ses-optimized','seasonal-auto-ets'} or any(not isinstance(v,(int,float)) or isinstance(v,bool) or not math.isfinite(v) or v<0 for v in predictions.values()):return None,'invalid-model-output'
    return {'targetMonth':target,'cutoff':shift_month(target,-2),'selectedPolicy':selected,'imputedMonths':history[1],
            'predictions':{'last-observed':last,'last-year':year,**predictions}},'recorded'

def evaluate(captures:list[dict]):
    ordered=sorted(captures,key=lambda c:c['recordedAt']);seen=set();scores=[];pending=0
    for capture in ordered:
        f=capture.get('forecast')
        if not f:continue
        target=f['targetMonth'];stamp=capture['recordedAt'];values=f['predictions']
        if stamp[:7]>=target or target in seen:continue
        seen.add(target);later=next((c for c in ordered if c['recordedAt']>stamp and c['recordedAt'][:7]>target and target in c['actuals']),None)
        if later is None:pending+=1;continue
        actual=later['actuals'][target];scores.append({'targetMonth':target,'recordedAt':stamp,'actualAt':later['recordedAt'],'actual':actual,
               'errors':{name:abs(values[name]-actual) for name in CANDIDATES},'selectedPolicy':f['selectedPolicy']})
    mae={name:(mean(r['errors'][name] for r in scores) if scores else None) for name in CANDIDATES}
    mae['selectedPolicy']=mean(r['errors'][r['selectedPolicy']] for r in scores) if scores else None
    return {'count':len(scores),'pending':pending,'mae':mae,'scores':scores}

def validate_state(state:dict):
    if state.get('schema')!=SCHEMA or not isinstance(state.get('routes'),dict):raise ValueError('invalid-existing-state')
    if set(state['routes'])-{f'{o}-{d}' for o,d in ROUTES}:raise ValueError('unknown-archived-route')
    for key,entries in state['routes'].items():
        if not isinstance(entries,list) or len(entries)>LIMIT:raise ValueError('invalid-existing-state')
        weeks=set();origin,destination=key.split('-')
        for entry in entries:
            if not isinstance(entry,dict) or entry.get('week') in weeks:raise ValueError('duplicate-archived-week')
            weeks.add(entry.get('week'));recorded=parse_time(entry['recordedAt']);year,week,_=recorded.isocalendar()
            if entry.get('week')!=f'{year}-W{week:02d}':raise ValueError('invalid-archived-week')
            envelope={'route':{'origin':origin,'destination':destination},'monthly':entry['rows'],'sources':entry['sources'],'sourceSha256':entry['sourceManifestSha256'],'retrievedAt':entry['sourceRetrievedAt']}
            clean,_,_,digest,_=normalize_source(envelope,origin,destination,recorded)
            if digest!=entry['rowsSha256']:raise ValueError('archived-rows-hash-mismatch')
            data=usable_map(clean);recent=sorted(data)[-24:]
            if entry['actuals']!={m:data[m] for m in recent} or entry['latestUsableMonth']!=(max(data) if data else None):raise ValueError('archived-actuals-mismatch')
            f=entry.get('forecast')
            if f:
                target=f.get('targetMonth');values=f.get('predictions')
                if not isinstance(target,str) or not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])',target) or target<=iso(recorded)[:7] or f.get('cutoff')!=shift_month(target,-2) or f.get('selectedPolicy') not in CANDIDATES or not isinstance(values,dict) or set(values)!=set(CANDIDATES):raise ValueError('invalid-archived-forecast')
                if any(isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) or v<0 for v in values.values()):raise ValueError('invalid-archived-output')
                if data.get(shift_month(target,-2))!=values['last-observed'] or data.get(shift_month(target,-12))!=values['last-year']:raise ValueError('archived-baseline-mismatch')

def advance(state:dict,now:dt.datetime,load:Callable=retrieve,fit:Callable=fit_stats,study:dict|None=None,clock:Callable|None=None):
    validate_state(state)
    selection=study or json.loads(STUDY.read_text())
    selection_hash=hashlib.sha256(json.dumps(selection,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
    policies={(r['origin'],r['destination']):r['selectedPolicy'] for r in selection['routes']}
    this_week=now.isocalendar();week=f'{this_week.year}-W{this_week.week:02d}';statuses={}
    for origin,destination in ROUTES:
        key=f'{origin}-{destination}';entries=state['routes'].setdefault(key,[])
        if not isinstance(entries,list) or len(entries)>LIMIT:raise ValueError('invalid-existing-state')
        if any(x['week']==week for x in entries):statuses[key]='already-captured';continue
        if len(entries)>=LIMIT:statuses[key]='archive-full';continue
        try:
            rows,manifest,retrieved,digest,sources=normalize_source(load(origin,destination),origin,destination,now)
            completed=clock() if clock else dt.datetime.now(dt.timezone.utc)
            if completed<now or completed.isocalendar()[:2]!=now.isocalendar()[:2] or iso(completed)[:7]!=iso(now)[:7]:raise ValueError('clock-or-period-changed')
            forecast,reason=forecast_future(rows,completed,policies.get((origin,destination)),fit)
            recorded=clock() if clock else dt.datetime.now(dt.timezone.utc)
            if recorded<completed or iso(recorded)[:7]!=iso(completed)[:7] or recorded.isocalendar()[:2]!=now.isocalendar()[:2]:raise ValueError('clock-or-period-changed')
            if forecast and (dt.datetime.strptime(forecast['targetMonth']+'-01','%Y-%m-%d').replace(tzinfo=dt.timezone.utc)-recorded).total_seconds()<=86400:raise ValueError('too-close-to-target')
            valid=usable_map(rows);recent=sorted(valid)[-24:]
            entries.append({'week':week,'recordedAt':iso(recorded),'sourceRetrievedAt':retrieved,'sourceManifestSha256':manifest,'rowsSha256':digest,'sources':sources,
                            'latestUsableMonth':max(valid) if valid else None,'statsforecastVersion':statsforecast.__version__,'selectionSha256':selection_hash,'rows':rows,'actuals':{m:valid[m] for m in recent},'forecast':forecast,'forecastStatus':reason})
            statuses[key]=reason
        except Exception as exc:
            # Do not store raw exception text, credentials or private information.
            print(f'{key}: capture failed ({type(exc).__name__})',flush=True);statuses[key]='source-error'
    state['lastRun']={'startedAt':iso(now),'statuses':statuses}
    return state

def summarize(state:dict):
    routes={}
    for origin,destination in ROUTES:
        key=f'{origin}-{destination}';captures=state['routes'].get(key,[]);last=captures[-1] if captures else None
        routes[key]={'captureCount':len(captures),'lastCapture':{k:last[k] for k in ('recordedAt','sourceRetrievedAt','sourceManifestSha256','rowsSha256','latestUsableMonth','forecastStatus')} if last else None,'comparison':evaluate(captures)}
    return {'schema':SCHEMA,'statsforecastVersion':statsforecast.__version__,'lastRun':state.get('lastRun'),'routes':routes,'capacity':LIMIT}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--state-dir',required=True,type=pathlib.Path);args=parser.parse_args();state_file=args.state_dir/'state.json'
    if state_file.exists():
        if state_file.stat().st_size>15_000_000:raise ValueError('existing state exceeds size limit')
        state=json.loads(state_file.read_text())
    else:state={'schema':SCHEMA,'routes':{}}
    now=dt.datetime.now(dt.timezone.utc);state=advance(state,now)
    args.state_dir.mkdir(parents=True,exist_ok=True)
    encoded=json.dumps(state,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n'
    if len(encoded.encode())>15_000_000:raise ValueError('updated state exceeds size limit')
    state_file.write_text(encoded)
    (args.state_dir/'summary.json').write_text(json.dumps(summarize(state),indent=2,sort_keys=True,allow_nan=False)+'\n')
    print(json.dumps(state['lastRun'],sort_keys=True))
if __name__=='__main__':main()
