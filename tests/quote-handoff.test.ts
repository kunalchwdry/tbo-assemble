import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {opportunities} from '../src/lib/procurement-core';
import {applySupplierQuote} from '../src/lib/apply-supplier-quote';
import {createQuoteHandoff,inspectQuoteHandoffs} from '../src/lib/quote-handoff';
import {makeDecisionRecord} from '../src/lib/decision-record';
import type {SupplierQuote} from '../src/lib/supplier-quotes';

const now=new Date('2026-11-13T12:00:00Z');
const item=opportunities[0];
const quote:SupplierQuote={quoteId:'synthetic-1',inventoryId:item.id,supplier:'Synthetic supplier',unit:item.kind==='Hotel'?'room-night':'seat',unitPrice:4000,availableUnits:20,minimumUnits:1,observedAt:'2026-11-13T10:00:00Z',expiresAt:'2026-11-17T10:00:00Z',cancellationTerms:'Example only',taxesFees:'Excluded',travelPeriod:item.period};
const items=applySupplierQuote(opportunities,quote,now,200);
const handoff=createQuoteHandoff(quote,200,items.find(i=>i.id===item.id)!,now);

test('applied quote produces a truthful, expiring session handoff',()=>{
 const [before]=inspectQuoteHandoffs([handoff],items,now.getTime());assert.equal(before.fieldsMatch,true);assert.equal(before.validity,'within-supplied-dates');assert.equal(before.transferred.buy,4200);assert.equal(before.quote.cancellationTerms,'Example only');
 assert.equal(inspectQuoteHandoffs([handoff],items,Date.parse(quote.expiresAt))[0].validity,'expired');
 assert.equal(inspectQuoteHandoffs([handoff],items,now.getTime()-3*3600000)[0].validity,'not-yet-observed');
 assert.equal(inspectQuoteHandoffs([handoff],items,now.getTime()-1000)[0].validity,'clock-before-application');
 const changed=items.map(i=>i.id===item.id?{...i,buy:4250}:i);assert.equal(inspectQuoteHandoffs([handoff],changed,now.getTime())[0].fieldsMatch,false);
 assert.equal(inspectQuoteHandoffs([handoff],items.filter(i=>i.id!==item.id),now.getTime())[0].fieldsMatch,false);
 assert.throws(()=>createQuoteHandoff(quote,200,opportunities.find(i=>i.id!==item.id)!,now),/Invalid/);
});

test('decision review includes explicit handoff, terms and changed field warning without claiming purchase',()=>{
 const record=makeDecisionRecord({items,budget:5000000,risk:.35,asOf:'2026-11-13',source:'synthetic',scenarios:{},marketOn:false,marketSamples:{},now:now.getTime(),quoteHandoffs:[handoff]});
 assert.equal(record.recordVersion,2);assert.equal(record.quoteHandoffs[0].quote.quoteId,'synthetic-1');assert.equal(record.quoteHandoffs[0].fieldsMatch,true);assert.match(record.quoteHandoffs[0].notice,/not verified/);assert.match(record.purpose,/not an approval/);assert.equal(record.readinessChecks.find(c=>c.id==='risk')?.issue,true);assert.equal(record.readinessChecks.find(c=>c.id==='inputs')?.issue,true);
 const changed=items.map(i=>i.id===item.id?{...i,capacity:i.capacity-1}:i);
 const altered=makeDecisionRecord({items:changed,budget:5000000,risk:.35,asOf:'2026-11-13',source:'synthetic',scenarios:{},marketOn:false,marketSamples:{},now:now.getTime(),quoteHandoffs:[handoff]});assert.equal(altered.quoteHandoffs[0].fieldsMatch,false);
});
