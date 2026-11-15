import {NextRequest,NextResponse} from 'next/server';
import {unstable_cache} from 'next/cache';
import {findTrendsPreset,parseGoogleTrends} from '@/lib/google-trends';
export const dynamic='force-dynamic';export const maxDuration=30;
class BudgetReached extends Error {} class BudgetUnavailable extends Error {} class ProviderUnavailable extends Error {}
// Same atomic reservation as flight price searches: shared cap across both features.
async function reserve(){try{const {default:db}=await import('@/lib/db');await db.$transaction(async tx=>{
 const lock=await tx.$queryRaw<Array<{id:number}>>`SELECT id FROM public.serpapi_search_budget_lock WHERE id=1 FOR UPDATE`;if(lock.length!==1)throw Error('lock');
 const totals=await tx.$queryRaw<Array<{daily:bigint;rolling:bigint}>>`SELECT COALESCE(SUM(CASE WHEN usage_day = (NOW() AT TIME ZONE 'UTC')::date THEN attempts ELSE 0 END),0)::bigint AS daily, COALESCE(SUM(attempts),0)::bigint AS rolling FROM public.serpapi_search_usage WHERE usage_day >= (NOW() AT TIME ZONE 'UTC')::date - 29 AND usage_day <= (NOW() AT TIME ZONE 'UTC')::date`;
 if(Number(totals[0].daily)>=8||Number(totals[0].rolling)>=180)throw new BudgetReached();await tx.$executeRaw`INSERT INTO public.serpapi_search_usage(usage_day,attempts) VALUES ((NOW() AT TIME ZONE 'UTC')::date,1) ON CONFLICT (usage_day) DO UPDATE SET attempts=serpapi_search_usage.attempts+1`;
 });}catch(e){if(e instanceof BudgetReached)throw e;throw new BudgetUnavailable()}}
const getTrends=unstable_cache(async(id:string)=>{
 const preset=findTrendsPreset(id);if(!preset||!process.env.SERPAPI_KEY)throw new ProviderUnavailable();await reserve();
 const query=new URLSearchParams({engine:'google_trends',q:preset.query,geo:'IN',date:'today 3-m',tz:'0',data_type:'TIMESERIES',api_key:process.env.SERPAPI_KEY});
 try{const res=await fetch('https://serpapi.com/search.json?'+query,{cache:'no-store',signal:AbortSignal.timeout(25000)});if(!res.ok)throw Error('upstream');const data=await res.json();if(data.error||data.search_metadata?.status!=='Success')throw Error('upstream');return parseGoogleTrends(data,preset,Date.now());}catch{throw new ProviderUnavailable()}
},['google-trends-presets-v1'],{revalidate:86400});
export async function POST(req:NextRequest){
 const headers={'Cache-Control':'no-store'};let input:unknown;try{input=await req.json()}catch{return NextResponse.json({error:'Invalid request.'},{status:400,headers})}
 const id=input&&typeof input==='object'&&'presetId' in input?(input as {presetId:unknown}).presetId:null;if(typeof id!=='string'||!findTrendsPreset(id))return NextResponse.json({error:'Choose a supported travel search.'},{status:400,headers});
 if(!process.env.SERPAPI_KEY)return NextResponse.json({error:'SerpApi is not configured.'},{status:503,headers});
 try{return NextResponse.json(await getTrends(id),{headers})}catch(e){const error=e instanceof BudgetReached?'Shared search limit reached: 8 attempts per UTC day or 180 in 30 days.':e instanceof BudgetUnavailable?'Search budget unavailable; no provider call was made.':'Search data unavailable, incomplete, or the provider quota was exhausted. An attempted search may count against the limit.';return NextResponse.json({error},{status:e instanceof BudgetReached?429:e instanceof BudgetUnavailable?503:502,headers})}
}
