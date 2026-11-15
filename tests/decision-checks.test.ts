import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {opportunities} from '../src/lib/procurement-core';
import {optimizePortfolio} from '../src/lib/portfolio-optimizer';
import {decisionChecks} from '../src/lib/decision-checks';
const now='2026-11-13';
const rows=optimizePortfolio(opportunities,5000000,.35,{asOf:now}).rows;
const base={rows,source:'synthetic' as const,unappliedBudget:false,loading:false,asOf:now,today:now,handoffs:[]};
test('decision cues never treat a synthetic source, unknown quotes or unreviewed risk as ready',()=>{
 const checks=decisionChecks(base);assert.equal(checks.find(x=>x.id==='inputs')?.issue,true);assert.equal(checks.find(x=>x.id==='supplier')?.issue,true);assert.equal(checks.find(x=>x.id==='risk')?.issue,true);assert.match(checks.find(x=>x.id==='supplier')!.detail,/without session quote handoff/);
});
test('stale date, zero selected, pending budget or live signals are actionable',()=>{
 for(const patch of [{asOf:'2020-01-01'},{unappliedBudget:true},{loading:true},{rows:rows.map(r=>({...r,qty:0}))}]){
  assert.equal(decisionChecks({...base,...patch}).find(x=>x.id==='plan')?.issue,true);
 }
 assert.match(decisionChecks({...base,rows:rows.map(r=>({...r,qty:0}))}).find(x=>x.id==='supplier')!.detail,/No selected/);
});
