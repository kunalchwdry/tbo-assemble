#!/usr/bin/env python3
"""Offline StatsForecast experiment on public monthly route traffic.
Run from repo root with the environment in scripts/requirements-statsforecast.txt.
The frozen output is a retrospective study, not an operational forecast.
"""
from __future__ import annotations
import hashlib
import json
import math
import pathlib
from statistics import mean
from typing import Callable
import numpy as np
import statsforecast
from statsforecast.models import AutoETS, SimpleExponentialSmoothingOptimized

DATA=pathlib.Path('data/statsforecast/route-traffic-snapshot.json')
OUT=pathlib.Path('public/research/statsforecast-study.json')
TRAINING_MONTHS=36
CANDIDATES=('last-observed','last-year','ses-optimized','seasonal-auto-ets')
SELECTION=[f'{y}-{m:02d}' for y in (2024,2025) for m in range(1,13)]
LATER=[f'2026-{m:02d}' for m in range(2,10)]

def shift_month(month:str,offset:int)->str:
    year,month_num=map(int,month.split('-')); total=year*12+month_num-1+offset
    return f'{total//12:04d}-{total%12+1:02d}'

def usable_map(rows:list[dict])->dict[str,float]:
    """Invalid/duplicate months are excluded rather than interpreted as zero."""
    counts:dict[str,int]={}
    for r in rows:
        m=r.get('month','')
        if isinstance(m,str): counts[m]=counts.get(m,0)+1
    result={}
    for r in rows:
        m=r.get('month');value=r.get('passengers');quality=r.get('quality')
        if (isinstance(m,str) and len(m)==7 and m[4]=='-' and m[:4].isdigit() and m[5:].isdigit()
            and 1<=int(m[5:])<=12 and counts[m]==1 and quality=='ok' and isinstance(value,(int,float))
            and not isinstance(value,bool) and math.isfinite(value) and value>=0):result[m]=float(value)
    return result

def history_for_target(data:dict[str,float],target:str)->tuple[list[float],list[str]]|None:
    """Exactly 36 months ending at t-2; causal last-year fill at most two gaps.
    No filling of the final (most recent) training month, and no target data use.
    """
    cutoff=shift_month(target,-2)
    if cutoff not in data:return None
    months=[shift_month(cutoff,k) for k in range(-TRAINING_MONTHS+1,1)]
    values=[];imputed=[]
    for m in months:
        v=data.get(m)
        if v is None:
            # Use only the raw observation from 12 months before this gap; never
            # an imputed value or a future observation. Missing != zero.
            v=data.get(shift_month(m,-12))
            if v is None:return None
            imputed.append(m)
        values.append(v)
    if len(imputed)>2:return None
    return values,imputed

def fit_stats(y:list[float])->dict[str,float]:
    """Actual StatsForecast models, fitted from scratch for each historical cutoff."""
    x=np.asarray(y,dtype=np.float64)
    models={'ses-optimized':SimpleExponentialSmoothingOptimized(), 'seasonal-auto-ets':AutoETS(season_length=12,model='ZZZ')}
    predictions={}
    for name,model in models.items():
        fitted=model.fit(x)
        value=float(fitted.predict(h=2)['mean'][1])
        if not math.isfinite(value):raise ValueError('Non-finite model prediction')
        predictions[name]=max(0.,value)
    return predictions

def replay_target(data:dict[str,float],target:str,fit:Callable=fit_stats,excluded:dict|None=None)->dict|None:
    def skip(reason:str):
        if excluded is not None:excluded[reason]=excluded.get(reason,0)+1
        return None
    actual=data.get(target);last=data.get(shift_month(target,-2));year=data.get(shift_month(target,-12));history=history_for_target(data,target)
    if actual is None:return skip('missing-or-invalid-target')
    if last is None or year is None:return skip('missing-baseline-input')
    if history is None:return skip('insufficient-training-history')
    try:predictions=fit(history[0])
    except Exception:return skip('model-fit-error')  # Exclude this target for every method.
    if set(predictions)!={'ses-optimized','seasonal-auto-ets'} or any(not math.isfinite(v) or v<0 for v in predictions.values()):return skip('invalid-model-output')
    return {'month':target,'actual':actual,'cutoff':shift_month(target,-2),'imputedMonths':history[1],
            'predictions':{'last-observed':last,'last-year':year,**predictions}}

def score(rows:list[dict])->dict[str,float]|None:
    if not rows:return None
    return {name:mean(abs(r['predictions'][name]-r['actual']) for r in rows) for name in CANDIDATES}

def choose(selection:list[dict])->str|None:
    """Choose only on the earlier period. Require 12 paired months and 5% improvement."""
    if len(selection)<12:return None
    errors=score(selection);assert errors is not None
    baseline=min(('last-observed','last-year'),key=lambda n:errors[n])
    candidate=min(('ses-optimized','seasonal-auto-ets'),key=lambda n:errors[n])
    return candidate if errors[candidate]<0.95*errors[baseline] else baseline

def study(route:dict,fit:Callable=fit_stats)->dict:
    data=usable_map(route['monthly'])
    excluded_selection={};excluded_later={}
    selection=[r for month in SELECTION if (r:=replay_target(data,month,fit,excluded_selection)) is not None]
    later=[r for month in LATER if (r:=replay_target(data,month,fit,excluded_later)) is not None]
    policy=choose(selection)
    comparison=score(later)
    if policy is None or comparison is None:outcome='unavailable'
    else:
        chosen=comparison[policy];best=min(comparison['last-observed'],comparison['last-year']);tol=max(1.,best)*1e-10
        outcome='outperformed' if chosen<best-tol else 'underperformed' if chosen>best+tol else 'matched'
    return {'origin':route['origin'],'destination':route['destination'],'retrievedAt':route['retrievedAt'],
            'sourceManifestSha256':route['sourceManifestSha256'],'rowsSha256':route['rowsSha256'],
            'latestUsableMonth':max(data) if data else None,'selection':{'count':len(selection),'excludedReasons':excluded_selection,'mae':score(selection),'rows':selection},
            'selectedPolicy':policy,'later':{'count':len(later),'excludedReasons':excluded_later,'mae':comparison,'resultVsBestBaseline':outcome,'rows':later}}

def main():
    raw=DATA.read_bytes();source=json.loads(raw);results=[]
    for route in source['routes']:
        canonical=json.dumps(route['monthly'],sort_keys=True,separators=(',',':'),ensure_ascii=False).encode('utf-8')
        if hashlib.sha256(canonical).hexdigest()!=route['rowsSha256']: raise ValueError('Route snapshot hash mismatch')
    for route in source['routes']:
        print(f"Testing {route['origin']}→{route['destination']} ...",flush=True)
        item=study(route);results.append(item)
        print('  selected',item['selectedPolicy'],'selection',item['selection']['count'],'later',item['later']['count'],'later outcome',item['later']['resultVsBestBaseline'],flush=True)
    output={'schema':'statsforecast-traffic-study-v1','statsforecastVersion':statsforecast.__version__,'numpyVersion':np.__version__,
            'snapshotSha256':hashlib.sha256(raw).hexdigest(),'trainingMonths':TRAINING_MONTHS,
            'selectionWindow':'2024-01 to 2025-12','laterWindow':'2026-02 to 2026-09',
            'horizonMonths':2,'replayAssumption':'t-2 data available; publication vintages and revisions are unverified',
            'methods':list(CANDIDATES),'routes':results}
    OUT.parent.mkdir(parents=True,exist_ok=True);OUT.write_text(json.dumps(output,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8');print('Wrote',OUT)
if __name__=='__main__':main()
