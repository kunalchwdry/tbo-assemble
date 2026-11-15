import {test} from 'node:test';import assert from 'node:assert/strict';
import {evaluateArchive,freezePrediction,rowsHash,type ArchiveSnapshot,type ArchiveRow} from '../src/lib/traffic-research-archive';
import {shiftMonth} from '../src/lib/india-market';
const row=(month:string,passengers:number):ArchiveRow=>({month,passengers,quality:'ok'});
const prediction={targetMonth:'2026-11',current:110,currentMethod:'last-year',lastObserved:90,lastYear:120};
const snapshot=(capturedAt:string,rows:ArchiveRow[],forecast=prediction):ArchiveSnapshot=>({capturedAt,rows,forecast});
test('a frozen prediction needs fresh, complete source and genuinely future target',()=>{
 const rows=Array.from({length:70},(_,i)=>row(shiftMonth('2020-01',i),1000+i*11));
 assert.ok(freezePrediction(rows,'2025-11-03T12:00:00Z'));
 assert.equal(freezePrediction(rows,'2025-12-03T12:00:00Z'),null);
 const duplicate=[...rows,row('2025-10',9999)];assert.equal(freezePrediction(duplicate,'2025-11-03T12:00:00Z'),null);
 assert.equal(freezePrediction(rows,'invalid'),null);
});
test('first forecast per target is paired with first subsequent complete outcome, never later revisions',()=>{
 const initial=snapshot('2026-10-07T00:00:00Z',[]);
 const revision=snapshot('2026-12-02T00:00:00Z',[row('2026-11',100)],null as never);
 const newer=snapshot('2027-01-02T00:00:00Z',[row('2026-11',180)],null as never);
 const duplicate=snapshot('2026-10-15T00:00:00Z',[],{...prediction,current:1});
 const result=evaluateArchive([newer,duplicate,initial,revision]);assert.equal(result.count,1);assert.equal(result.pending,0);assert.deepEqual(result.mae,{current:10,lastObserved:10,lastYear:20});assert.equal(result.scores[0].actual,100);
});
test('a target already underway, ambiguous, duplicate or wrong month cannot be counted',()=>{
 const initial=snapshot('2026-10-01T00:00:00Z',[]);
 const sameMonth=snapshot('2026-11-29T00:00:00Z',[row('2026-11',100)],null as never);
 const conflict=snapshot('2026-12-01T00:00:00Z',[row('2026-11',100),row('2026-11',100)],null as never);
 const results=evaluateArchive([initial,sameMonth,conflict]);assert.equal(results.count,0);assert.equal(results.pending,1);
 assert.equal(evaluateArchive([{...initial,capturedAt:'2026-11-01T00:00:00Z'},conflict]).pending,0);
 assert.equal(evaluateArchive([{...initial,forecast:{...prediction,current:NaN}}]).pending,0);
});
test('row digest detects tampering including provenance',()=>{
 const a:ArchiveRow[]=[{...row('2026-09',100),provenance:{kind:'csv',url:'https://example.org',sha256:'a'}}];
 assert.equal(rowsHash(a),rowsHash(JSON.parse(JSON.stringify(a))));
 assert.notEqual(rowsHash(a),rowsHash([{...a[0],passengers:101}]));
 assert.notEqual(rowsHash(a),rowsHash([{...a[0],provenance:{...a[0].provenance!,sha256:'b'}}]));
});
