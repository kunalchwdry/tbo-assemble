import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {addVerifiedBaseline,manifestHash} from '../src/lib/india-traffic-source';

test('verified official floor prevents inconsistent DGCA index from silently losing months',()=>{
 const links=addVerifiedBaseline([],'2026-07');assert.deepEqual(links.map(x=>x.month),['2026-08','2026-09']);
 assert.equal(addVerifiedBaseline(links,'2026-07').length,2);
 assert.throws(()=>addVerifiedBaseline([{month:'2026-09',url:'https://different.invalid/file.xlsx'}],'2026-07'),/conflicts/);
 assert.equal(addVerifiedBaseline([],'2026-09').length,0);
});
test('manifest hash is stable through PostgreSQL JSONB key reordering',()=>{
 const a={kind:'dgca-workbook' as const,url:'https://example.test/file.xlsx',month:'2026-09',sha256:'a'.repeat(64)};
 const b={sha256:a.sha256,month:a.month,url:a.url,kind:a.kind};assert.equal(manifestHash([a]),manifestHash([b]));
});
