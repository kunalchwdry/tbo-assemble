import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {buildTraffic,ROUTES} from '../src/lib/india-market';
const csv=`Year,Month,City1,City2,PaxToCity2,PaxFromCity2
2025,11,DELHI,MUMBAI,100,110
2025,12,DELHI,MUMBAI,120,130
2025,12,MUMBAI,DELHI,5,6
2026,01,DELHI,MUMBAI (MUMBAI),200,210
2026,01,DELHI,MUMBAI (NAVI MUMBAI),50,60
2026,02,MUMBAI (MUMBAI),DELHI,220,230
2026,02,MUMBAI (NAVI MUMBAI),DELHI,70,80
2026,03,DELHI,MUMBAI,250,260
2026,03,DELHI,MUMBAI (MUMBAI),255,265
`;
test('exact renamed Mumbai airport maps both directions; Navi Mumbai never merges into BOM',()=>{
 const del=buildTraffic(csv,ROUTES.find(r=>r.origin==='DEL'&&r.destination==='BOM')!).monthly;
 const bom=buildTraffic(csv,ROUTES.find(r=>r.origin==='BOM'&&r.destination==='DEL')!).monthly;
 assert.deepEqual(del.map(x=>[x.month,x.passengers,x.quality]),[['2025-11',100,'ok'],['2025-12',null,'ambiguous'],['2026-01',200,'ok'],['2026-02',230,'ok'],['2026-03',null,'ambiguous']]);
 assert.deepEqual(bom.map(x=>[x.month,x.passengers,x.quality]),[['2025-11',110,'ok'],['2025-12',null,'ambiguous'],['2026-01',210,'ok'],['2026-02',220,'ok'],['2026-03',null,'ambiguous']]);
});
test('Navi Mumbai alone is not treated as existing Mumbai airport',()=>{
 const only='Year,Month,City1,City2,PaxToCity2,PaxFromCity2\n2026,01,DELHI,MUMBAI (NAVI MUMBAI),50,60\n';
 assert.deepEqual(buildTraffic(only,ROUTES[1]).monthly,[]);
});
