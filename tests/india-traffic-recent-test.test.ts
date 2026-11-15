import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {shiftMonth,type MonthlyTraffic} from '../src/lib/india-market';
import {studyTraffic,recentComparison} from '../src/lib/india-traffic-forecast';
function series():MonthlyTraffic[]{const rows:MonthlyTraffic[]=[];let month='2021-01';for(let i=0;i<70;i++,month=shiftMonth(month,1)){const f=[1,1.1,1.2,1.3,1.4,1.5,1.6,1.5,1.4,1.3,1.2,1.1][i%12];rows.push({month,passengers:Math.round((120+i*3)*f),quality:'ok'});}return rows;}
test('later 2026 test uses frozen earlier policy and common target months',()=>{
 const data=series(),result=studyTraffic(data,'2026-11'),r=result.recent;
 assert.equal(r.policy,'adaptive');assert.deepEqual(r.rows.map(x=>x.month),['2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08','2026-09']);
 const avg=(f:(x:typeof r.rows[number])=>number)=>r.rows.reduce((sum,x)=>sum+Math.abs(f(x)-x.actual),0)/r.rows.length;
 assert.equal(r.policyMae,avg(x=>x.policyPrediction));assert.equal(r.lastObservedMae,avg(x=>x.lastObserved));assert.equal(r.lastYearMae,avg(x=>x.lastYear));
 const changed=data.map(x=>x.month>='2026-06'?{...x,passengers:(x.passengers??0)+50000}:x);
 const modified=studyTraffic(changed,'2026-11');
 assert.equal(modified.recent.policy,r.policy);
 const before=r.rows.find(x=>x.month==='2026-07')!,after=modified.recent.rows.find(x=>x.month==='2026-07')!;
 assert.equal(before.policyPrediction,after.policyPrediction);assert.equal(before.lastObserved,after.lastObserved);assert.equal(before.lastYear,after.lastYear);assert.notEqual(before.actual,after.actual);
});
test('no later results are invented and duplicate observations are excluded',()=>{
 const data=series(),early=studyTraffic(data,'2026-03');assert.deepEqual(early.recent.rows.map(r=>r.month),['2026-02']);
 const july=data.find(r=>r.month==='2026-07')!,duplicated=studyTraffic([...data,july],'2026-11');assert.equal(duplicated.recent.rows.length,6);assert.ok(!duplicated.recent.rows.some(r=>r.month==='2026-07'));assert.ok(!duplicated.recent.rows.some(r=>r.month==='2026-09'),'September needs the ambiguous July lagged baseline');
 const before=studyTraffic(data,'2025-01');assert.equal(before.recent.rows.length,0);assert.equal(before.recent.policyMae,null);
});
test('baseline policy stays frozen despite later shocks',()=>{
 const flat=series().map(x=>({...x,passengers:100}));const result=studyTraffic(flat,'2026-11');assert.equal(result.recent.policy,'last-observed');assert.equal(result.recent.policyMae,0);
 const shocks=flat.map(x=>x.month>='2026-02'?{...x,passengers:999}:x);assert.equal(studyTraffic(shocks,'2026-11').recent.policy,'last-observed');
});

test('later comparison reports wins, ties, losses and missing results without changing policy',()=>{
 const recent=studyTraffic(series(),'2026-11').recent;
 assert.equal(recentComparison({...recent,policyMae:9,lastObservedMae:10,lastYearMae:11}),'outperformed');
 assert.equal(recentComparison({...recent,policyMae:10,lastObservedMae:10,lastYearMae:11}),'matched');
 assert.equal(recentComparison({...recent,policyMae:12,lastObservedMae:10,lastYearMae:11}),'underperformed');
 assert.equal(recentComparison({...recent,rows:[],policyMae:null}),'unavailable');
});
