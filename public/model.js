export const HEADER=['id','started_at','kind','amount_ml','duration_minutes','detail','notes','created_at'];
export const TAB='BabyLog';
export const TIMER_HEADER=['left_seconds','right_seconds'];
export function elapsedLabel(when,now=Date.now()){if(!when)return 'No entries yet';const minutes=Math.max(0,Math.floor((now-Date.parse(when))/60000));return `${Math.floor(minutes/60)}h ${minutes%60}m ago`;}
export function timerSeconds(timer,now=Date.now()){return Math.max(0,Math.floor((timer.elapsed+(timer.started===null?0:now-timer.started))/1000));}
export function editRowIndex(values,original){const matches=values.map((r,i)=>r[0]===original[0]?i:-1).filter(i=>i>0);if(matches.length!==1)throw Error('This entry was removed or its ID is duplicated. Refresh before editing.');const index=matches[0];if(Array.from({length:10},(_,i)=>String(values[index][i]??'')).join('\u0000')!==Array.from({length:10},(_,i)=>String(original[i]??'')).join('\u0000'))throw Error('This entry changed on another device. Cancel editing and refresh to see the latest version.');return index+1;}
export const ML_PER_OZ=29.5735295625;
export function localInput(date=new Date()){return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}
export function makeEntry(input,id=crypto.randomUUID()){
  if(!['bottle','nursing','pump'].includes(input.kind))throw Error('Choose a valid entry type.');
  const date=new Date(input.when);
  if(!input.when||!Number.isFinite(date.getTime())||date.getTime()>Date.now()+60000)throw Error('Choose a time that is not in the future.');
  if(!['ml','oz'].includes(input.unit))throw Error('Choose a valid unit.');
  const amount=Number(input.amount)*(input.unit==='oz'?ML_PER_OZ:1);
  if(input.kind!=='nursing'&&(!Number.isFinite(amount)||amount<=0||amount>5000))throw Error('Enter an amount between 0 and 5,000 mL.');
  const minutes=input.minutes===''?'':Number(input.minutes);
  if((input.kind==='nursing'&&minutes==='')||(minutes!==''&&(!Number.isInteger(minutes)||minutes<1||minutes>1440)))throw Error('Enter a duration from 1 to 1,440 minutes.');
  const allowed=input.kind==='bottle'?['breast milk','formula','mixed']:['left','right','both'];
  if(!allowed.includes(input.detail))throw Error('Choose a valid milk type or side.');
  if(typeof input.notes!=='string'||input.notes.length>500)throw Error('Notes must be 500 characters or fewer.');
  return [id,date.toISOString(),input.kind,input.kind==='nursing'?'':Math.round(amount*100)/100,minutes,input.detail,input.notes,new Date().toISOString()];
}
export function parseRows(values=[]){
  if(!HEADER.every((v,i)=>values[0]?.[i]===v))throw Error('The BabyLog columns do not match. See the setup guide before changing the sheet.');
  const seen=new Set();
  return values.slice(1).filter(r=>r[0]&&!seen.has(r[0])&&seen.add(r[0])&&['bottle','nursing','pump'].includes(r[2])&&Number.isFinite(Date.parse(r[1]))).map(r=>({id:r[0],when:r[1],kind:r[2],amount:Number(r[3])||0,minutes:Number(r[4])||0,detail:String(r[5]||''),notes:String(r[6]||''),left:Number(r[8])||0,right:Number(r[9])||0,raw:r.slice()})).sort((a,b)=>Date.parse(b.when)-Date.parse(a.when));
}
export function totals(rows,now=new Date()){return rows.filter(r=>new Date(r.when).toDateString()===now.toDateString()).reduce((s,r)=>{if(r.kind!=='pump')s.feeds++;if(r.kind==='bottle')s.bottle+=r.amount;if(r.kind==='pump')s.pump+=r.amount;return s;},{feeds:0,bottle:0,pump:0});}
export function volume(ml,unit){return `${new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(unit==='oz'?ml/ML_PER_OZ:ml)} ${unit==='oz'?'oz':'mL'}`;}
