'use client';
import {useState,type FormEvent} from 'react';
import {Plus} from 'lucide-react';
import {makeManualQuote,type ManualQuoteInput} from '@/lib/manual-supplier-quote';
import type {SupplierQuote} from '@/lib/supplier-quotes';
import type {Opportunity} from '@/lib/procurement-core';
const initial:ManualQuoteInput={quoteId:'',inventoryId:'',supplier:'',unitPrice:'',availableUnits:'',minimumUnits:'1',observedAt:'',expiresAt:'',travelPeriod:'',cancellationTerms:'',taxesFees:''};
export default function ManualSupplierQuote({items,onAdd}:{items:Opportunity[];onAdd:(quote:SupplierQuote)=>void}){
 const [form,setForm]=useState<ManualQuoteInput>(initial),[error,setError]=useState('');
 const selected=items.find(i=>i.id===form.inventoryId);
 const change=(key:keyof ManualQuoteInput,value:string)=>setForm(prev=>({...prev,[key]:value}));
 function submit(e:FormEvent){e.preventDefault();try{if(!form.travelPeriod.trim())throw Error('Enter the supplier travel dates or period.');const quote=makeManualQuote(form,items);onAdd(quote);setForm(initial);setError('');}catch(e){setError(e instanceof Error?e.message:'Unable to add the quote.')}}
 return <details className="manual-quote"><summary><Plus size={16}/> Enter a quote manually</summary><form onSubmit={submit}>
  <p>Enter supplier-provided information. Times are UTC, not your local time. This creates a review only—not a reservation.</p>
  <div className="manual-quote-grid">
   <label>Inventory item<select required value={form.inventoryId} onChange={e=>change('inventoryId',e.target.value)}><option value="">Choose an item</option>{items.map(i=><option key={i.id} value={i.id}>{i.name} · {i.period} · {i.kind==='Hotel'?'room-night':'seat'}</option>)}</select></label>
   <label>Quote ID<input required maxLength={200} value={form.quoteId} onChange={e=>change('quoteId',e.target.value)} placeholder="e.g. quote-01"/></label>
   <label>Supplier<input required maxLength={200} value={form.supplier} onChange={e=>change('supplier',e.target.value)} /></label>
   <label>Supplier travel dates / period<input required maxLength={200} value={form.travelPeriod} onChange={e=>change('travelPeriod',e.target.value)} placeholder="e.g. 10–14 Dec 2026"/><small>Compare against the selected inventory period{selected?`: ${selected.period}`:''}; this text is not automatically verified.</small></label>
   <label>Price per {selected?.kind==='Flight'?'seat':'room-night'} (₹)<input required type="number" min="0.01" max="10000000" step="0.01" value={form.unitPrice} onChange={e=>change('unitPrice',e.target.value)}/></label>
   <label>Available units<input required type="number" min="1" max="1000000" step="1" value={form.availableUnits} onChange={e=>change('availableUnits',e.target.value)}/></label>
   <label>Minimum units<input required type="number" min="1" max="1000000" step="1" value={form.minimumUnits} onChange={e=>change('minimumUnits',e.target.value)}/></label>
   <label>Observed at (UTC)<input required type="datetime-local" step="60" value={form.observedAt} onChange={e=>change('observedAt',e.target.value)}/></label>
   <label>Expires at (UTC)<input required type="datetime-local" step="60" value={form.expiresAt} onChange={e=>change('expiresAt',e.target.value)}/></label>
   <label>Taxes and fees<input required maxLength={200} value={form.taxesFees} onChange={e=>change('taxesFees',e.target.value)} placeholder="Enter terms or Unknown"/></label>
   <label>Cancellation terms<input required maxLength={200} value={form.cancellationTerms} onChange={e=>change('cancellationTerms',e.target.value)} placeholder="Enter terms or Unknown"/></label>
  </div>{error&&<p role="alert" className="import-error">{error}</p>}<button type="submit" className="import-button">Add quote for review</button>
 </form></details>
}
