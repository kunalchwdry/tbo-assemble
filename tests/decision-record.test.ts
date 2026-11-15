import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {makeDecisionRecord} from '../src/lib/decision-record';
import {opportunities} from '../src/lib/procurement-core';
import {optimizePortfolio} from '../src/lib/portfolio-optimizer';
const asOf='2026-11-13',now=Date.parse('2026-11-13T12:00:00Z');
const base={items:opportunities,budget:1000000,risk:.35,asOf,source:'synthetic' as const,scenarios:{},marketOn:false,marketSamples:{},now};
test('review captures all original/effective inputs and the exact modeled allocation',()=>{
 const record=makeDecisionRecord(base);const expected=optimizePortfolio(opportunities,base.budget,base.risk,{asOf});
 assert.equal(record.modelVersion,'scenario-grid-v4');assert.equal(record.result.rows.length,opportunities.length);
 assert.deepEqual(record.result.rows.map(r=>[r.id,r.qty,r.price,r.spend,r.expectedProfit]),expected.rows.map(r=>[r.id,r.qty,r.price,r.spend,r.expectedProfit]));
 assert.ok(record.result.rows.reduce((s,r)=>s+r.spend,0)<=base.budget);assert.equal(record.settings.budgetInr,base.budget);
 assert.ok(record.warnings.some(w=>w.includes('not independently verified')));assert.match(record.purpose,/not an approval/);
 const parsed=JSON.parse(JSON.stringify(record));assert.equal(parsed.originalInventory.length,opportunities.length);assert.equal(parsed.result.rows.length,opportunities.length);
});
test('zero budget produces no purchase allocation',()=>{const r=makeDecisionRecord({...base,budget:0});assert.ok(r.result.rows.every(row=>row.qty===0));});
test('stale or unsupported attention data is not reported as used',()=>{const r=makeDecisionRecord({...base,marketOn:true,marketSamples:{Goa:{destination:'Goa',source:'not verified'}}});assert.deepEqual(r.attention.acceptedSamples,{});assert.equal(r.attention.details.Goa,null);});
test('rejects bad clock and invalid budget',()=>{assert.throws(()=>makeDecisionRecord({...base,now:NaN}),/capture time/);assert.throws(()=>makeDecisionRecord({...base,budget:-1}),/budget/);});
