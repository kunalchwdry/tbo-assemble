/** Compare the existing production policy against the experimental models on the
 * intersection of their eligible months. Run only after the Python experiment. */
import {readFileSync,writeFileSync} from 'node:fs';
import {studyTraffic} from '../src/lib/india-traffic-forecast';
import type {MonthlyTraffic} from '../src/lib/india-market';

type Prediction={month:string;actual:number;predictions:Record<string,number>};
type Route={origin:string;destination:string;monthly:MonthlyTraffic[]};
type ExperimentRoute={origin:string;destination:string;selection:{rows:Prediction[]};later:{rows:Prediction[]};[key:string]:unknown};
const path='public/research/statsforecast-study.json';
const snapshot=JSON.parse(readFileSync('data/statsforecast/route-traffic-snapshot.json','utf8')) as {routes:Route[]};
const output=JSON.parse(readFileSync(path,'utf8')) as {routes:ExperimentRoute[]};
const mae=(values:number[])=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
for(const route of output.routes){
 const raw=snapshot.routes.find(r=>r.origin===route.origin&&r.destination===route.destination);if(!raw)throw Error('Snapshot route missing');
 const existing=studyTraffic(raw.monthly,'2026-10');
 const selection=route.selection.rows.flatMap(row=>{const r=existing.replays.find(x=>x.month===row.month);return r&&r.actual===row.actual?[{...row,currentAdaptive:r.prediction}]:[]});
 const later=route.later.rows.flatMap(row=>{const r=existing.recent.rows.find(x=>x.month===row.month);return r&&r.actual===row.actual?[{...row,currentPolicy:r.policyPrediction}]:[]});
 const scores=(rows:(Prediction&{currentAdaptive?:number;currentPolicy?:number})[],current:'currentAdaptive'|'currentPolicy')=>{
   const names=['last-observed','last-year','ses-optimized','seasonal-auto-ets'];
   return Object.fromEntries([...names,current].map(name=>[name,mae(rows.map(r=>Math.abs((name===current?r[current]!:r.predictions[name])-r.actual)))]));
 };
 route.currentMethodComparison={note:'Intersection only; existing policy was selected on its own full 2024–25 sample, independently of this experiment.',existingPolicy:existing.recent.policy,selection:{count:selection.length,months:selection.map(r=>r.month),mae:scores(selection,'currentAdaptive')},later:{count:later.length,months:later.map(r=>r.month),mae:scores(later,'currentPolicy')}};
}
writeFileSync(path,JSON.stringify(output,null,2)+'\n');
