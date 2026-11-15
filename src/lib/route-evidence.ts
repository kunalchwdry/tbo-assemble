import type {MonthlyTraffic} from './india-market';
export type StoredRouteEvidence={id:string;origin:string;destination:string;capturedAt:string;sourceSha256:string;rows:(MonthlyTraffic & {provenance?:{kind:string;url:string;sha256:string;month?:string}})[];forecast:{targetMonth:string;value:number;lower:number;upper:number;method:string}|null;modelVersion:string};
/** An actual becomes comparable only if the forecast was recorded before its target
 * and the later snapshot was captured after the target month ended. Values may
 * be revised and archive times depend on a trustworthy server clock. */
export function evidenceOutcomes(items:StoredRouteEvidence[]){
 return items.map(original=>{
  const f=original.forecast;if(!f||!/^\d{4}-(0[1-9]|1[0-2])$/.test(f.targetMonth)||!Number.isFinite(Date.parse(original.capturedAt))||original.capturedAt.slice(0,7)>=f.targetMonth)return {...original,outcome:null};
  const observed=items.filter(x=>x.origin===original.origin&&x.destination===original.destination&&x.capturedAt.slice(0,7)>f.targetMonth&&Date.parse(x.capturedAt)>Date.parse(original.capturedAt)).sort((a,b)=>b.capturedAt.localeCompare(a.capturedAt));
  for(const source of observed){const matches=source.rows.filter(r=>r.month===f.targetMonth);if(matches.length!==1||matches[0].quality!=='ok'||typeof matches[0].passengers!=='number'||!Number.isFinite(matches[0].passengers)||matches[0].passengers<0)continue;const actual=matches[0].passengers;return {...original,outcome:{actual,error:Math.abs(actual-f.value),sourceCapturedAt:source.capturedAt}}}
  return {...original,outcome:null};
 });
}
