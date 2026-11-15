'use client';
import {useState} from 'react';
import {ArrowRight,BarChart3,CheckCircle2} from 'lucide-react';
import {compareBudgets,type BudgetTotals} from '@/lib/budget-comparison';
import type {Opportunity,PlanRow} from '@/lib/procurement-core';

const cash=(n:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(n);
const signed=(n:number)=>`${n>0?'+':''}${cash(n)}`;
type Result=ReturnType<typeof compareBudgets>;
export default function BudgetComparison({items,rows,budget,risk,asOf,source,blocked,onApply}:{items:Opportunity[];rows:PlanRow[];budget:number;risk:number;asOf:string;source:'synthetic'|'uploaded';blocked:boolean;onApply:(budget:number)=>void}){
 const [input,setInput]=useState(()=>String(Math.min(1e9,Math.round(budget*1.2))));
 const [saved,setSaved]=useState<{signature:string;budget:number;result:Result}|null>(null);
 const [error,setError]=useState('');const [notice,setNotice]=useState('');
 const signature=JSON.stringify({items,rows,budget,risk,asOf,source});
 const scenario=saved&&saved.signature===signature&&String(saved.budget)===input.trim()&&!blocked?saved.result:null;
 function compare(){
  if(blocked){setError('Apply the current budget and wait for live signals before comparing.');return}
  if(!/^\d+$/.test(input.trim())||!Number.isSafeInteger(Number(input))||Number(input)>1e9){setError('Enter a whole-number budget between ₹0 and ₹1,00,00,00,000.');return}
  try{const value=Number(input.trim());const result=compareBudgets(items,rows,budget,value,risk,asOf);setInput(String(value));setSaved({signature,budget:value,result});setError('');setNotice('');}
  catch(e){setError(e instanceof Error?e.message:'Could not compare budgets.');}
 }
 const metric=(label:string,key:keyof Pick<BudgetTotals,'spend'|'remaining'|'expectedProfit'|'lowProfit'|'unsoldExposure'>)=>scenario&&<div key={key}><span>{label}</span><strong>{cash(scenario.candidate[key])}</strong><small>Current: {cash(scenario.current[key])} · change {signed(scenario.candidate[key]-scenario.current[key])}</small></div>;
 return <section className="panel budget-compare" aria-labelledby="budget-comparison-title">
  <div className="budget-compare-head"><div className="control-icon"><BarChart3 size={18}/></div><div><h2 id="budget-comparison-title">What if your budget changes?</h2><p>Compare a second allocation across the same hotels, flights and travel periods before changing your plan.</p></div><span className="budget-compare-badge">{source==='synthetic'?'SYNTHETIC INPUTS':'USER-SUPPLIED INPUTS'}</span></div>
  <div className="budget-compare-body"><div className="budget-compare-controls"><label htmlFor="comparison-budget">Alternative maximum budget · INR<input id="comparison-budget" type="number" min="0" max="1000000000" step="1" inputMode="numeric" value={input} onChange={e=>{setInput(e.target.value);setError('');setNotice('')}}/><small>Current applied budget: {cash(budget)}</small></label><button className="import-button" type="button" onClick={compare} disabled={blocked}>Compare allocations <ArrowRight size={14}/></button></div>
  {blocked&&<p className="budget-compare-note">Apply any budget edits and wait for live signals before comparing.</p>}{error&&<p role="alert" className="budget-compare-error">{error}</p>}{notice&&<p role="status" className="budget-compare-notice"><CheckCircle2 size={14}/>{notice}</p>}
  {saved&&!scenario&&!blocked&&<p className="budget-compare-note">Plan or comparison input changed. Compare again before using these results.</p>}
  {scenario&&<div className="budget-compare-results" aria-live="polite"><div className="budget-compare-result-head"><div><h3>Alternative: {cash(scenario.candidate.budget)}</h3><p>Same risk setting, inventory and quote review date ({asOf} UTC).</p></div><span>MODEL COMPARISON</span></div>
   <div className="budget-compare-metrics">{metric('Allocated spend','spend')}{metric('Unallocated budget','remaining')}{metric('Expected profit','expectedProfit')}{metric('Low-scenario profit','lowProfit')}{metric('Expected unsold exposure','unsoldExposure')}</div>
   <div className="budget-compare-units"><div><span>Hotel room-nights</span><strong>{scenario.current.hotelUnits.toLocaleString('en-IN')} → {scenario.candidate.hotelUnits.toLocaleString('en-IN')}</strong></div><div><span>Flight seats</span><strong>{scenario.current.flightUnits.toLocaleString('en-IN')} → {scenario.candidate.flightUnits.toLocaleString('en-IN')}</strong></div><div><span>Selected opportunities</span><strong>{scenario.current.selected} → {scenario.candidate.selected}</strong></div></div>
   <details className="budget-compare-details"><summary>See allocation changes ({scenario.changes.length})</summary>{scenario.changes.length?<ul>{scenario.changes.map(row=><li key={row.id}><div><strong>{row.name}</strong><span>{row.destination} · {row.kind} · {row.period}</span></div><div><b>{row.before} → {row.after} {row.kind==='Hotel'?'room-nights':'seats'}</b><span>Scenario sale price {cash(row.price)} · {row.timing}</span></div></li>)}</ul>:<p>No quantities changed. Modeled selling prices can still differ between scenarios.</p>}</details>
   <button className="outline-button" type="button" onClick={()=>{if(!scenario||!saved)return;onApply(saved.budget);setSaved(null);setNotice('Alternative budget applied to the plan. No purchase was made.')}}>Use this budget in my plan</button>
  </div>}
  <p className="budget-compare-disclaimer"><strong>Scenario, not a purchase instruction.</strong> The optimizer reallocates before buying; this is not a committed-order stress test. Demand, prices, profit, cancellation and recovery are assumptions—not validated forecasts. Low profit combines each item’s low-demand case, not a probability or guarantee. Unsold exposure excludes fixed fees. Taxes and supplier terms may be incomplete. A larger budget does not guarantee a better result. No supplier is contacted.</p></div>
 </section>;
}
