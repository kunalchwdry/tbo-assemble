/* eslint-disable @typescript-eslint/no-require-imports */
// Built-server compatibility check using only synthetic sample contracts.
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const base=process.env.BASE_URL||'http://127.0.0.1:3102';
for(const [file,expected] of [['Hotel_Contract_Sample.pdf','Grand Horizon Mumbai'],['hotel-contract.pdf','Grand Hyatt Resort & Spa Udaipur']]){
 test(`built API extracts ${file}`,async()=>{const data=new FormData();data.set('contract',new Blob([await fs.readFile('final-demo-docs/'+file)],{type:'application/pdf'}),file);const r=await fetch(base+'/api/ai/parse',{method:'POST',body:data});const body=await r.json();assert.equal(r.status,200,JSON.stringify(body));assert.equal(body.contract.venue,expected)});
}
