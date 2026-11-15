import type {PlanRow} from './procurement-core';
import type {QuoteHandoff} from './quote-handoff';

type Handoff=QuoteHandoff & {fieldsMatch:boolean;validity:string};
/** Input completeness cues, never a guarantee, authorization or verified forecast. */
export function decisionChecks(input:{rows:PlanRow[];source:'synthetic'|'uploaded';unappliedBudget:boolean;loading:boolean;asOf:string;today:string;handoffs:Handoff[]}){
 const selected=input.rows.filter(r=>r.qty>0);
 const absent=selected.filter(row=>!input.handoffs.some(h=>h.quote.inventoryId===row.id));
 const changed=selected.filter(row=>input.handoffs.some(h=>h.quote.inventoryId===row.id&&!h.fieldsMatch));
 const expired=selected.filter(row=>input.handoffs.some(h=>h.quote.inventoryId===row.id&&h.validity!=='within-supplied-dates'));
 const noDemandEvidence=selected.filter(r=>r.bookingWeight===undefined);
 const expiredDate=selected.filter(r=>!r.quoteExpiry||r.quoteExpiry<=input.today);
 return [
  {id:'inputs',title:'Data provenance',issue:input.source==='synthetic',detail:input.source==='synthetic'?'The starting inventory is synthetic; replace or edit it for your scenario.':'Imported inputs are user-supplied and not independently verified.',href:'/inventory/data',action:'Review inputs'},
  {id:'demand',title:'Demand evidence',issue:noDemandEvidence.length>0||selected.length===0,detail:selected.length?`${noDemandEvidence.length} of ${selected.length} selected opportunities have no attached experimental demand validation. Validation does not verify the allocation.`:'No selected opportunities to validate.',href:'/inventory/demand-validation',action:'Review demand'},
  {id:'plan',title:'Budget and date',issue:input.unappliedBudget||input.loading||input.asOf!==input.today||!selected.length,detail:input.unappliedBudget?'Budget edits are not applied.':input.loading?'Wait for market signals to finish.':input.asOf!==input.today?`The model uses ${input.asOf} UTC instead of today.`:!selected.length?'Current inputs result in zero selections.':'Budget and review date are applied; results remain modeled.',href:'/inventory#opportunities',action:'Review allocation'},
  {id:'supplier',title:'Supplier handoff',issue:absent.length>0||changed.length>0||expired.length>0||expiredDate.length>0||!selected.length,detail:!selected.length?'No selected opportunities to match.':`${absent.length} without session quote handoff · ${changed.length} changed · ${expired.length} outside supplied dates · ${expiredDate.length} with missing or due planner dates.`,href:'/inventory/supplier-quotes',action:'Review quotes'},
  {id:'risk',title:'Downside and cancellation',issue:true,detail:'Stress cases and cancellation assumptions still need human review; neither is probability-calibrated.',href:'/inventory/stress-test',action:'Review risk'},
 ] as const;
}
