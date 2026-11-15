import type {Opportunity} from './procurement-core';
/** Fixed queries prevent user input from consuming arbitrary third-party quota. */
export const trendsPresets=[
 {id:'goa-hotels',query:'Goa hotels',destination:'Goa',kind:'Hotel',label:'Goa hotels'},
 {id:'jaipur-hotels',query:'Jaipur hotels',destination:'Jaipur',kind:'Hotel',label:'Jaipur hotels'},
 {id:'kerala-hotels',query:'Kerala hotels',destination:'Kerala',kind:'Hotel',label:'Kerala hotels'},
 {id:'dubai-hotels',query:'Dubai hotels',destination:'Dubai',kind:'Hotel',label:'Dubai hotels'},
 {id:'bali-hotels',query:'Bali hotels',destination:'Bali',kind:'Hotel',label:'Bali hotels'},
 {id:'bangkok-hotels',query:'Bangkok hotels',destination:'Bangkok',kind:'Hotel',label:'Bangkok hotels'},
 {id:'delhi-dubai-flights',query:'Delhi to Dubai flights',destination:'Dubai',kind:'Flight',label:'Delhi → Dubai flights',origin:'delhi'},
 {id:'mumbai-singapore-flights',query:'Mumbai to Singapore flights',destination:'Singapore',kind:'Flight',label:'Mumbai → Singapore flights',origin:'mumbai'},
] as const;
export type TrendsPreset=typeof trendsPresets[number];
export type TrendsSample={presetId:string;query:string;geo:'IN';source:'Google Trends via SerpApi';fetchedAt:string;days:{date:string;value:number}[]};
export const findTrendsPreset=(id:string)=>trendsPresets.find(p=>p.id===id);
const validDate=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
/** Reject duplicate, partial, malformed and non-daily points rather than inventing data. */
export function parseGoogleTrends(raw:unknown,preset:TrendsPreset,now:number):TrendsSample{
 if(!Number.isFinite(now)||!raw||typeof raw!=='object')throw Error('invalid data');
 const obj=raw as {interest_over_time?:{timeline_data?:unknown}};const points=obj.interest_over_time?.timeline_data;if(!Array.isArray(points))throw Error('missing data');
 const today=new Date(now).toISOString().slice(0,10);const seen=new Set<string>();const days:{date:string;value:number}[]=[];
 for(const p of points){if(!p||typeof p!=='object')throw Error('invalid point');if(p.isPartial===true||p.is_partial===true)continue;const ts=Number(p.timestamp);if(!Number.isFinite(ts)||ts<946684800||ts>4102444800)throw Error('invalid timestamp');const date=new Date(ts*1000).toISOString().slice(0,10);if(date>=today)continue;const v=p.values?.[0];if(!v||v.query!==preset.query||typeof v.extracted_value!=='number'||!Number.isInteger(v.extracted_value)||v.extracted_value<0||v.extracted_value>100)throw Error('invalid value');if(seen.has(date))throw Error('duplicate date');seen.add(date);days.push({date,value:v.extracted_value});}
 days.sort((a,b)=>a.date.localeCompare(b.date));const recent=days.slice(-28);if(recent.length<14)throw Error('not enough daily data');for(let i=1;i<recent.length;i++)if(Date.parse(recent[i].date)-Date.parse(recent[i-1].date)!==86400000)throw Error('missing day');
 return {presetId:preset.id,query:preset.query,geo:'IN',source:'Google Trends via SerpApi',fetchedAt:new Date(now).toISOString(),days:recent};
}
export function trendsAdjustment(sample:TrendsSample|undefined,item:Opportunity|undefined,asOf:string,now:number){
 if(!sample||!item||!Number.isFinite(now))return null;const p=findTrendsPreset(sample.presetId);if(!p||sample.query!==p.query||sample.geo!=='IN'||sample.source!=='Google Trends via SerpApi'||item.kind!==p.kind||item.destination.toLowerCase()!==p.destination.toLowerCase())return null;
 if('origin' in p&&!item.name.toLowerCase().includes(p.origin))return null;
 const today=new Date(now).toISOString().slice(0,10),fetched=Date.parse(sample.fetchedAt),last=sample.days.at(-1)?.date;
 if(asOf!==today||!Number.isFinite(fetched)||fetched>now+300000||now-fetched>26*3600000||!last||!validDate(last)||last>=today||(Date.parse(today)-Date.parse(last))/86400000>3||sample.days.length<14||sample.days.length>28)return null;
 for(let i=0;i<sample.days.length;i++){const d=sample.days[i];if(!validDate(d.date)||!Number.isInteger(d.value)||d.value<0||d.value>100||(i>0&&Date.parse(d.date)-Date.parse(sample.days[i-1].date)!==86400000))return null;}
 const prev=sample.days.slice(-14,-7).reduce((s,d)=>s+d.value,0),recent=sample.days.slice(-7).reduce((s,d)=>s+d.value,0);if(prev<35)return null;
 const change=recent/prev-1;return {previous:prev/7,recent:recent/7,change,factor:1+Math.max(-.10,Math.min(.10,change*.10)),latest:last};
}
