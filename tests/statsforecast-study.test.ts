import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import study from '../public/research/statsforecast-study.json';
import snapshot from '../data/statsforecast/route-traffic-snapshot.json';
import {studyTraffic} from '../src/lib/india-traffic-forecast';
import type {MonthlyTraffic} from '../src/lib/india-market';

test('frozen research artifact matches snapshot and scores current policy on identical later months',()=>{
 const bytes=readFileSync('data/statsforecast/route-traffic-snapshot.json');
 assert.equal(createHash('sha256').update(bytes).digest('hex'),study.snapshotSha256);
 assert.equal(study.routes.length,6);
 for(const route of study.routes){
  const source=snapshot.routes.find(r=>r.origin===route.origin&&r.destination===route.destination);assert.ok(source);
  const existing=studyTraffic(source.monthly as MonthlyTraffic[],'2026-10');
  const paired=route.currentMethodComparison;
  assert.equal(paired.existingPolicy,existing.recent.policy);
  const rows=route.later.rows.filter(r=>paired.later.months.includes(r.month));
  assert.equal(rows.length,paired.later.count);assert.equal(paired.later.count,paired.later.months.length);
  assert.equal(paired.later.mae.currentPolicy,rows.reduce((sum,row)=>{
   const current=existing.recent.rows.find(r=>r.month===row.month);assert.ok(current);assert.equal(current.actual,row.actual);
   return sum+Math.abs(current.policyPrediction-row.actual);
  },0)/rows.length);
  for(const method of study.methods){
   const mae=rows.reduce((sum,row)=>sum+Math.abs(row.predictions[method as keyof typeof row.predictions]-row.actual),0)/rows.length;
   assert.ok(Math.abs(mae-paired.later.mae[method as keyof typeof paired.later.mae]!)<1e-7);
  }
  for(const row of [...route.selection.rows,...route.later.rows]){
   assert.ok(row.cutoff<row.month);assert.ok(row.imputedMonths.every(m=>m<row.cutoff));
  }
 }
});
