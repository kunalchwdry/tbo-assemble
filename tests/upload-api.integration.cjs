/* eslint-disable @typescript-eslint/no-require-imports */
// Run against a built local server using BASE_URL. No production data is modified.
const {test}=require('node:test');const assert=require('node:assert/strict');const {readFile}=require('node:fs/promises');const http=require('node:http');
const base=process.env.BASE_URL||'http://127.0.0.1:3000';
const mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
async function post(data,headers={}){return fetch(base+'/api/ai/parse',{method:'POST',body:data,headers})}
test('a valid spreadsheet works with same-origin browser request',async()=>{const form=new FormData();form.set('contract',new Blob([await readFile('tests/fixtures/synthetic-contract.xlsx')],{type:mime}),'contract.xlsx');const r=await post(form,{origin:new URL(base).origin});assert.equal(r.status,200,await r.text());});
test('rejects files over 2 MiB and accepts no duplicate or text fields',async()=>{
 let form=new FormData();form.set('contract',new Blob([new Uint8Array(2*1024*1024+1)],{type:mime}),'large.xlsx');assert.equal((await post(form)).status,413);
 form=new FormData();form.set('contract','not a file');assert.equal((await post(form)).status,400);
 form=new FormData();form.append('contract',new Blob(['x'],{type:mime}),'a.xlsx');form.append('contract',new Blob(['x'],{type:mime}),'b.xlsx');assert.equal((await post(form)).status,400);
 form=new FormData();form.set('other','x');assert.equal((await post(form)).status,400);
});
test('rejects oversized chunked request without content-length',async()=>{
 const u=new URL(base+'/api/ai/parse');if(u.protocol!=='http:')return; // local-only oversized test
 const status=await new Promise((resolve,reject)=>{const req=http.request(u,{method:'POST',headers:{'content-type':'multipart/form-data; boundary=security-test'}},res=>{res.resume();resolve(res.statusCode)});req.on('error',reject);req.write('--security-test\r\nContent-Disposition: form-data; name="contract"; filename="large.xlsx"\r\nContent-Type: '+mime+'\r\n\r\n');for(let i=0;i<5;i++)req.write(Buffer.alloc(900_000));req.end('\r\n--security-test--\r\n')});assert.equal(status,413);
});
test('malformed multipart is rejected and demo remains available',async()=>{
 const r=await fetch(base+'/api/ai/parse',{method:'POST',headers:{'content-type':'multipart/form-data; boundary=bad'},body:'bad'});assert.equal(r.status,400);
 const demo=await fetch(base+'/api/ai/parse?demo=true',{method:'POST'});assert.equal(demo.status,200);assert.equal((await demo.json()).mode,'demo');
});
