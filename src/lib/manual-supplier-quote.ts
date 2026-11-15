import {quoteColumns,readSupplierQuotes,type SupplierQuote} from './supplier-quotes';
import type {Opportunity} from './procurement-core';
export type ManualQuoteInput={quoteId:string;inventoryId:string;supplier:string;unitPrice:string;availableUnits:string;minimumUnits:string;observedAt:string;expiresAt:string;travelPeriod:string;cancellationTerms:string;taxesFees:string};
/** Parse all manual inputs through the same CSV validator. Date-time fields are explicitly UTC. */
export function makeManualQuote(input:ManualQuoteInput,items:Opportunity[]):SupplierQuote{
 const item=items.find(i=>i.id===input.inventoryId);if(!item)throw Error('Choose an inventory item.');
 const stamp=(value:string)=>/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)?`${value}:00Z`:value;
 const vals=[input.quoteId.trim(),input.inventoryId,input.supplier.trim(),item.kind==='Flight'?'seat':'room-night',input.unitPrice.trim(),input.availableUnits.trim(),input.minimumUnits.trim(),stamp(input.observedAt),stamp(input.expiresAt),input.cancellationTerms.trim(),input.taxesFees.trim(),input.travelPeriod.trim()];
 const csv=(row:string[])=>row.map(v=>`"${v.replaceAll('"','""')}"`).join(',');
 return readSupplierQuotes([csv([...quoteColumns,'travel_period']),csv(vals)].join('\n'))[0];
}
