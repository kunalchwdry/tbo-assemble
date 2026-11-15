import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {applySupplierQuote} from '../src/lib/apply-supplier-quote';
import {readSupplierQuotes,quoteColumns} from '../src/lib/supplier-quotes';
import {opportunities} from '../src/lib/procurement-core';
import {optimizePortfolio} from '../src/lib/portfolio-optimizer';
import {validatePlanInput} from '../src/lib/private-plan';
const q=readSupplierQuotes(`${quoteColumns.join(',')}\nq1,goa,Supplier,room-night,4500.25,60,10,2026-11-01T12:00:00Z,2026-11-20T12:00:00Z,Unknown,Unknown`)[0];
const now=new Date('2026-11-13T10:00:00Z');
test('explicit transfer changes only supported row fields and honors budget',()=>{
 const updated=applySupplierQuote(opportunities,q,now),o=updated[0];assert.notEqual(updated,opportunities);assert.equal(opportunities[0].buy,6400);assert.equal(o.buy,4500.25);assert.equal(o.previousBuy,6400);assert.equal(o.capacity,60);assert.equal(o.minOrderUnits,10);assert.equal(o.quoteExpiry,'2026-11-19');assert.equal(o.fixedOrderFee,opportunities[0].fixedOrderFee);assert.equal(o.cancellations,opportunities[0].cancellations);assert.deepEqual(updated.slice(1),opportunities.slice(1));
 const result=optimizePortfolio([o],60000,.35,{asOf:'2026-11-13'});assert.ok(result.rows[0].spend<=60000);assert.ok(result.rows[0].qty===0||result.rows[0].qty>=10);assert.equal(optimizePortfolio([o],60000,.35,{asOf:'2026-11-20'}).rows[0].qty,0);
 const saved=validatePlanInput({items:updated,budget:60000,risk:.35,asOf:'2026-11-13',source:'synthetic'});assert.equal(saved.items[0].buy,4500.25);assert.equal(saved.items[0].minOrderUnits,10);assert.equal(saved.items[0].quoteExpiry,'2026-11-19');
});
test('capacity never increases; quote minimum cannot exceed current capacity',()=>{const capped=applySupplierQuote([{...opportunities[0],capacity:20}],q,now);assert.equal(capped[0].capacity,20);assert.throws(()=>applySupplierQuote([{...opportunities[0],capacity:9}],q,now),/minimum exceeds/)});
test('expired, future, mismatched, same-day, malformed or incompatible quotes fail closed',()=>{
 for(const quote of [{...q,inventoryId:'missing'},{...q,unit:'seat' as const},{...q,observedAt:'2026-11-15T12:00:00Z'},{...q,expiresAt:'2026-11-12T12:00:00Z'},{...q,unitPrice:.5},{...q,availableUnits:9},{...q,expiresAt:'2026-02-30T00:00:00Z'},{...q,expiresAt:'2026-11-13T23:59:59Z'}])assert.throws(()=>applySupplierQuote(opportunities,quote,now));
 assert.throws(()=>applySupplierQuote(opportunities,q,new Date('2026-11-20T00:00:00Z')),/expires today UTC/);
 assert.throws(()=>applySupplierQuote(opportunities,q,new Date('2026-11-20T12:00:00Z')),/not currently eligible/);
});
