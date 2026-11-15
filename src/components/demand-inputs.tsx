'use client';
import {useState} from 'react';
import {Activity} from 'lucide-react';
import {applyDemandInputs,demandFields,demandValues,type DemandEdits} from '@/lib/demand-inputs';
import {forecast,type Opportunity} from '@/lib/procurement-core';
export default function DemandInputs({items,onApply}:{items:Opportunity[];onApply:(updated:Opportunity)=>void}){
 const [selected,setSelected]=useState(''),[message,setMessage]=useState('');const item=items.find(i=>i.id===selected)??items[0];
 return <section className="panel demand-editor" aria-labelledby="demand-inputs-title"><div className="coverage-head"><div className="control-icon"><Activity size={18}/></div><div><h2 id="demand-inputs-title">Demand and risk inputs</h2><p>Adjust the assumptions used by your shared inventory plan.</p></div></div><p>Enter comparable product-period observations and assumptions manually. All values below flow into demand, allocation and risk calculations after you apply them. These inputs are not automatically retrieved, verified or calibrated.</p>
 <label className="demand-item">Inventory item<select aria-label="Inventory for demand inputs" value={item?.id??''} onChange={e=>{setSelected(e.target.value);setMessage('')}}>{items.map(i=><option key={i.id} value={i.id}>{i.name} · {i.period} · {i.id}</option>)}</select></label>
 {item?<DemandForm key={JSON.stringify(demandValues(item))+item.id} item={item} onDirty={()=>setMessage('')} onApply={updated=>{onApply(updated);setMessage(`Inputs applied to ${updated.name}. The plan and risk views have recalculated.`)}}/>:<p>No inventory items available. Import inventory first.</p>}{message&&<p className="contract-feedback" role="status">{message}</p>}
 <p className="coverage-foot"><strong>Important:</strong> Bookings and searches must be comparable and collected before the decision date. Conversion is an assumption, not automatically derived from counts. External signals must be entered manually; market context is separate. Existing stock, cancellations and sold-out effects are simplified. No supplier is contacted. Forecasts and profit remain unvalidated model estimates. Inputs stay in this tab until saved as a private plan.</p></section>;
}
function DemandForm({item,onApply,onDirty}:{item:Opportunity;onApply:(item:Opportunity)=>void;onDirty:()=>void}){
 const [values,setValues]=useState<DemandEdits>(()=>demandValues(item));const [error,setError]=useState('');
 function apply(){try{const updated=applyDemandInputs(item,values);onApply(updated);setError('')}catch(e){setError(e instanceof Error?e.message:'Invalid inputs.')}}
 return <><div className="demand-form-grid">{demandFields.map(f=><label key={f.key}>{f.label}{'optional' in f&&f.optional?' (optional)':''}<input aria-label={f.label} type="number" min={f.min} max={f.max} step={'integer' in f&&f.integer?'1':'any'} value={values[f.key]} onChange={e=>{setValues(v=>({...v,[f.key]:e.target.value}));onDirty()}}/><small>{f.help}</small></label>)}</div><div className="demand-apply"><button className="import-button" type="button" onClick={apply}>Apply demand inputs</button><span>Current modeled net demand at reference price: {forecast(item).toLocaleString('en-IN',{maximumFractionDigits:1})} {item.kind==='Hotel'?'room-nights':'seats'}.</span></div>{error&&<p className="import-error" role="alert">{error} No inputs were changed.</p>}</>;
}
