import type {Opportunity} from './procurement-core';
import type {SupplierQuote} from './supplier-quotes';

/** Session-only user-supplied evidence, never a verified offer or approval. */
type Transferred={name:string;destination:string;kind:Opportunity['kind'];period:string;buy:number;capacity:number;minOrderUnits:number;quoteExpiry:string;recoveryPct:number;previousBuy:number};
export type QuoteHandoff={quote:SupplierQuote;extraPerUnit:number;appliedAt:string;transferred:Transferred};
function transferred(item:Opportunity):Transferred{
 return {name:item.name,destination:item.destination,kind:item.kind,period:item.period,buy:item.buy,capacity:item.capacity,minOrderUnits:item.minOrderUnits??1,quoteExpiry:item.quoteExpiry??'',recoveryPct:item.recoveryPct??0,previousBuy:item.previousBuy??0};
}
export function createQuoteHandoff(quote:SupplierQuote,extraPerUnit:number,appliedItem:Opportunity,now:Date):QuoteHandoff{
 if(quote.inventoryId!==appliedItem.id||!Number.isFinite(now.getTime())||!Number.isFinite(extraPerUnit)||extraPerUnit<0)throw Error('Invalid quote handoff.');
 return {quote:{...quote},extraPerUnit,appliedAt:now.toISOString(),transferred:transferred(appliedItem)};
}
export function inspectQuoteHandoffs(handoffs:QuoteHandoff[],items:Opportunity[],now:number){
 if(!Number.isFinite(now))throw Error('Invalid capture time.');
 return handoffs.map(h=>{
  const item=items.find(i=>i.id===h.quote.inventoryId);
  const fieldsMatch=!!item&&JSON.stringify(transferred(item))===JSON.stringify(h.transferred);
  const expiry=Date.parse(h.quote.expiresAt),observed=Date.parse(h.quote.observedAt),applied=Date.parse(h.appliedAt);
  const validity=!Number.isFinite(expiry)||!Number.isFinite(observed)||!Number.isFinite(applied)||expiry<=observed?'invalid':now<observed?'not-yet-observed':now<applied?'clock-before-application':now>=expiry?'expired':'within-supplied-dates';
  return {...h,fieldsMatch,validity,notice:'User-entered information and local self-check only; not verified availability, authorization, or an order.'};
 });
}
