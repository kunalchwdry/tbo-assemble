import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {opportunities} from '../src/lib/procurement-core';
import {optimizePortfolio} from '../src/lib/portfolio-optimizer';
import {decisionBrief} from '../src/lib/decision-brief';
const asOf='2026-11-13',rows=optimizePortfolio(opportunities,1000000,.35,{asOf}).rows;
test('brief ranks only selected opportunities by modeled risk-adjusted score and keeps unlike units separate',()=>{const b=decisionBrief(rows,asOf,asOf,'synthetic',false),selected=rows.filter(r=>r.qty>0);assert.equal(b.top?.objective,Math.max(...selected.map(r=>r.objective)));assert.equal(b.hotelUnits,selected.filter(r=>r.kind==='Hotel').reduce((a,r)=>a+r.qty,0));assert.equal(b.flightUnits,selected.filter(r=>r.kind==='Flight').reduce((a,r)=>a+r.qty,0));assert.equal(b.selectedCount,selected.length)});
test('date and quote warnings describe selected rows without claiming quote validity',()=>{const synthetic=[{...rows[0],qty:1,quoteExpiry:undefined},{...rows[1],qty:1,quoteExpiry:'2026-11-13'},{...rows[2],qty:0,quoteExpiry:undefined}];const b=decisionBrief(synthetic,'2026-11-12',asOf,'uploaded',true);assert.equal(b.missingExpiry,1);assert.equal(b.expiryDue,1);assert.equal(b.reviewDateIsCurrent,false);assert.equal(b.unappliedBudget,true);assert.equal(b.source,'uploaded')});
test('zero budget yields no lead opportunity and zero separate units',()=>{const empty=optimizePortfolio(opportunities,0,.35,{asOf}).rows,b=decisionBrief(empty,asOf,asOf,'synthetic',false);assert.equal(b.top,null);assert.equal(b.selectedCount,0);assert.equal(b.hotelUnits,0);assert.equal(b.flightUnits,0)});
