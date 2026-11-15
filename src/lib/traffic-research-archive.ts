import {createHash} from 'node:crypto';
import {shiftMonth,type MonthlyTraffic} from './india-market';
import {studyTraffic} from './india-traffic-forecast';

export type ArchiveRow=MonthlyTraffic & {provenance?:{kind:string;url:string;sha256:string;month?:string}};
export type ArchivedPrediction={targetMonth:string;current:number;currentMethod:string;lastObserved:number;lastYear:number};
export type ArchiveSnapshot={capturedAt:string;rows:ArchiveRow[];forecast:ArchivedPrediction|null};
export function rowsHash(rows:ArchiveRow[]){
 return createHash('sha256').update(JSON.stringify(rows.map(r=>[r.month,r.passengers,r.quality,r.provenance?.kind??'',r.provenance?.url??'',r.provenance?.sha256??'',r.provenance?.month??'']))).digest('hex');
}
function validActual(rows:ArchiveRow[],month:string){
 const found=rows.filter(x=>x.month===month);const row=found[0];
 return found.length===1&&row.quality==='ok'&&typeof row.passengers==='number'&&Number.isFinite(row.passengers)&&row.passengers>=0?row.passengers:null;
}
/** Record only a future, fresh estimate and both baseline predictions from the
 * same already-observed series. Stale data creates no prediction at all. */
export function freezePrediction(rows:ArchiveRow[],capturedAt:string):ArchivedPrediction|null{
 const t=Date.parse(capturedAt);if(!Number.isFinite(t))return null;const month=new Date(t).toISOString().slice(0,7);
 const result=studyTraffic(rows,month);
 if(!['available','baseline'].includes(result.status)||!result.targetMonth||result.targetMonth<=month||result.forecast===null||!Number.isFinite(result.forecast)||!result.method)return null;
 const last=validActual(rows,shiftMonth(result.targetMonth,-2)),year=validActual(rows,shiftMonth(result.targetMonth,-12));
 if(last===null||year===null)return null;
 return {targetMonth:result.targetMonth,current:result.forecast,currentMethod:result.method,lastObserved:last,lastYear:year};
}
/** First forecast per target, scored only against the first subsequently saved
 * completed-month observation. Missing/conflicting values never count as zero.
 * This is tentative chronology: infrastructure clocks are not certified. */
export function evaluateArchive(snapshots:ArchiveSnapshot[]){
 const ordered=[...snapshots].filter(s=>Number.isFinite(Date.parse(s.capturedAt))).sort((a,b)=>a.capturedAt.localeCompare(b.capturedAt));
 const used=new Set<string>();const scores:Array<{targetMonth:string;forecastAt:string;actualAt:string;actual:number;current:number;lastObserved:number;lastYear:number}>=[];
 let pending=0;
 for(const snapshot of ordered){
  const f=snapshot.forecast;
  if(!f||!/^\d{4}-(0[1-9]|1[0-2])$/.test(f.targetMonth)||snapshot.capturedAt.slice(0,7)>=f.targetMonth||![f.current,f.lastObserved,f.lastYear].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0)||used.has(f.targetMonth))continue;
  used.add(f.targetMonth);
  const later=ordered.find(s=>s.capturedAt>snapshot.capturedAt&&s.capturedAt.slice(0,7)>f.targetMonth&&validActual(s.rows,f.targetMonth)!==null);
  if(!later){pending++;continue}
  const actual=validActual(later.rows,f.targetMonth)!;
  scores.push({targetMonth:f.targetMonth,forecastAt:snapshot.capturedAt,actualAt:later.capturedAt,actual,current:Math.abs(f.current-actual),lastObserved:Math.abs(f.lastObserved-actual),lastYear:Math.abs(f.lastYear-actual)});
 }
 const mean=(key:'current'|'lastObserved'|'lastYear')=>scores.length?scores.reduce((sum,r)=>sum+r[key],0)/scores.length:null;
 return {pending,count:scores.length,mae:{current:mean('current'),lastObserved:mean('lastObserved'),lastYear:mean('lastYear')},scores};
}
