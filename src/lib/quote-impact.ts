import {applySupplierQuote} from './apply-supplier-quote';
import {optimizePortfolio} from './portfolio-optimizer';
import {coverageFor} from './inventory-coverage';
import type {Opportunity,PlanRow} from './procurement-core';
import type {SupplierQuote} from './supplier-quotes';
/** A nonbinding comparison. Added charge is hypothetical, non-recoverable, and
 * does not transfer to the actual plan. No supplier/order is contacted. */
export function quoteImpact(items:Opportunity[],rows:PlanRow[],budget:number,risk:number,asOf:string,quote:SupplierQuote,now:Date,extra:number){
 if(!Number.isFinite(extra)||extra<0||extra>1000000)throw Error('Enter an additional cost from ₹0 to ₹10,00,000 per unit.');
 const quoted=applySupplierQuote(items,quote,now),item=quoted.find(x=>x.id===quote.inventoryId)!;const landed=item.buy+extra;
 if(landed>10000000)throw Error('The hypothetical landed unit cost exceeds the supported limit.');
 const scenarioItems=quoted.map(x=>x.id===item.id?{...x,buy:landed,recoveryPct:landed?x.buy*(x.recoveryPct??0)/landed:0}:x);
 const scenario=optimizePortfolio(scenarioItems,budget,risk,{asOf}).rows;
 const before=rows.find(x=>x.id===item.id),after=scenario.find(x=>x.id===item.id);if(!before||!after)throw Error('Inventory no longer matches this quote.');
 const totals=(rs:PlanRow[])=>rs.reduce((a,r)=>({spend:a.spend+r.spend,profit:a.profit+r.expectedProfit,downside:a.downside+r.downsideProfit,unsold:a.unsold+r.unsoldExposure}),{spend:0,profit:0,downside:0,unsold:0});
 return {before,after,landed,beforeCoverage:coverageFor(before),afterCoverage:coverageFor(after),baseline:totals(rows),scenario:totals(scenario)};
}
