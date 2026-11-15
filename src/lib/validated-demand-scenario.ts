import type {Opportunity} from './procurement-core';
import type {BacktestResult} from './demand-backtest';
export type DemandScenario={result:BacktestResult;source:'synthetic'|'uploaded';label:string};
/** Only use a sample's training-fitted weight after it clears a fixed holdout
 * gate. This does not verify provenance or establish prospective accuracy. */
export function demandScenarioIssue(item:Opportunity|undefined,scenario:DemandScenario,asOf:string,today:string):string|null {
 const r=scenario.result;
 if(!item||item.id!==r.opportunityId)return 'The inventory ID no longer matches.';
 if((item.kind==='Hotel'?'room_nights':'seats')!==r.unit)return 'The inventory unit does not match the history.';
 if(asOf!==today)return 'Set the review date to today UTC before using this scenario.';
 if(r.evaluationDate>asOf||r.testLatestOutcome>r.evaluationDate||r.trainLatestOutcome>=r.testStart)return 'The history contains outcomes unavailable for this review date.';
 const age=(Date.parse(today+'T00:00:00Z')-Date.parse(r.testLatestOutcome+'T00:00:00Z'))/86400000;
 const periodAge=(Date.parse(today+'T00:00:00Z')-Date.parse(r.testLatestPeriodEnd+'T00:00:00Z'))/86400000;
 if(!Number.isFinite(age)||age<0||age>90||!Number.isFinite(periodAge)||periodAge<0||periodAge>90)return 'The latest holdout travel period and its outcome must both be within 90 days.';
 if(r.trainCount<20||r.testCount<8||!Number.isFinite(r.weight)||r.weight<0||r.weight>1)return 'Not enough valid training and holdout data.';
 if(![r.fittedMae,r.currentMae,r.baselineMae].every(x=>Number.isFinite(x)&&x>=0)||r.fittedMae>=r.baselineMae*.95||r.fittedMae>=r.currentMae*.95)return 'Fitted MAE must beat both the prior-period baseline and the default planner by more than 5% on holdout.';
 return null;
}
export function applyDemandScenarios(items:Opportunity[],scenarios:Record<string,DemandScenario>,asOf:string,today:string){
 return items.map(item=>{const scenario=Object.hasOwn(scenarios,item.id)?scenarios[item.id]:undefined;return scenario&&!demandScenarioIssue(item,scenario,asOf,today)?{...item,bookingWeight:scenario.result.weight}:item});
}
