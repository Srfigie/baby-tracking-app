import {isFeed} from './model.js';

const MINUTE=60000;
function midnight(date,offset=0){
  return new Date(date.getFullYear(),date.getMonth(),date.getDate()+offset);
}
function wallMinute(time){
  const date=new Date(time);
  return date.getHours()*60+date.getMinutes()+date.getSeconds()/60+date.getMilliseconds()/MINUTE;
}
// A clock change can skip or repeat an hour within a single chart row.
function clockSegments(start,end){
  const segments=[];
  function add(from,to){
    const left=wallMinute(from);
    segments.push({left,right:left+(to-from)/MINUTE});
  }
  if(end>start && new Date(start).getTimezoneOffset()!==new Date(end-1).getTimezoneOffset()){
    let low=start,high=end-1;
    const offset=new Date(start).getTimezoneOffset();
    while(high-low>1){
      const mid=Math.floor((low+high)/2);
      if(new Date(mid).getTimezoneOffset()===offset)low=mid;
      else high=mid;
    }
    add(start,high);
    add(high,end);
  }else add(start,end);
  return segments;
}

export function weeklyPatterns(rows,group,now=new Date()){
  const days=Array.from({length:7},(_,i)=>({
    start:midnight(now,i-6).getTime(),end:midnight(now,i-5).getTime(),events:[],hours:new Set()
  }));
  let count=0,amount=0,naps=0,sleepMinutes=0,durationSum=0,durationCount=0;
  for(const entry of rows){
    if(group==='feed' ? !isFeed(entry.kind) : entry.kind!==group)continue;
    const start=Date.parse(entry.when);
    if(!Number.isFinite(start)||start>now)continue;
    const ongoing=entry.kind==='sleep'&&!entry.minutes;
    const end=ongoing ? now.getTime() : Math.min(now.getTime(),start+entry.minutes*MINUTE);
    if(start>=days[0].start){
      count++;
      amount+=entry.amount;
      if(entry.detail==='nap')naps++;
      if(entry.minutes>0 && (group!=='sleep'||entry.detail==='nap')){
        durationSum+=entry.minutes;
        durationCount++;
      }
    }
    for(const day of days){
      const from=Math.max(start,day.start),to=Math.min(end,day.end);
      if(from>=to && !(start===end&&start>=day.start&&start<day.end))continue;
      const segments=clockSegments(from,to);
      for(const {left,right} of segments){
        const lastHour=Math.min(23,Math.max(Math.floor(left/60),Math.ceil(right/60)-1));
        for(let hour=Math.floor(left/60);hour<=lastHour;hour++)day.hours.add(hour);
      }
      day.events.push({entry,segments,ongoing});
      if(group==='sleep')sleepMinutes+=(to-from)/MINUTE;
    }
  }
  for(const day of days)day.events.sort((a,b)=>Date.parse(a.entry.when)-Date.parse(b.entry.when));
  const hourlyDays=Array.from({length:24},(_,hour)=>days.filter(day=>day.hours.has(hour)).length);
  return {days,hourlyDays,perDay:count/7,volumePerDay:amount/7,napsPerDay:naps/7,
    sleepPerDay:sleepMinutes/7,meanDuration:durationCount?durationSum/durationCount:null};
}

function average(values){
  return values.length?Math.round(values.reduce((sum,value)=>sum+value,0)/values.length):null;
}
// Use local calendar dates for wake times that fall on the following day.
function calendarDay(time){
  const date=new Date(time);
  return Date.UTC(date.getFullYear(),date.getMonth(),date.getDate())/86400000;
}
function typicalTimes(samples,night=false){
  const starts=[],wakes=[];
  for(const {start,end} of samples){
    const shift=night&&wallMinute(start)<720?1440:0;
    starts.push(wallMinute(start)+shift);
    if(end!==null)wakes.push(wallMinute(end)+shift+(calendarDay(end)-calendarDay(start))*1440);
  }
  return {start:average(starts),wake:average(wakes),days:starts.length,wakes:wakes.length};
}

export function sleepSchedule(rows,now=new Date()){
  const weekStart=midnight(now,-6).getTime(),today=midnight(now).getTime();
  const napsByDay=new Map(),nights=new Map();
  const sleep=rows.filter(entry=>entry.kind==='sleep'&&Date.parse(entry.when)<=now)
    .sort((a,b)=>Date.parse(a.when)-Date.parse(b.when));
  for(const entry of sleep){
    const start=Date.parse(entry.when);
    if(start<weekStart)continue;
    const end=entry.minutes?start+entry.minutes*MINUTE:null;
    const day=midnight(new Date(start)).getTime();
    if(entry.detail==='nap'){
      if(!napsByDay.has(day))napsByDay.set(day,[]);
      napsByDay.get(day).push({start,end});
    }else if(entry.detail==='night'){
      // After-midnight returns to bed belong to the preceding evening.
      const night=midnight(new Date(start),wallMinute(start)<720?-1:0).getTime();
      nights.set(night,{start:nights.get(night)?.start??start,end});
    }
  }
  const slots=[];
  const dailyNaps=[...napsByDay.values()];
  for(let i=0;dailyNaps.some(naps=>naps.length>i);i++){
    slots.push({label:'Nap '+(i+1),...typicalTimes(dailyNaps.filter(naps=>naps[i]).map(naps=>naps[i]))});
  }
  if(nights.size)slots.push({label:'Night sleep',...typicalTimes([...nights.values()],true)});
  const active=sleep.findLast(entry=>!entry.minutes);
  const forecast=active?{state:'asleep',entry:active}:estimateNap(napsByDay,today,now);
  return {slots,forecast};
}

function estimateNap(napsByDay,today,now){
  const todayCount=napsByDay.get(today)?.length||0;
  for(const offset of [0,1]){
    const target=midnight(now,offset);
    const previous=[...napsByDay].filter(([day])=>day<target.getTime()).map(([,naps])=>naps);
    for(let index=offset===0?todayCount:0; ;index++){
      const samples=previous.filter(naps=>naps.length>index).map(naps=>wallMinute(naps[index].start));
      if(samples.length<2)break;
      const minute=average(samples);
      const estimate=new Date(target);
      estimate.setMinutes(minute);
      const latest=new Date(target);
      latest.setMinutes(Math.floor(Math.max(...samples)),59,999);
      if(now<=latest)return {state:'estimate',when:estimate,due:estimate<now,samples:samples.length,ordinal:index+1};
    }
  }
  return {state:'learning'};
}
