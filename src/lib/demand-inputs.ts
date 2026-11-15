import type {Opportunity} from './procurement-core';
export const demandFields=[
 {key:'bookings',label:'Current bookings',min:0,max:1000000,help:'Bookings observed for the comparable period.'},
 {key:'previousBookings',label:'Previous bookings',min:0,max:1000000,optional:true,help:'Optional prior comparable booking count.'},
 {key:'searches',label:'Current searches',min:0,max:10000000,help:'Searches observed for the same product and comparable period.'},
 {key:'previousSearches',label:'Previous searches',min:0,max:10000000,optional:true,help:'Optional prior comparable search count.'},
 {key:'conversion',label:'Assumed look-to-book conversion',min:0,max:1,help:'Fraction between 0 and 1; 0.05 means 5%.'},
 {key:'seasonal',label:'Seasonality multiplier',min:0,max:5,help:'1 means no adjustment; 1.1 means +10%.'},
 {key:'signal',label:'External signal multiplier',min:0,max:5,help:'Manual assumption only; 1 means no adjustment. Live news and weather are not automatically used.'},
 {key:'soldOut',label:'Sold-out signal',min:0,max:100,help:'Percent-like index from 0–100; illustrative uplift, not recovered lost demand.'},
 {key:'cancellations',label:'Cancellation fraction',min:0,max:1,help:'0.10 means 10%; applied once to the demand estimate.'},
 {key:'volatility',label:'Demand volatility',min:0,max:1,help:'0.20 gives ±20% low and high demand scenarios.'},
 {key:'existingStock',label:'Existing stock',min:0,max:1000000,integer:true,help:'Whole room-nights or seats already available for this product-period.'},
 {key:'recoveryPct',label:'Unsold cost recovery fraction',min:0,max:1,help:'0.20 means 20% of unsold purchase cost is recovered.'},
] as const;
export type DemandField=typeof demandFields[number]['key'];
export type DemandEdits=Record<DemandField,string>;
export function demandValues(item:Opportunity):DemandEdits{return Object.fromEntries(demandFields.map(f=>[f.key,String(item[f.key]??('optional' in f&&f.optional?'':0))])) as DemandEdits}
/** Atomic update: all fields must be valid; unrelated contract and identity fields never change. */
export function applyDemandInputs(item:Opportunity,values:DemandEdits):Opportunity {
 const updates:Record<string,number|undefined>={};
 for(const f of demandFields){const text=values[f.key]?.trim()??'';if(!text&&'optional' in f&&f.optional){updates[f.key]=undefined;continue}const n=Number(text);if(!text||!Number.isFinite(n)||n<f.min||n>f.max||('integer' in f&&f.integer&&!Number.isInteger(n)))throw new Error(`${f.label} must be ${'integer' in f&&f.integer?'a whole number ':''}between ${f.min} and ${f.max}.`);updates[f.key]=n}
 return {...item,...updates};
}
