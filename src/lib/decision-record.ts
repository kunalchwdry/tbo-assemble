import {optimizePortfolio} from './portfolio-optimizer';
import {applyAttentionSignals} from './live-demand-signal';
import {applyDemandScenarios,demandScenarioIssue,type DemandScenario} from './validated-demand-scenario';
import {PLAN_MODEL_VERSION,validatePlanInput} from './private-plan';
import type {Opportunity} from './procurement-core';

/** Local review snapshot, not an approval, booking, verified supplier offer or audit log. */
export function makeDecisionRecord(input:{items:Opportunity[];budget:number;risk:number;asOf:string;source:'synthetic'|'uploaded';scenarios:Record<string,DemandScenario>;marketOn:boolean;marketSamples:Record<string,unknown>;now:number}){
 if(!Number.isFinite(input.now))throw new Error('Invalid capture time.');
 const clean=validatePlanInput({items:input.items,budget:input.budget,risk:input.risk,asOf:input.asOf,source:input.source});
 const today=new Date(input.now).toISOString().slice(0,10);
 const fitted=applyDemandScenarios(clean.items,input.scenarios,clean.asOf,today);
 const attention=applyAttentionSignals(fitted,input.marketSamples,clean.asOf,input.now,input.marketOn);
 const plan=optimizePortfolio(attention.items,clean.budget,clean.risk,{asOf:clean.asOf});
 const scenarios=Object.fromEntries(clean.items.filter(item=>Object.hasOwn(input.scenarios,item.id)).map(item=>{
  const scenario=input.scenarios[item.id];return [item.id,{...scenario,applied:demandScenarioIssue(item,scenario,clean.asOf,today)===null,notAppliedReason:demandScenarioIssue(item,scenario,clean.asOf,today)}];
 }));
 const usedSamples=Object.fromEntries(Object.entries(attention.details).filter(([,details])=>details!==null).map(([destination])=>[destination,input.marketSamples[destination]]));
 return {
  recordVersion:1,modelVersion:PLAN_MODEL_VERSION,capturedAtUtc:new Date(input.now).toISOString(),clockSource:'device clock; not independently verified',
  purpose:'Local scenario review only. This is not an approval, a reservation, a supplier offer or a purchase order.',
  warnings:['Inputs and supplier terms are not independently verified.','Applied supplier quote identity, written terms and the review checklist are not captured in this file.','Forecast, price response, profit and risk are model assumptions, not guaranteed outcomes.','Public pageviews are an experimental attention proxy, not bookings.','No TBO supplier search or booking was made.','This file may contain sensitive user-entered data. Store and share it carefully.','Saved historical validation summaries do not contain the full training data.'],
  source:clean.source,settings:{budgetInr:clean.budget,risk:clean.risk,quoteReviewDateUtc:clean.asOf,experimentalAttentionEnabled:input.marketOn},
  originalInventory:clean.items,effectiveInventory:attention.items,demandScenarios:scenarios,attention:{details:attention.details,acceptedSamples:usedSamples},
  result:plan,
 };
}
