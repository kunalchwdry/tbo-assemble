import {NextRequest,NextResponse} from 'next/server';
import {unstable_cache} from 'next/cache';
import {ROUTES,seasonalReference} from '@/lib/india-market';
import {loadIndiaTraffic} from '@/lib/india-traffic-source';
const getTraffic=unstable_cache(async (origin:string,destination:string)=>{
 const route=ROUTES.find(r=>r.origin===origin&&r.destination===destination);if(!route)throw Error('Unsupported route');
 const result=await loadIndiaTraffic(route);
 return {route,...result,reference:seasonalReference(result.monthly),source:'DGCA original workbooks and DGCA via Vonter',sourceUrl:'https://www.dgca.gov.in/',license:'DGCA website policy; historical CSV ODbL 1.0'};
},['india-market-traffic-v5'],{revalidate:43200});
export async function GET(req:NextRequest){
 const origin=req.nextUrl.searchParams.get('origin'),destination=req.nextUrl.searchParams.get('destination');
 if(!origin||!destination||!ROUTES.some(r=>r.origin===origin&&r.destination===destination))return NextResponse.json({error:'Select a supported route.'},{status:400});
 try{return NextResponse.json(await getTraffic(origin,destination),{headers:{'Cache-Control':'public, max-age=300, s-maxage=43200'}})}
 catch{return NextResponse.json({error:'Indian traffic sources are temporarily unavailable or could not be validated. Try again later.'},{status:503});}
}
