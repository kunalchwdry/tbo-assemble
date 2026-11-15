import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {evaluateDemandBacktest,readDemandBacktestCSV,syntheticDemandBacktestCSV} from '../src/lib/demand-backtest';
const rows=()=>readDemandBacktestCSV(syntheticDemandBacktestCSV());
test('strictly past labels fit a training-only blend and compare locked chronological holdout',()=>{
 const all=rows(),result=evaluateDemandBacktest(all,'2025-02-01');
 assert.equal(result.testCount,12);assert.ok(result.trainCount>=20);assert.ok(result.trainLatestOutcome<result.testStart);assert.ok(result.purged>=1);
 assert.equal(result.weight,.2);assert.ok(result.fittedMae<result.baselineMae);assert.ok(result.fittedMae<result.currentMae);
 const changed=all.map((r,i)=>i>=36?{...r,actualNetUnits:r.actualNetUnits+300}:r);const modified=evaluateDemandBacktest(changed,'2025-02-01');
 assert.equal(modified.weight,result.weight,'holdout targets must not tune model');assert.ok(modified.fittedMae>result.fittedMae);
});
test('unknown outcomes are excluded, with no false zero-denominator metric',()=>{
 const all=rows(),limited=evaluateDemandBacktest(all,'2024-10-01');assert.ok(limited.excludedFuture>0);assert.ok(limited.trainLatestOutcome<limited.testStart);
 const zero=evaluateDemandBacktest(all.map(r=>({...r,actualNetUnits:0})),'2025-02-01');assert.equal(zero.baselineWape,null);assert.equal(zero.currentWape,null);assert.equal(zero.fittedWape,null);
});
test('rejects overlapping periods, unequal leads, inconsistent product and malformed numeric data',()=>{
 const csv=syntheticDemandBacktestCSV(),lines=csv.split('\n');
 assert.throws(()=>readDemandBacktestCSV([lines[0],lines[1],lines[1]].join('\n')),/overlap or repeat/);
 assert.throws(()=>readDemandBacktestCSV(lines.map((x,i)=>i===2?x.replace('synthetic-hotel','different'):x).join('\n')),/one opportunity_id/);
 assert.throws(()=>readDemandBacktestCSV(lines.map((x,i)=>i===2?x.replace('2024-01-13','2024-01-12'):x).join('\n')),/same snapshot lead time/);
 assert.throws(()=>readDemandBacktestCSV(lines.map((x,i)=>i===1?x.replace(',0.05,',',NaN,'):x).join('\n')),/conversion/);
 assert.throws(()=>evaluateDemandBacktest(rows(),'2024-03-01'),/At least/);
});
test('rolling replay fits only labels available before each snapshot and is immune to future outcomes',()=>{
 const all=rows(),initial=evaluateDemandBacktest(all,'2025-02-01');assert.ok(initial.sample.every(x=>x.rollingLatestOutcome<x.asOf&&x.rollingTrainingCount>=20));
 const target=initial.sample[4];const changed=all.map(r=>r.asOf>=target.asOf?{...r,actualNetUnits:r.actualNetUnits+500}:r);const replay=evaluateDemandBacktest(changed,'2025-02-01');
 for(let i=0;i<=4;i++){assert.equal(initial.sample[i].rollingWeight,replay.sample[i].rollingWeight);assert.equal(initial.sample[i].rolling,replay.sample[i].rolling)}
 assert.equal(initial.weight,replay.weight);assert.ok(initial.rollingMae<initial.rollingBaselineMae);assert.equal(initial.underpredicted+initial.overpredicted<=initial.testCount,true);
});
test('a later-reported label cannot enter rolling training before its availability date',()=>{
 const all=rows(),initial=evaluateDemandBacktest(all,'2025-02-01');const delayed=all.map(r=>r.asOf===initial.sample[0].asOf?{...r,outcomeAvailableOn:'2025-01-25'}:r);const result=evaluateDemandBacktest(delayed,'2025-02-01');
 const before=result.sample.filter(r=>r.asOf<='2025-01-25');assert.ok(before.every(r=>r.rollingLatestOutcome<r.asOf));assert.ok(result.sample.length===initial.sample.length);
});
test('reconstructed latest available outcome baseline never uses unavailable or future labels',()=>{
 const all=rows(),initial=evaluateDemandBacktest(all,'2025-02-01');
 for(const sample of initial.sample){
  const past=all.filter(r=>r.asOf<sample.asOf&&r.outcomeAvailableOn<sample.asOf).sort((a,b)=>b.periodEnd.localeCompare(a.periodEnd));
  assert.ok(sample.observedBaselineAvailableOn<sample.asOf);
  assert.equal(sample.observedBaseline,past[0].actualNetUnits);assert.equal(sample.observedBaselinePeriodEnd,past[0].periodEnd);
 }
 const target=initial.sample[4];const changed=all.map(r=>r.asOf>=target.asOf?{...r,actualNetUnits:r.actualNetUnits+999}:r);const replay=evaluateDemandBacktest(changed,'2025-02-01');
 for(let i=0;i<=4;i++)assert.equal(initial.sample[i].observedBaseline,replay.sample[i].observedBaseline);
 const supplied=all.map(r=>({...r,priorNetUnits:0}));const suppliedResult=evaluateDemandBacktest(supplied,'2025-02-01');assert.equal(suppliedResult.observedBaselineMae,initial.observedBaselineMae,'separate field cannot alter reconstructed baseline');
});
test('late reported outcomes are skipped in the reconstructed baseline',()=>{
 const all=rows(),initial=evaluateDemandBacktest(all,'2025-02-01'),target=initial.sample[4];
 const delayed=all.map(r=>r.periodEnd===target.observedBaselinePeriodEnd?{...r,outcomeAvailableOn:target.asOf}:r);
 const changed=evaluateDemandBacktest(delayed,'2025-02-01').sample.find(x=>x.asOf===target.asOf)!;
 assert.notEqual(changed.observedBaselinePeriodEnd,target.observedBaselinePeriodEnd);assert.ok(changed.observedBaselineAvailableOn<changed.asOf);
});
