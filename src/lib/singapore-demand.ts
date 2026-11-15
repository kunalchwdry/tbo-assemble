/** Fixed retrospective protocol for Singapore monthly gross hotel lettings.
 * This is a research estimate of aggregate occupied room nights, not TBO demand.
 */
export type MonthRow={month:string;occupiedRoomNights:number};
export type DemandSnapshot={sourceLastUpdated:string;accessedAt:string;rows:MonthRow[]};
type Method='seasonal'|'lag3'|'blend';
export function addMonths(month:string,n:number):string {
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!Number.isInteger(n))throw Error('Invalid month');
 const [year,m]=month.split('-').map(Number),total=year*12+m-1+n;return `${Math.floor(total/12).toString().padStart(4,'0')}-${(total%12+1).toString().padStart(2,'0')}`;
}
function mapRows(rows:MonthRow[]){
 const result=new Map<string,number>();for(const row of rows){addMonths(row.month,0);if(result.has(row.month)||!Number.isSafeInteger(row.occupiedRoomNights)||row.occupiedRoomNights<0)throw Error('Invalid data');result.set(row.month,row.occupiedRoomNights)}return result;
}
function monthRange(first:string,last:string){const result:string[]=[];for(let m=first;m<=last;m=addMonths(m,1))result.push(m);return result}
const train=monthRange('2022-01','2023-12'),validation=monthRange('2024-01','2025-09'),holdout=monthRange('2025-10','2026-09');
function estimate(data:Map<string,number>,target:string,method:Method,weight:number){const season=data.get(addMonths(target,-12)),last=data.get(addMonths(target,-3));if(season===undefined||last===undefined)throw Error('Required month missing');return method==='seasonal'?season:method==='lag3'?last:weight*season+(1-weight)*last}
function scores(data:Map<string,number>,months:string[],method:Method,weight:number){return months.map(month=>{const actual=data.get(month);if(actual===undefined)throw Error('Missing outcome');const prediction=estimate(data,month,method,weight);return {month,actual,prediction,error:prediction-actual}})}
const mae=(points:{error:number}[])=>points.reduce((s,p)=>s+Math.abs(p.error),0)/points.length;
/** All parameter fitting and baseline selection happen before the final 12-month holdout.
 * Fixed split is by outcome month. Prior observed holdout months can be inputs only at lag >=3.
 * Public revised data do not prove historical release vintages; see documentation.
 */
export function evaluateSingapore(rows:MonthRow[]){
 const data=mapRows(rows);let weight=0,best=Infinity;
 for(let i=0;i<=20;i++){const w=i/20,v=mae(scores(data,train,'blend',w));if(v<best){best=v;weight=w}}
 const valSeason=mae(scores(data,validation,'seasonal',weight)),valLag=mae(scores(data,validation,'lag3',weight)),valBlend=mae(scores(data,validation,'blend',weight));
 const fallback:Method=valSeason<=valLag?'seasonal':'lag3';
 const testSeason=mae(scores(data,holdout,'seasonal',weight)),testLag=mae(scores(data,holdout,'lag3',weight)),testBlend=mae(scores(data,holdout,'blend',weight));
 const passed=valBlend<.95*valSeason&&valBlend<.95*valLag&&testBlend<.95*testSeason&&testBlend<.95*testLag;
 const chosen:Method=passed?'blend':fallback;
 const calibration=scores(data,validation,chosen,weight).map(p=>Math.abs(p.error)).sort((a,b)=>a-b);const radius=calibration[Math.ceil((calibration.length+1)*.8)-1];
 const examples=scores(data,holdout,chosen,weight).map(p=>({...p,lower:Math.max(0,p.prediction-radius),upper:p.prediction+radius}));
 const coverage=examples.filter(p=>p.actual>=p.lower&&p.actual<=p.upper).length/examples.length;
 return {weight,passed,chosen,fallback,validation:{seasonal:valSeason,lag3:valLag,blend:valBlend,count:validation.length},holdout:{seasonal:testSeason,lag3:testLag,blend:testBlend,count:holdout.length,coverage,examples},radius,trainCount:train.length};
}
export function singaporeForecast(snapshot:DemandSnapshot,now:number){
 const ev=evaluateSingapore(snapshot.rows);const data=mapRows(snapshot.rows),last=[...data.keys()].sort().at(-1)!;
 if(!Number.isFinite(now))return {state:'clock' as const,ev,last};
 const capture=Date.parse(snapshot.accessedAt),release=Date.parse(snapshot.sourceLastUpdated+'T00:00:00Z');
 if(!Number.isFinite(capture)||!Number.isFinite(release)||capture>now||release>now||Date.parse(last+'-01T00:00:00Z')>now)return {state:'clock' as const,ev,last};
 const today=new Date(now).toISOString(),current=today.slice(0,7),target=addMonths(current,1);
 // For a next-calendar-month forecast use no observation newer than target minus 3 months.
 // If the pinned snapshot is not at least this recent, suppress rather than extrapolate stale inputs.
 if(last<addMonths(target,-3)||last>=current)return {state:'stale' as const,ev,last,target};
 const observed=data.get(addMonths(target,-3)),prior=data.get(addMonths(target,-12));if(observed===undefined||prior===undefined)return {state:'stale' as const,ev,last,target};
 const prediction=estimate(data,target,ev.chosen,ev.weight);
 return {state:'ready' as const,ev,last,target,prediction,lower:Math.max(0,prediction-ev.radius),upper:prediction+ev.radius};
}
