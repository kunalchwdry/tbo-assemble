import {NextRequest,NextResponse} from 'next/server';
import {createHash} from 'node:crypto';
import {supabaseServer} from '@/lib/supabase/server';
import {buildTraffic,DGCA_URL,ROUTES} from '@/lib/india-market';
import {studyTraffic} from '@/lib/india-traffic-forecast';
import {evidenceOutcomes,type StoredRouteEvidence} from '@/lib/route-evidence';
export const dynamic='force-dynamic';export const maxDuration=30;
const headers={'Cache-Control':'no-store'};
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers});
async function user(){const client=await supabaseServer();const {data,error}=await client.auth.getUser();return error?null:data.user}
function routeFor(origin:unknown,destination:unknown){return ROUTES.find(r=>r.origin===origin&&r.destination===destination)}
function sameOrigin(req:NextRequest){try{const origin=req.headers.get('origin');if(!origin)return false;const u=new URL(origin);return u.host===req.headers.get('host')&&(u.protocol==='https:'||u.hostname==='localhost'||u.hostname==='127.0.0.1')}catch{return false}}
type DbRow={id:string;origin:string;destination:string;captured_at:Date;source_sha256:string;snapshot:StoredRouteEvidence['rows'];forecast:StoredRouteEvidence['forecast'];model_version:string};
export async function GET(req:NextRequest){
 try{const u=await user();if(!u)return reply({error:'Sign in to view your route evidence.'},401);const origin=req.nextUrl.searchParams.get('origin'),destination=req.nextUrl.searchParams.get('destination');if(!routeFor(origin,destination))return reply({error:'Choose a supported route.'},400);
 const {default:db}=await import('@/lib/db');const rows=await db.$queryRaw<DbRow[]>`SELECT id,origin,destination,captured_at,source_sha256,snapshot,forecast,model_version FROM public.route_forecast_evidence WHERE owner_id=${u.id}::uuid AND origin=${origin} AND destination=${destination} ORDER BY captured_at DESC LIMIT 100`;
 const records=rows.map(r=>({id:r.id,origin:r.origin,destination:r.destination,capturedAt:new Date(r.captured_at).toISOString(),sourceSha256:r.source_sha256,rows:r.snapshot,forecast:r.forecast,modelVersion:r.model_version}));return reply({records:evidenceOutcomes(records)});
 }catch{return reply({error:'Could not load route evidence.'},503)}
}
export async function DELETE(req:NextRequest){
 if(!sameOrigin(req))return reply({error:'Request origin is not permitted.'},403);
 try{
 const u=await user();if(!u)return reply({error:'Sign in before deleting evidence.'},401);
 const input=await req.json().catch(()=>null),id=input?.id;
 if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return reply({error:'Choose a valid snapshot.'},400);
 const {default:db}=await import('@/lib/db');
 const removed=await db.$transaction(async tx=>{await tx.$queryRaw`SELECT 1::int AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${u.id},0))) AS acquired`;return tx.$queryRaw<Array<{id:string}>>`DELETE FROM public.route_forecast_evidence WHERE owner_id=${u.id}::uuid AND id=${id}::uuid RETURNING id`});
 return removed.length?reply({deleted:true}):reply({error:'Snapshot not found.'},404);
 }catch{return reply({error:'Could not delete evidence.'},503)}
}
export async function POST(req:NextRequest){
 if(!sameOrigin(req))return reply({error:'Request origin is not permitted.'},403);
 try{
 const u=await user();if(!u)return reply({error:'Sign in before saving evidence.'},401);
 const input=await req.json().catch(()=>null),route=routeFor(input?.origin,input?.destination),clientTime=Date.parse(input?.clientTime);
 if(!route||!Number.isFinite(clientTime))return reply({error:'Choose a route and provide the device time.'},400);
 if(Math.abs(Date.now()-clientTime)>300000)return reply({error:'Device and server clocks differ by more than five minutes. Evidence was not saved.'},409);
 const response=await fetch(DGCA_URL,{cache:'no-store',signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('source');const text=await response.text();if(text.length<1000||text.length>10_000_000)throw Error('size');
 const {monthly}=buildTraffic(text,route),now=new Date(),asOfMonth=now.toISOString().slice(0,7);
 if(!monthly.length||monthly.some(r=>r.month>=asOfMonth))return reply({error:'The source has current or future months; capture paused until data and clock are checked.'},409);
 const study=studyTraffic(monthly,asOfMonth),forecast=(study.status==='available'||study.status==='baseline')&&study.forecast!==null&&study.lower!==null&&study.upper!==null&&study.targetMonth&&study.method?{targetMonth:study.targetMonth,value:study.forecast,lower:study.lower,upper:study.upper,method:study.method}:null;
 const hash=createHash('sha256').update(text).digest('hex');const {default:db}=await import('@/lib/db');
 const result=await db.$transaction(async tx=>{await tx.$queryRaw`SELECT 1::int AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${u.id},0))) AS acquired`;const status=await tx.$queryRaw<Array<{n:number;skew:number}>>`SELECT (SELECT count(*)::int FROM public.route_forecast_evidence WHERE owner_id=${u.id}::uuid) AS n, abs(extract(epoch from (now()-${now}::timestamptz)))::float8 AS skew`;if(status[0].n>=100)throw Error('limit');if(status[0].skew>300)throw Error('clock');
 return tx.$queryRaw<Array<{id:string}>>`INSERT INTO public.route_forecast_evidence(owner_id,origin,destination,source_sha256,snapshot,forecast) VALUES (${u.id}::uuid,${route.origin},${route.destination},${hash},${JSON.stringify(monthly)}::jsonb,${forecast?JSON.stringify(forecast):null}::jsonb) ON CONFLICT DO NOTHING RETURNING id`});
 if(!result.length)return reply({error:'A snapshot for this route was already saved today UTC.'},409);
 return reply({saved:true,forecastRecorded:!!forecast});
 }catch(e){if(e instanceof Error&&e.message==='limit')return reply({error:'Evidence limit reached (100 snapshots per account).'},429);if(e instanceof Error&&e.message==='clock')return reply({error:'Database and server clocks differ. Evidence was not saved.'},409);return reply({error:'Could not save evidence. The source, account or database may be unavailable.'},503)}
}
