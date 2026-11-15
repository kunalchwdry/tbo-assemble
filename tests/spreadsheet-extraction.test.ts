import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {extractTextFromExcel,parseContractLocally} from '../src/lib/local-parser';

// Synthetic fixtures were produced with the old parser before upgrading, so
// they exercise actual legacy XLS as well as XLSX and preserve known output.
for (const [extension,mime] of [['xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],['xls','application/vnd.ms-excel']] as const) {
 test(`synthetic ${extension} sheets preserve contract text, Unicode and room table`,async()=>{
  const file=readFileSync(`tests/fixtures/synthetic-contract.${extension}`);
  const text=await extractTextFromExcel(file);
  assert.match(text,/=== Sheet: Contract ===/);assert.match(text,/Hotel Name: Test Grand Hotel/);assert.match(text,/Location: Pune/);assert.match(text,/Café Conference/);
  assert.match(text,/=== Sheet: Rooms ===/);assert.match(text,/Room Type \| Quantity \| Rate INR/);assert.match(text,/Deluxe\s*\|\s*25\s*\|\s*5000/);assert.match(text,/Suite\s*\|\s*5\s*\|\s*12000/);
  const result=await parseContractLocally(file,mime);assert.equal(result.success,true);assert.equal(result.data?.location,'Pune');assert.deepEqual(result.data?.rooms.map(r=>({roomType:r.roomType,rate:r.rate,quantity:r.quantity})),[{roomType:'Deluxe',rate:5000,quantity:25},{roomType:'Suite',rate:12000,quantity:5}]);
 });
}
test('a truncated spreadsheet archive is rejected rather than processed as a workbook',async()=>{
 const original=console.error;console.error=()=>{};
 try {await assert.rejects(extractTextFromExcel(Buffer.from([0x50,0x4b,3,4,0,0,0,0])),/Failed to parse Excel file/);}finally{console.error=original;}
});
