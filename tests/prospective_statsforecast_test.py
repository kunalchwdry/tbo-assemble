import datetime as dt
import hashlib
import json
import sys
import unittest
from copy import deepcopy
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from prospective_statsforecast import SCHEMA,ROUTES,advance,evaluate,forecast_future,normalize_source,shift_month,fit_stats,validate_state

def at(s):return dt.datetime.fromisoformat(s.replace('Z','+00:00'))
def rows(last):
    start='2020-01';items=[];m=start
    while m<=last:
        i=len(items);items.append({'month':m,'passengers':10000+i*20+(i%12)*50,'quality':'ok'});m=shift_month(m,1)
    return items
def source(o,d,last,now):
    s={'kind':'historical-csv','url':'https://raw.githubusercontent.com/Vonter/india-aviation-traffic/main/aggregated/domestic/city.csv','sha256':'a'*64}
    manifest=hashlib.sha256(json.dumps([[s['kind'],s['url'],'',s['sha256']]],separators=(',',':')).encode()).hexdigest()
    return {'route':{'origin':o,'destination':d},'monthly':rows(last),'sourceSha256':manifest,'sources':[s],'retrievedAt':now.isoformat()}
def selection():return {'routes':[{'origin':o,'destination':d,'selectedPolicy':'ses-optimized'} for o,d in ROUTES]}
def fake(y):return {'ses-optimized':y[-1], 'seasonal-auto-ets':y[-12]}
class Tests(unittest.TestCase):
 def test_actual_models_fit_future_without_using_target(self):
    now=at('2026-11-15T10:00:00Z');r=rows('2026-10');p,status=forecast_future(r,now,'ses-optimized',fit_stats)
    self.assertEqual(status,'recorded');self.assertEqual(p['targetMonth'],'2026-12');self.assertEqual(p['cutoff'],'2026-10');self.assertEqual(len(p['predictions']),4)
    self.assertEqual(forecast_future(rows('2026-09'),now,'ses-optimized',fake)[1],'stale-or-missing')
    self.assertEqual(forecast_future(r,at('2026-11-30T12:00:00Z'),'ses-optimized',fake)[1],'too-close-to-target')
 def test_missing_duplicate_or_model_fail_are_not_silently_scored(self):
    now=at('2026-11-15T10:00:00Z');r=rows('2026-10');r.append(dict(r[-1]));self.assertEqual(forecast_future(r,now,'last-year',fake)[1],'stale-or-missing')
    fail=lambda _: (_ for _ in ()).throw(RuntimeError('failed'))
    self.assertEqual(forecast_future(rows('2026-10'),now,'ses-optimized',fail)[1],'fit-failed')
    s=source('DEL','PNQ','2026-10',now);s['monthly'].append({'month':'2026-12','passengers':999999,'quality':'ok'})
    with self.assertRaises(ValueError):normalize_source(s,'DEL','PNQ',now)
    s=source('DEL','PNQ','2026-10',now);s['retrievedAt']='2026-11-17T00:00:00Z'
    with self.assertRaises(ValueError):normalize_source(s,'DEL','PNQ',now)
 def test_freeze_once_then_score_first_later_snapshot_on_common_targets(self):
    now=at('2026-11-15T10:00:00Z');state={'schema':SCHEMA,'routes':{}}
    run=lambda state,clock,last:advance(state,clock,load=lambda o,d:source(o,d,last,clock),fit=fake,study=selection(),clock=lambda:clock)
    run(state,now,'2026-10');first=deepcopy(state['routes']['DEL-PNQ'][0]);self.assertEqual(first['forecast']['targetMonth'],'2026-12')
    run(state,now,'2026-10');self.assertEqual(len(state['routes']['DEL-PNQ']),1)
    later=at('2027-01-10T10:00:00Z');run(state,later,'2026-12');res=evaluate(state['routes']['DEL-PNQ'])
    self.assertEqual(res['count'],1);self.assertEqual(res['scores'][0]['targetMonth'],'2026-12');self.assertEqual(state['routes']['DEL-PNQ'][0],first)
    self.assertEqual(set(res['mae']),{'last-observed','last-year','ses-optimized','seasonal-auto-ets','selectedPolicy'})
    bad=deepcopy(state['routes']['DEL-PNQ']);bad[1]['recordedAt']='2026-12-30T00:00:00Z';self.assertEqual(evaluate(bad)['count'],0)
 def test_past_snapshot_tampering_blocks_all_future_updates(self):
    now=at('2026-11-15T10:00:00Z');state={'schema':SCHEMA,'routes':{}}
    advance(state,now,load=lambda o,d:source(o,d,'2026-10',now),fit=fake,study=selection(),clock=lambda:now)
    validate_state(state);altered=deepcopy(state);altered['routes']['DEL-PNQ'][0]['rows'][0]['passengers']+=1
    with self.assertRaises(ValueError):validate_state(altered)
    altered=deepcopy(state);altered['routes']['DEL-PNQ'][0]['forecast']['predictions']['last-year']+=1
    with self.assertRaises(ValueError):validate_state(altered)
 def test_clock_rollover_and_source_failure_do_not_record(self):
    now=at('2026-11-30T23:59:00Z');state={'schema':SCHEMA,'routes':{}}
    advance(state,now,load=lambda o,d:source(o,d,'2026-10',now),fit=fake,study=selection(),clock=lambda:at('2026-12-01T00:01:00Z'))
    self.assertEqual(len(state['routes']['DEL-PNQ']),0)
    self.assertEqual(state['lastRun']['statuses']['DEL-PNQ'],'source-error')
if __name__=='__main__':unittest.main()
