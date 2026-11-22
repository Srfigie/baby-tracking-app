import {volume,wakeTime} from './model.js';
import {sleepSchedule,weeklyPatterns} from './patterns.js';

const $=id=>document.getElementById(id);
const timeFormat=new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'});
const dateFormat=new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric'});
const dayFormat=new Intl.DateTimeFormat(undefined,{weekday:'short',day:'numeric',month:'short'});
const weekdayFormat=new Intl.DateTimeFormat(undefined,{weekday:'short'});
const wallClockFormat=new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit',timeZone:'UTC'});
const number=new Intl.NumberFormat(undefined,{maximumFractionDigits:1});
const labels={nap:'Nap',night:'Night sleep',bottle:'Bottle',nursing:'Breastfeed',pump:'Pumping'};
let selectedDay=null;

function element(tag,content,className){
  const node=document.createElement(tag);
  if(content!==undefined)node.textContent=content;
  if(className)node.className=className;
  return node;
}
export function durationText(minutes){
  const rounded=Math.round(minutes),hours=Math.floor(rounded/60),rest=rounded%60;
  if(!hours)return rest+' min';
  return hours+'h'+(rest?' '+rest+'m':'');
}
function clockText(minutes){
  // Use a fixed UTC date to display a wall-clock average even on clock-change days.
  return wallClockFormat.format(new Date(minutes*60000));
}
function renderSchedule(rows,now){
  const {slots,forecast}=sleepSchedule(rows,now);
  const tableHost=$('scheduleTable');
  tableHost.replaceChildren();
  if(!slots.length)tableHost.append(element('p','Log a nap or night sleep to start your schedule.','small'));
  else{
    const table=element('table'),thead=table.createTHead(),head=thead.insertRow(),body=table.createTBody();
    table.setAttribute('aria-label','Average sleep and wake times over the last seven days');
    for(const title of ['Sleep','Avg. start','Avg. wake','Days'])head.append(element('th',title));
    for(const slot of slots){
      const row=body.insertRow(),label=element('th',slot.label);
      label.scope='row';
      row.append(label);
      row.insertCell().textContent=clockText(slot.start);
      const wake=row.insertCell();
      wake.textContent=slot.wake===null?'Pending':clockText(slot.wake);
      if(slot.wake!==null&&Math.floor(slot.wake/1440)>Math.floor(slot.start/1440))wake.append(element('small','next day'));
      if(slot.wakes&&slot.wakes<slot.days)wake.append(element('small',slot.wakes+' logged'));
      row.insertCell().textContent=slot.days;
    }
    tableHost.append(table);
  }
  if(forecast.state==='estimate'){
    const today=forecast.when.toDateString()===now.toDateString();
    $('napTime').textContent=forecast.due?'Around now · usually '+timeFormat.format(forecast.when):(today?'Today':'Tomorrow')+' around '+timeFormat.format(forecast.when);
    $('napBasis').textContent='Based on nap '+forecast.ordinal+' start times from '+forecast.samples+' days.';
  }else if(forecast.state==='asleep'){
    $('napTime').textContent=labels[forecast.entry.detail]+' in progress';
    $('napBasis').textContent='Add the wake time in Recent activity to see the next estimate.';
  }else{
    $('napTime').textContent='Learning your nap times';
    $('napBasis').textContent='Log naps on at least two different days to see an estimated start time.';
  }
}
function eventText(entry,unit){
  const start=new Date(entry.when),end=wakeTime(entry);
  const description=[timeFormat.format(start)];
  if(end){
    const time=(end.toDateString()===start.toDateString()?'':dateFormat.format(end)+' ')+timeFormat.format(end);
    description[0]+=' – '+time;
    description.push(durationText(entry.minutes));
  }else if(entry.kind==='sleep')description[0]+=' – ongoing';
  if(entry.amount)description.push(volume(entry.amount,unit));
  return labels[entry.kind==='sleep'?entry.detail:entry.kind]+' · '+dateFormat.format(start)+' '+description.join(' · ');
}
function renderTimeline(data,group,unit,chooseDay){
  const {days,hourlyDays}=data;
  const chosen=days.find(day=>day.start===selectedDay)??days[6];
  const trackRows=$('dayTracks');
  trackRows.replaceChildren();
  for(const day of days){
    const row=element('button',undefined,'dayRow');
    const date=dayFormat.format(day.start);
    row.type='button';
    row.setAttribute('aria-pressed',String(day===chosen));
    row.setAttribute('aria-label',date+', '+day.events.length+' entries');
    row.onclick=()=>chooseDay(day.start);
    const track=element('span',undefined,'timeTrack');
    track.setAttribute('aria-hidden','true');
    const laneEnds=[];
    for(const {entry,segments,ongoing} of day.events){
      for(const {left,right} of segments){
        let lane=laneEnds.findIndex(end=>end<=left);
        if(lane<0)lane=laneEnds.length;
        laneEnds[lane]=Math.max(right,left+8);
        const type=entry.kind==='sleep'?entry.detail:entry.kind;
        const bar=element('span',undefined,'timeBar '+type+(ongoing?' ongoing':'')+(left===right?' point':''));
        bar.style.left='min('+left/14.4+'%, calc(100% - 4px))';
        bar.style.width=(right-left)/14.4+'%';
        bar.style.top=(5+lane*12)+'px';
        bar.title=eventText(entry,unit);
        track.append(bar);
      }
    }
    track.style.height=Math.max(24,laneEnds.length*12+8)+'px';
    row.append(element('span',weekdayFormat.format(day.start)+' '+new Date(day.start).getDate(),'dayLabel'),track);
    trackRows.append(row);
  }
  const average=$('averageTrack');
  average.replaceChildren();
  const hours=hourlyDays.map((count,i)=>i+':00 – '+count+' of 7 days');
  average.setAttribute('aria-label','Activity by hour. '+hours.join(', '));
  hourlyDays.forEach((count,i)=>{
    const block=element('span');
    block.style.opacity=String(count?0.2+0.8*count/7:0);
    block.title=hours[i];
    average.append(block);
  });
  const legend=$('chartLegend');
  legend.replaceChildren();
  for(const type of group==='sleep'?['nap','night']:group==='feed'?['bottle','nursing']:['pump']){
    legend.append(element('span',labels[type],'legendItem '+type));
  }
  if(days.some(day=>day.events.some(event=>event.ongoing)))legend.append(element('span','Ongoing','legendItem ongoing'));
  $('dayTitle').textContent=dayFormat.format(chosen.start);
  const details=$('dayDetails');
  details.replaceChildren();
  for(const {entry} of chosen.events)details.append(element('li',eventText(entry,unit)));
  if(!chosen.events.length)details.append(element('li','No entries for this day.','muted'));
}
export function renderPatterns(rows,unit,now=new Date()){
  const group=$('patternGroup').value,sleep=group==='sleep';
  const data=weeklyPatterns(rows,group,now);
  $('patternsTitle').textContent=sleep?'Sleep schedule':group==='feed'?'Feeding patterns':'Pumping patterns';
  $('patternDates').textContent=dateFormat.format(data.days[0].start)+' – '+dateFormat.format(now)+' · Last 7 days';
  $('napForecast').hidden=$('scheduleSection').hidden=!sleep;
  if(sleep)renderSchedule(rows,now);
  const metrics=sleep?
    [['Sleep / day',durationText(data.sleepPerDay)],['Naps / day',number.format(data.napsPerDay)],['Avg. nap',data.meanDuration===null?'—':durationText(data.meanDuration)]]:
    [[group==='feed'?'Feeds / day':'Sessions / day',number.format(data.perDay)],[group==='feed'?'Bottle / day':'Pumped / day',volume(data.volumePerDay,unit)],['Avg. duration',data.meanDuration===null?'—':durationText(data.meanDuration)]];
  const stats=$('patternStats');
  $('statsHint').textContent='Daily averages include all seven days, including today. '+(sleep?'Sleep totals include ongoing sleep. Average nap length uses completed naps.':'Average duration uses sessions with a recorded length.');
  stats.replaceChildren();
  for(const [label,value] of metrics){
    const metric=element('div');
    metric.append(element('dt',label),element('dd',value));
    stats.append(metric);
  }
  function draw(){
    renderTimeline(data,group,unit,day=>{
      selectedDay=day;
      draw();
      $('dayTracks').querySelector('[aria-pressed=true]').focus({preventScroll:true});
    });
  }
  draw();
}
