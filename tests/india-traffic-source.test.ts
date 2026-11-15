import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import * as XLSX from 'xlsx';
import {discoverWorkbookLinks,parseOfficialWorkbook} from '../src/lib/india-traffic-source';
import {ROUTES} from '../src/lib/india-market';
import {studyTraffic} from '../src/lib/india-traffic-forecast';
const prefix='jsp/dgca/InventoryList/dataReports/aviationDataStatistics/airTransport/domestic/monthly/';
const row=(month:string,path:string)=>`<tr><td>${month}</td><td><a data-url="${path}">Excel</a></td></tr>`;
function workbook(duplicate=false,unqualified=false){
 const rows:unknown[][]=[['City Name Pair wise Passenger, Freight & Mail Traffic Statistics For September 2026 (Provisional)'],['Passengers'],['S.No.','CITY 1','CITY 2','PASSENGERS \nTO CITY 2','PASSENGERS \nFROM CITY 2'],[1,'Delhi',unqualified?'Mumbai':'Mumbai (Mumbai)',253634,246253],[2,'Delhi','Mumbai (Navi Mumbai)',20481,20033],[3,'Delhi','Pune',107712,106901],[4,'Bengaluru','Delhi',196410,193923],[5,'Delhi','Jaipur',111,112],[6,'Delhi','Kolkata',113,114],[7,'Pune','Jaipur',115,116]];
 if(duplicate)rows.push([8,'Mumbai (Mumbai)','Delhi',246253,253634]);
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'Traffic');return XLSX.write(book,{type:'buffer',bookType:'xlsx'}) as Buffer;
}
test('index skips commented future entries and rejects duplicates and untrusted paths',()=>{
 const html=row('SEPTEMBER',`${prefix}September 2026.xlsx`)+`<!-- ${row('OCTOBER',`${prefix}October 2026.xlsx`)} -->`;
 assert.deepEqual(discoverWorkbookLinks(html,2026).map(x=>x.month),['2026-09']);
 assert.throws(()=>discoverWorkbookLinks(html+row('SEPTEMBER',`${prefix}other.xlsx`),2026),/Duplicate/);
 assert.throws(()=>discoverWorkbookLinks(row('SEPTEMBER','https://evil.invalid/a.xlsx'),2026),/Unexpected/);
});
test('official workbook directions and exact airport labels are preserved',async()=>{
 const w=workbook();for(const [idx,n] of [[0,246253],[1,253634],[2,107712],[3,106901],[4,196410],[5,193923]] as const){const result=await parseOfficialWorkbook(w,'2026-09',ROUTES[idx]);assert.equal(result?.passengers,n);assert.equal(result?.quality,'ok')}
 assert.equal(await parseOfficialWorkbook(workbook(false,true),'2026-09',ROUTES[1]),null);
 assert.equal((await parseOfficialWorkbook(workbook(true),'2026-09',ROUTES[1]))?.quality,'ambiguous');
 await assert.rejects(parseOfficialWorkbook(w,'2026-08',ROUTES[1]),/month mismatch/);
});
test('September data remains stale in November',()=>{assert.equal(studyTraffic([{month:'2026-09',passengers:100,quality:'ok'}],'2026-11').status,'stale')});
