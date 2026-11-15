// Server-only source loading. DGCA's monthly city-pair workbooks supplement the
// historical ODbL CSV. No synthetic months or airport merges are introduced.
import {createHash} from 'node:crypto';
import {buildTraffic,DGCA_URL,parseCsv,type MonthlyTraffic,type Route} from './india-market';

type Source={kind:'historical-csv'|'dgca-workbook';url:string;sha256:string;month?:string};
export type SourcedMonth=MonthlyTraffic & {provenance:Source};
const portal='https://www.dgca.gov.in/digigov-portal/scan?';
const dgcaPrefix='jsp/dgca/InventoryList/dataReports/aviationDataStatistics/airTransport/domestic/monthly/';
const months=['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
// DGCA's index has returned inconsistent historical variants. Keep known official
// links as a floor until the historical CSV itself reaches those months.
const verifiedBaseline=['AUGUST','SEPTEMBER'].map((name,i)=>({month:`2026-0${i+8}`,url:`https://public-prd-dgca.s3.ap-south-1.amazonaws.com/InventoryList/dataReports/aviationDataStatistics/airTransport/domestic/monthly/DOM%20CITYPAIR%20DATA%2C%20${name}%202026.xlsx`}));
export function addVerifiedBaseline(links:{month:string;url:string}[],lastGlobal:string){
 const map=new Map(links.map(x=>[x.month,x]));
 for(const item of verifiedBaseline.filter(x=>x.month>lastGlobal)){const existing=map.get(item.month);if(existing&&existing.url!==item.url)throw Error('DGCA index conflicts with verified workbook link');map.set(item.month,item)}
 return [...map.values()].sort((a,b)=>a.month.localeCompare(b.month));
}
const sha=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
// Hash ordered scalar tuples, so JSONB object-key reordering cannot change the digest.
export function manifestHash(sources:Source[]){return sha(JSON.stringify([...sources].sort((a,b)=>a.url.localeCompare(b.url)).map(s=>[s.kind,s.url,s.month??'',s.sha256])))}
async function fetchBytes(url:string,limit:number){
 const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Source unavailable');
 const size=Number(response.headers.get('content-length'));if(size>limit)throw Error('Source too large');
 const data=Buffer.from(await response.arrayBuffer());if(data.length<100||data.length>limit)throw Error('Unexpected source size');return data;
}
async function index(contentId:string,serviceName:string){
 const body=new URLSearchParams({baseLocale:'',screenId:'10000001',classification:'',actionVal:'viewStaticData',requestType:'ApplicationRH',attachId:'',langType:'2',ruleBookId:'259',attr:'',contentId,serviceName});
 const r=await fetch(portal,{method:'POST',body,cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('DGCA index unavailable');
 const raw=await r.text();if(raw.length>1_000_000)throw Error('DGCA index too large');return JSON.parse(raw);
}
function findYear(content:string,year:number){const m=content.match(new RegExp(`data-url="monthlyStatistics/259/(\\d+)/html"[^>]*>[^<]*${year}\\s*<`,'i'));return m?.[1]??null}
function findCityIndex(content:string){for(const row of content.match(/<tr[\s\S]*?<\/tr>/gi)??[])if(/Domestic City Pair Traffic/i.test(row)){const m=row.match(/data-url="yearly\/259\/(\d+)\/html"/i);if(m)return m[1]}return null}
export function discoverWorkbookLinks(content:string,year:number){
 const out:{month:string;url:string}[]=[];
 for(const row of content.replace(/<!--[\s\S]*?-->/g,'').match(/<tr[\s\S]*?<\/tr>/gi)??[]){
  const cell=row.match(/<td[^>]*>\s*(?:<[^>]+>\s*)*([A-Z]+)\s*</i);const n=months.indexOf((cell?.[1]??'').toUpperCase());if(n<0)continue;
  const paths=[...row.matchAll(/data-url="([^"]+)"/gi)].map(x=>x[1]).filter(x=>x.toLowerCase().endsWith('.xlsx'));
  if(paths.length!==1||!paths[0].startsWith(dgcaPrefix)||paths[0].includes('..')||/[?#]/.test(paths[0]))throw Error('Unexpected DGCA workbook link');
  const url='https://public-prd-dgca.s3.ap-south-1.amazonaws.com/'+paths[0].slice('jsp/dgca/'.length).split('/').map(encodeURIComponent).join('/');
  out.push({month:`${year}-${String(n+1).padStart(2,'0')}`,url});
 }
 if(new Set(out.map(x=>x.month)).size!==out.length)throw Error('Duplicate DGCA months');return out;
}
export async function parseOfficialWorkbook(bytes:Buffer,month:string,route:Route):Promise<MonthlyTraffic|null>{
 const XLSX=await import('xlsx');const wb=XLSX.read(bytes,{type:'buffer',sheetRows:2001});
 if(wb.SheetNames.length!==1)throw Error('Unexpected DGCA workbook sheets');const ws=wb.Sheets[wb.SheetNames[0]];
 const rows=XLSX.utils.sheet_to_json<unknown[]>(ws,{header:1,defval:'',raw:true});if(rows.length<10||rows.length>2000)throw Error('Unexpected DGCA workbook rows');
 const [year,mon]=month.split('-').map(Number),title=String(rows[0]?.[0]??'');if(!new RegExp(`${months[mon-1]}\\s+${year}`,'i').test(title)||!/city.*pair/i.test(title))throw Error('DGCA workbook month mismatch');
 const header=rows.findIndex(r=>r.some(v=>String(v).trim().toUpperCase()==='CITY 1')&&r.some(v=>String(v).trim().toUpperCase()==='CITY 2'));
 if(header<0)throw Error('DGCA workbook header missing');
 const norm=(x:unknown)=>String(x).replace(/\s+/g,' ').trim().toUpperCase();const h=rows[header].map(norm);
 const ids=['CITY 1','CITY 2','PASSENGERS TO CITY 2','PASSENGERS FROM CITY 2'].map(x=>h.indexOf(x));if(ids.some(i=>i<0))throw Error('Unexpected DGCA passenger columns');
 const quote=(x:unknown)=>`"${String(x).replace(/"/g,'""')}"`;
 const csv=['Year,Month,City1,City2,PaxToCity2,PaxFromCity2',...rows.slice(header+1).filter(r=>r[ids[0]]&&r[ids[1]]).map(r=>[year,mon,...ids.map((i,j)=>j<2&&norm(r[i])==='MUMBAI'?'MUMBAI (UNSPECIFIED)':r[i])].map(quote).join(','))].join('\n');
 return buildTraffic(csv,route).monthly[0]??null;
}
export async function loadIndiaTraffic(route:Route,now=new Date()){
 const historical=await fetchBytes(DGCA_URL,10_000_000),text=historical.toString('utf8');const base=buildTraffic(text,route);
 const parsed=parseCsv(text),yearCol=parsed[0].indexOf('Year'),monthCol=parsed[0].indexOf('Month');
 const lastGlobal=parsed.slice(1).map(r=>{const y=Number(r[yearCol]),m=Number(r[monthCol]);return Number.isInteger(y)&&y>=2015&&y<=2100&&Number.isInteger(m)&&m>=1&&m<=12?`${y}-${String(m).padStart(2,'0')}`:''}).sort().at(-1);
 if(!lastGlobal||!base.monthly.length)throw Error('Historical source incomplete');
 if(lastGlobal>=now.toISOString().slice(0,7))throw Error('Historical source contains a current or future month');
 const hSource:Source={kind:'historical-csv',url:DGCA_URL,sha256:sha(historical)};
 const parent=await index('4184','getParentData');const main=parent.ruleBookContentDtlsList?.[0]?.contentText;if(typeof main!=='string')throw Error('DGCA year index missing');
 const year=now.getUTCFullYear(),historicalYear=Number(lastGlobal.slice(0,4));if(year-historicalYear>1)throw Error('Historical source is too far behind for automatic supplementation');
 const years=[year-1,year].filter(y=>y>=historicalYear);const links:{month:string;url:string}[]=[];
 for(const y of years){const yid=findYear(main,y);if(!yid){if(y===historicalYear)throw Error('DGCA year index missing');continue}const yr=await index(yid,'fetchRulebookContentDtlsList');const cid=findCityIndex(yr.contentText??'');if(!cid)throw Error('DGCA city-pair index missing');const city=await index(cid,'fetchRulebookContentDtlsList');links.push(...discoverWorkbookLinks(city.contentText??'',y).filter(x=>x.month>lastGlobal));}
 const completeLinks=addVerifiedBaseline(links,lastGlobal);
 if(completeLinks.length>12)throw Error('Too many unprocessed DGCA months');
 if(completeLinks.some(x=>x.month>=now.toISOString().slice(0,7)))throw Error('DGCA index contains a current or future month');
 const official=await Promise.all(completeLinks.map(async link=>{const bytes=await fetchBytes(link.url,2_000_000);const row=await parseOfficialWorkbook(bytes,link.month,route);return {row,source:{kind:'dgca-workbook' as const,url:link.url,month:link.month,sha256:sha(bytes)}}}));
 // Only sources contributing rows are in the manifest; it is recoverable from saved row provenance.
 const sources=[hSource,...official.filter(x=>x.row!==null).map(x=>x.source)].sort((a,b)=>a.url.localeCompare(b.url));
 const monthly:SourcedMonth[]=[...base.monthly.map(r=>({...r,provenance:hSource})),...official.flatMap(x=>x.row?[{...x.row,provenance:x.source}]:[])].sort((a,b)=>a.month.localeCompare(b.month));
 return {monthly,sourceRowCount:base.sourceRowCount,sources,sourceSha256:manifestHash(sources),retrievedAt:now.toISOString()};
}
