import type {PlanRow} from './procurement-core';

/** A transparent summary of the current model output, not a purchase approval. */
export function decisionBrief(rows:PlanRow[],asOf:string,today:string,source:'synthetic'|'uploaded',unappliedBudget:boolean){
 const selected=rows.filter(r=>r.qty>0);
 const top=[...selected].sort((a,b)=>b.objective-a.objective||a.id.localeCompare(b.id))[0]??null;
 const missingExpiry=selected.filter(r=>!r.quoteExpiry).length;
 const expiryDue=selected.filter(r=>!!r.quoteExpiry&&r.quoteExpiry<=today).length;
 const missingTrends=rows.filter(r=>!(r.previousBookings&&r.previousBookings>0)||!(r.previousSearches&&r.previousSearches>0)).length;
 return {top,selectedCount:selected.length,hotelUnits:selected.filter(r=>r.kind==='Hotel').reduce((n,r)=>n+r.qty,0),flightUnits:selected.filter(r=>r.kind==='Flight').reduce((n,r)=>n+r.qty,0),missingExpiry,expiryDue,missingTrends,source,unappliedBudget,reviewDateIsCurrent:asOf===today};
}
