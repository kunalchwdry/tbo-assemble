import {NextRequest,NextResponse} from 'next/server';
import {ROUTES} from '@/lib/india-market';
export const dynamic='force-dynamic';
const SUMMARY='https://raw.githubusercontent.com/kunalchwdry/tbo-assemble/traffic-research-history/summary.json';
const RUNS='https://api.github.com/repos/kunalchwdry/tbo-assemble/actions/workflows/traffic-forward-research.yml/runs?per_page=1';
const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
const get=async(url:string)=>fetch(url,{headers:{Accept:'application/vnd.github+json','User-Agent':'tbo-route-research-monitor'},cache:'no-store',signal:AbortSignal.timeout(8000)});
export async function GET(req:NextRequest){
 const origin=req.nextUrl.searchParams.get('origin'),destination=req.nextUrl.searchParams.get('destination');
 if(!ROUTES.some(r=>r.origin===origin&&r.destination===destination))return reply({error:'Choose a supported route'},400);
 const key=`${origin}-${destination}`;
 try{
  const [summaryResult,runsResult]=await Promise.allSettled([get(SUMMARY),get(RUNS)]);
  let job:{status:string;conclusion:string|null;startedAt:string}|null=null;
  if(runsResult.status==='fulfilled'&&runsResult.value.ok){
   const header=Number(runsResult.value.headers.get('content-length'));if(header<1000000){const body=await runsResult.value.json();const r=body.workflow_runs?.[0];if(r&&typeof r.status==='string'&&typeof r.created_at==='string')job={status:r.status,conclusion:typeof r.conclusion==='string'?r.conclusion:null,startedAt:r.created_at}}
  }
  if(summaryResult.status!=='fulfilled'||!summaryResult.value.ok)return reply({state:'unavailable',job});
  const raw=await summaryResult.value.text();if(raw.length>1_000_000)throw Error('oversized');const all=JSON.parse(raw);const route=all.routes?.[key];
  if(all.schema!=='statsforecast-forward-v1'||!route||!Number.isInteger(route.captureCount)||route.captureCount<0||route.captureCount>104||!route.comparison||!Number.isInteger(route.comparison.count)||route.comparison.count<0||route.comparison.count>104||!Number.isInteger(route.comparison.pending)||route.comparison.pending<0||route.comparison.pending>104)throw Error('invalid summary');
  const last=route.lastCapture;
  if(last&&(!Number.isFinite(Date.parse(last.recordedAt))||typeof last.forecastStatus!=='string'||typeof last.rowsSha256!=='string'||!/^[0-9a-f]{64}$/.test(last.rowsSha256)))throw Error('invalid last capture');
  const m=route.comparison.mae;const keys=['last-observed','last-year','ses-optimized','seasonal-auto-ets','selectedPolicy'];
  if(!m||keys.some(k=>m[k]!==null&&(typeof m[k]!=='number'||!Number.isFinite(m[k])||m[k]<0))||keys.some(k=>route.comparison.count===0?m[k]!==null:m[k]===null))throw Error('invalid scores');
  const status=all.lastRun?.statuses?.[key];
  return reply({state:'available',job,modelVersion:typeof all.statsforecastVersion==='string'?all.statsforecastVersion:null,lastRun:all.lastRun&&typeof all.lastRun.startedAt==='string'&&typeof status==='string'?{startedAt:all.lastRun.startedAt,status}:null,route:{captureCount:route.captureCount,lastCapture:last?{recordedAt:last.recordedAt,latestUsableMonth:typeof last.latestUsableMonth==='string'?last.latestUsableMonth:null,forecastStatus:last.forecastStatus,rowsSha256:last.rowsSha256}:null,comparison:{count:route.comparison.count,pending:route.comparison.pending,mae:m}}});
 }catch{return reply({state:'unavailable',job:null})}
}
