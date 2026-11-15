// Run against a built server: BASE_URL=http://localhost:3178 node --test tests/spreadsheet-api.integration.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFile}=require('node:fs/promises');
const base=process.env.BASE_URL||'http://localhost:3000';
for(const [ext,mime] of [['xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],['xls','application/vnd.ms-excel']]) {
 test(`built API accepts ${ext} contract uploads`,async()=>{
  const data=new FormData();data.set('contract',new Blob([await readFile(`tests/fixtures/synthetic-contract.${ext}`)],{type:mime}),`contract.${ext}`);
  const response=await fetch(`${base}/api/ai/parse`,{method:'POST',body:data});const body=await response.json();
  assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.mode,'parsed');assert.equal(body.contract.location,'Pune');
  assert.ok(body.contract.rooms.some(r=>r.roomType==='Deluxe'&&r.quantity===25&&r.rate===5000));
 });
}
test('built API rejects a truncated spreadsheet',async()=>{
 const data=new FormData();data.set('contract',new Blob([Buffer.from([0x50,0x4b,3,4,0,0,0,0])],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),'broken.xlsx');
 const response=await fetch(`${base}/api/ai/parse`,{method:'POST',body:data});assert.equal(response.status,422);
});
