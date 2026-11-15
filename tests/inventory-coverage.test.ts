import test from 'node:test';
import assert from 'node:assert/strict';
import {opportunities,evaluateAtPrice,planRow,timingFor} from '../src/lib/procurement-core';
import {coverageFor,coverageTotals} from '../src/lib/inventory-coverage';
function row(i=0,qty=40,price=9200){const o=opportunities[i],calc={price,...evaluateAtPrice(o,qty,price,.35)};return planRow(o,qty,calc,timingFor(o,'2026-11-13'))}
test('coverage exactly reconciles to the model for each quantity, including zero and saturated stock',()=>{for(const qty of [0,1,20,100,160]){const r=row(0,qty);const c=coverageFor(r);assert.ok(Math.abs(c.served-r.expectedSold)<1e-9);assert.ok(Math.abs(c.need-c.served-c.unmet)<1e-9);assert.ok(c.highUnmet>=0);assert.equal(c.incrementalCapacity,qty)}const r=row(0,10000);assert.equal(coverageFor(r).unmet,0)});
test('existing stock can fully satisfy central demand; no invented unmet units',()=>{const r={...row(),existingStock:100000};const c=coverageFor(r);assert.equal(c.need,0);assert.equal(c.unmet,0);assert.equal(c.served,0)});
test('unit types remain separate and total correctly',()=>{const a=row(0,10),b=row(3,5,19200);const h=coverageTotals([a,b],'Hotel'),f=coverageTotals([a,b],'Flight');assert.equal(h.products,1);assert.equal(f.products,1);assert.equal(h.incrementalCapacity,10);assert.equal(f.incrementalCapacity,5);assert.equal(coverageTotals([a],'Flight').products,0)});
test('zero demand and zero quantity remain finite',()=>{const r={...row(0,0),bookings:0,searches:0};const c=coverageFor(r);assert.equal(c.need,0);assert.equal(c.unmet,0);assert.equal(c.served,0)});
test('unallocated rows use reference price, not an arbitrary zero-quantity selling price',()=>{const a=row(0,0,5000),b={...a,price:15000};assert.equal(coverageFor(a).need,coverageFor(b).need);});
