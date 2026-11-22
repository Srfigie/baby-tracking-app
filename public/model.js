export const HEADER=['id','started_at','kind','amount_ml','duration_minutes','detail','notes','created_at'];
export const TAB='BabyLog';
export const TIMER_HEADER=['left_seconds','right_seconds'];
export function elapsedLabel(when,now=Date.now()){if(!when)return 'No entries yet';const elapsed=now-Date.parse(when);const minutes=elapsed<0?0:Math.max(1,Math.floor(elapsed/60000));return `${Math.floor(minutes/60)}h ${minutes%60}m ago`;}
export function timerSeconds(timer,now=Date.now()){return Math.max(0,Math.floor((timer.elapsed+(timer.started===null?0:now-timer.started))/1000));}
export function editRowIndex(values,original){const matches=values.map((r,i)=>r[0]===original[0]?i:-1).filter(i=>i>0);if(matches.length!==1)throw Error('This entry was removed or its ID is duplicated. Refresh before editing.');const index=matches[0];if(Array.from({length:10},(_,i)=>String(values[index][i]??'')).join('\u0000')!==Array.from({length:10},(_,i)=>String(original[i]??'')).join('\u0000'))throw Error('This entry changed on another device. Cancel editing and refresh to see the latest version.');return index+1;}
export const ML_PER_OZ=29.5735295625;
export function localInput(date=new Date()){return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}
export function isFeed(kind){return kind==='bottle'||kind==='nursing';}
export function wakeTime(entry){
  return entry.minutes ? new Date(Date.parse(entry.when)+entry.minutes*60000) : null;
}
export function checkSleepOverlap(rows,row){
  if(row[2]!=='sleep')return;
  const start=Date.parse(row[1]),end=row[4]===''?Infinity:start+row[4]*60000;
  if(rows.some(entry=>entry.kind==='sleep'&&entry.id!==row[0]&&Date.parse(entry.when)<end&&(wakeTime(entry)?.getTime()??Infinity)>start))
    throw Error('These times overlap another sleep entry. Check its bedtime and wake time.');
}
export function makeEntry(input,id=crypto.randomUUID()){
  if(!['bottle','nursing','pump','sleep'].includes(input.kind))throw Error('Choose a valid entry type.');
  const date=new Date(input.when);
  if(!input.when||!Number.isFinite(date.getTime())||date.getTime()>Date.now()+60000)throw Error('Choose a time that is not in the future.');
  if(typeof input.notes!=='string'||input.notes.length>500)throw Error('Notes must be 500 characters or fewer.');
  if(input.kind==='sleep'){
    if(!['nap','night'].includes(input.detail))throw Error('Choose nap or night sleep.');
    let minutes='';
    if(input.wake){
      const wake=new Date(input.wake);
      minutes=Math.round((wake-date)/60000);
      if(!Number.isFinite(minutes)||minutes<1||wake.getTime()>Date.now())throw Error('Choose a wake time after bedtime and no later than now.');
    }
    return [id,date.toISOString(),'sleep','',minutes,input.detail,input.notes,new Date().toISOString()];
  }
  if(!['ml','oz'].includes(input.unit))throw Error('Choose a valid unit.');
  const amount=Number(input.amount)*(input.unit==='oz'?ML_PER_OZ:1);
  if(input.kind!=='nursing'&&(!Number.isFinite(amount)||amount<=0||amount>5000))throw Error('Enter an amount between 0 and 5,000 mL.');
  const minutes=input.minutes===''?'':Number(input.minutes);
  if((input.kind==='nursing'&&minutes==='')||(minutes!==''&&(!Number.isInteger(minutes)||minutes<1||minutes>1440)))throw Error('Enter a duration from 1 to 1,440 minutes.');
  const allowed=input.kind==='bottle'?['breast milk','formula','mixed']:['left','right','both'];
  if(!allowed.includes(input.detail))throw Error('Choose a valid milk type or side.');
  return [id,date.toISOString(),input.kind,input.kind==='nursing'?'':Math.round(amount*100)/100,minutes,input.detail,input.notes,new Date().toISOString()];
}
export function parseRows(values=[]){
  if(!HEADER.every((v,i)=>values[0]?.[i]===v))throw Error('The BabyLog columns do not match. See the setup guide before changing the sheet.');
  const seen=new Set();
  const entries=[];
  for(const row of values.slice(1)){
    const [id,when,kind,amount,minutes,detail,notes]=row;
    if(!id||seen.has(id))continue;
    seen.add(id);
    if(!['bottle','nursing','pump','sleep'].includes(kind)||!Number.isFinite(Date.parse(when)))continue;
    if(kind==='sleep'){
      if(!['nap','night'].includes(detail))continue;
      if(minutes!=null&&minutes!==''&&(!Number.isSafeInteger(Number(minutes))||Number(minutes)<=0||
        !Number.isFinite(new Date(Date.parse(when)+Number(minutes)*60000).getTime())))continue;
    }
    entries.push({id,when,kind,amount:Number(amount)||0,minutes:Number(minutes)||0,detail:String(detail||''),
      notes:String(notes||''),left:Number(row[8])||0,right:Number(row[9])||0,raw:row.slice()});
  }
  return entries.sort((a,b)=>Date.parse(b.when)-Date.parse(a.when));
}
export function totals(rows,now=new Date()){return rows.filter(r=>new Date(r.when).toDateString()===now.toDateString()).reduce((s,r)=>{if(isFeed(r.kind))s.feeds++;if(r.kind==='bottle')s.bottle+=r.amount;if(r.kind==='pump')s.pump+=r.amount;return s;},{feeds:0,bottle:0,pump:0});}
export function volume(ml,unit){return `${new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(unit==='oz'?ml/ML_PER_OZ:ml)} ${unit==='oz'?'oz':'mL'}`;}
// Daily averages across the trailing 168 hours, including days with no entries.
export function rollingAverages(rows,now=new Date()){
  const end=now.getTime(),start=end-7*24*60*60*1000;
  const sum=rows.reduce((s,r)=>{
    const when=Date.parse(r.when);
    if(when<=start||when>end)return s;
    if(r.kind==='bottle'||r.kind==='nursing')s.feeds++;
    if(r.kind==='bottle')s.bottle+=r.amount;
    if(r.kind==='pump')s.pump+=r.amount;
    return s;
  },{feeds:0,bottle:0,pump:0});
  return {feeds:sum.feeds/7,bottle:sum.bottle/7,pump:sum.pump/7};
}
