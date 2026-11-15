import type {Opportunity} from './procurement-core';
export const marketDestinations=['Goa','Dubai','Bali','Jaipur','Kerala','Singapore','Bangkok'] as const;
export type MarketDestination=typeof marketDestinations[number];
export type AttentionSample={destination:MarketDestination;article:string;days:{date:string;views:number}[];fetchedAt:string;source:'Wikimedia Pageviews API'};
const day=86400000;
const validDate=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
/** Validate provenance, completeness and age before using a live response. Never use a
 * present-day sample in a past/future scenario. Fresh fetch time alone is insufficient. */
export function attentionAdjustment(raw:unknown,destination:string,asOf:string,now:number):{factor:number;change:number;latest:string;fetchedAt:string}|null {
 if(!marketDestinations.includes(destination as MarketDestination)||!raw||typeof raw!=='object'||!Number.isFinite(now))return null;
 const s=raw as Partial<AttentionSample>;
 if(s.destination!==destination||s.article!==destination||s.source!=='Wikimedia Pageviews API'||!Array.isArray(s.days)||s.days.length!==14||typeof s.fetchedAt!=='string')return null;
 const fetchTime=Date.parse(s.fetchedAt),today=new Date(now).toISOString().slice(0,10);
 if(asOf!==today||!Number.isFinite(fetchTime)||fetchTime>now+5*60000||now-fetchTime>2*3600000)return null;
 for(let i=0;i<14;i++){const p=s.days[i];if(!p||!validDate(p.date)||!Number.isSafeInteger(p.views)||p.views<0||p.views>1e9)return null;if(i&&Date.parse(p.date+'T00:00:00Z')-Date.parse(s.days[i-1].date+'T00:00:00Z')!==day)return null;}
 const latest=s.days[13].date,latestMs=Date.parse(latest+'T00:00:00Z'),todayMs=Date.parse(today+'T00:00:00Z');if(latestMs>=todayMs||todayMs-latestMs>3*day)return null;
 const previous=s.days.slice(0,7).reduce((a,p)=>a+p.views,0),recent=s.days.slice(7).reduce((a,p)=>a+p.views,0);if(previous<100)return null;
 const change=recent/previous-1;
 // Explicitly hypothetical sensitivity, capped to avoid extreme shocks.
 const factor=1+Math.max(-.10,Math.min(.10,change*.10));
 return {factor,change,latest,fetchedAt:s.fetchedAt};
}
export function applyAttentionSignals(items:Opportunity[],samples:Record<string,unknown>,asOf:string,now:number,enabled:boolean){
 const details:Record<string,ReturnType<typeof attentionAdjustment>>={};
 if(!enabled)return {items,details};
 const adjusted=items.map(item=>{const signal=attentionAdjustment(samples[item.destination],item.destination,asOf,now);details[item.destination]=signal;if(!signal)return item;return {...item,signal:Math.min(5,Math.max(0,item.signal*signal.factor))}});
 return {items:adjusted,details};
}
