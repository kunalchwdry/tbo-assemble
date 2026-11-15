import {timingSafeEqual} from 'node:crypto';
import {NextRequest,NextResponse} from 'next/server';
import {ROUTES} from '@/lib/india-market';
import {loadIndiaTraffic} from '@/lib/india-traffic-source';
import {freezePrediction,rowsHash} from '@/lib/traffic-research-archive';
export const dynamic='force-dynamic';export const maxDuration=300;
const response=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
function authorized(header:string|null,secret:string|undefined){if(!secret||!header)return false;const a=Buffer.from(header),b=Buffer.from(`Bearer ${secret}`);return a.length===b.length&&timingSafeEqual(a,b)}
export async function GET(req:NextRequest){
 if(!authorized(req.headers.get('authorization'),process.env.CRON_SECRET))return response({error:'Unauthorized'},401);
 if(!process.env.DATABASE_URL)return response({error:'Database is not configured'},503);
 try{
  const {default:db}=await import('@/lib/db');const appNow=new Date();
  const clock=await db.$queryRaw<Array<{skew:number}>>`SELECT abs(extract(epoch from (now()-${appNow}::timestamptz)))::float8 AS skew`;
  if(!clock[0]||clock[0].skew>300)return response({error:'Server and database clocks disagree; capture paused'},409);
  // At most one active attempt per week; retries after failure and stale runs are allowed.
  const claim=await db.$queryRaw<Array<{week_utc:Date}>>`INSERT INTO public.traffic_research_runs (week_utc,status) VALUES ((date_trunc('week',now() AT TIME ZONE 'UTC'))::date,'running') ON CONFLICT (week_utc) DO UPDATE SET status='running',started_at=now(),finished_at=NULL,saved=0,skipped=0,failed=0 WHERE traffic_research_runs.status IN ('partial','failed') OR (traffic_research_runs.status='running' AND traffic_research_runs.started_at<now()-interval '10 minutes') RETURNING week_utc`;
  if(!claim.length)return response({status:'already-complete-or-running'});
  let saved=0,skipped=0,failed=0;
  for(const route of ROUTES){
   try{
    const existing=await db.$queryRaw<Array<{this_week:boolean;total:number}>>`SELECT COALESCE(bool_or(week_utc=(date_trunc('week',now() AT TIME ZONE 'UTC'))::date),false) AS this_week,count(*)::int AS total FROM public.traffic_research_snapshots WHERE origin=${route.origin} AND destination=${route.destination}`;
    if(existing[0].this_week||existing[0].total>=104){skipped++;continue}
    const captured=new Date(),source=await loadIndiaTraffic(route,captured);const finished=new Date();
    if(!source.monthly.length||source.monthly.some(r=>r.month>=finished.toISOString().slice(0,7)))throw Error('Current or future source month');
    const prediction=freezePrediction(source.monthly,finished.toISOString());const hash=rowsHash(source.monthly);
    const added=await db.$transaction(async tx=>{
     await tx.$queryRaw`SELECT 1::int AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${route.origin+'-'+route.destination},1))) AS acquired`;
     const check=await tx.$queryRaw<Array<{total:number;skew:number}>>`SELECT (SELECT count(*)::int FROM public.traffic_research_snapshots WHERE origin=${route.origin} AND destination=${route.destination}) AS total, abs(extract(epoch from (now()-${finished}::timestamptz)))::float8 AS skew`;
     if(check[0].skew>300)throw Error('clock');if(check[0].total>=104)return [];
     return tx.$queryRaw<Array<{id:bigint}>>`INSERT INTO public.traffic_research_snapshots(origin,destination,week_utc,source_sha256,rows_sha256,snapshot,forecast) VALUES (${route.origin},${route.destination},(date_trunc('week',now() AT TIME ZONE 'UTC'))::date,${source.sourceSha256},${hash},${JSON.stringify(source.monthly)}::jsonb,${prediction?JSON.stringify(prediction):null}::jsonb) ON CONFLICT (origin,destination,week_utc) DO NOTHING RETURNING id`;
    });
    if(added.length)saved++;else skipped++;
   }catch(e){failed++;console.error('Traffic research collection failed for',route.origin,route.destination,e instanceof Error?e.message:'unknown')}
  }
  const status=failed?(saved||skipped?'partial':'failed'):'success';
  await db.$executeRaw`UPDATE public.traffic_research_runs SET status=${status},finished_at=now(),saved=${saved},skipped=${skipped},failed=${failed} WHERE week_utc=${claim[0].week_utc}::date`;
  return response({status,saved,skipped,failed},failed?503:200);
 }catch(e){console.error('Traffic research collection error',e instanceof Error?e.message:'unknown');return response({error:'Collection unavailable'},503)}
}
