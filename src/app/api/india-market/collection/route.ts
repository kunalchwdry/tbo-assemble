import {NextRequest,NextResponse} from 'next/server';
import {ROUTES} from '@/lib/india-market';
import {evaluateArchive,rowsHash,type ArchiveRow,type ArchivedPrediction} from '@/lib/traffic-research-archive';
export const dynamic='force-dynamic';
const reply=(x:unknown,status=200)=>NextResponse.json(x,{status,headers:{'Cache-Control':'no-store'}});
type Snapshot={captured_at:Date;source_sha256:string;rows_sha256:string;snapshot:ArchiveRow[];forecast:ArchivedPrediction|null};
type Run={started_at:Date;finished_at:Date|null;status:string;saved:number;skipped:number;failed:number};
export async function GET(req:NextRequest){
 const origin=req.nextUrl.searchParams.get('origin'),destination=req.nextUrl.searchParams.get('destination');
 if(!ROUTES.some(r=>r.origin===origin&&r.destination===destination))return reply({error:'Choose a supported route'},400);
 if(!process.env.DATABASE_URL)return reply({error:'Collection status unavailable'},503);
 try{
  const {default:db}=await import('@/lib/db');
  const [snapshots,runs]=await Promise.all([
   db.$queryRaw<Snapshot[]>`SELECT captured_at,source_sha256,rows_sha256,snapshot,forecast FROM public.traffic_research_snapshots WHERE origin=${origin} AND destination=${destination} ORDER BY captured_at ASC LIMIT 104`,
   db.$queryRaw<Run[]>`SELECT started_at,finished_at,status,saved,skipped,failed FROM public.traffic_research_runs ORDER BY week_utc DESC LIMIT 1`]);
  const valid=snapshots.filter(x=>rowsHash(x.snapshot)===x.rows_sha256),last=valid.at(-1);
  const research=evaluateArchive(valid.map(x=>({capturedAt:new Date(x.captured_at).toISOString(),rows:x.snapshot,forecast:x.forecast})));
  return reply({route:{origin,destination},captureCount:valid.length,invalidCount:snapshots.length-valid.length,capacity:104,lastCapture:last?{capturedAt:new Date(last.captured_at).toISOString(),latestMonth:last.snapshot.at(-1)?.month??null,sourceSha256:last.source_sha256,rowsSha256:last.rows_sha256,forecastRecorded:!!last.forecast}:null,lastRun:runs[0]?{startedAt:new Date(runs[0].started_at).toISOString(),finishedAt:runs[0].finished_at?new Date(runs[0].finished_at).toISOString():null,status:runs[0].status,saved:runs[0].saved,skipped:runs[0].skipped,failed:runs[0].failed}:null,comparison:research});
 }catch{return reply({error:'Collection status unavailable'},503)}
}
