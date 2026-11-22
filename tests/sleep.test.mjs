import test from 'node:test';
import assert from 'node:assert/strict';
import {HEADER,makeEntry,parseRows,wakeTime,totals,checkSleepOverlap} from '../public/model.js';
import {weeklyPatterns,sleepSchedule} from '../public/patterns.js';

const now=new Date(2025,0,10,12);
const at=(day,hour,minute=0)=>new Date(2025,0,day,hour,minute).toISOString();
const nap=(day,hour,minutes=60)=>({when:at(day,hour),minutes,kind:'sleep',detail:'nap',amount:0});
const night=(day,hour,minutes)=>({...nap(day,hour,minutes),detail:'night'});
const input={kind:'sleep',detail:'night',when:at(8,21),notes:'Settled after a feed'};

test('sleep can be saved open, reloaded, closed overnight, and corrected with the same ID',()=>{
  const open=makeEntry(input,'sleep-id');
  assert.equal(open[4],'');
  const closed=makeEntry({...input,wake:at(9,6)},open[0]);
  const corrected=makeEntry({...input,wake:at(9,7)},open[0]);
  for(const [row,wake] of [[open,null],[closed,at(9,6)],[corrected,at(9,7)]]){
    const [entry]=parseRows([HEADER,row]);
    assert.equal(wakeTime(entry)?.toISOString()??null,wake);
    assert.equal(totals([entry],new Date(input.when)).feeds,0);
  }
  for(const change of [{wake:input.when},{wake:at(8,20)},{wake:'invalid'},{wake:'2999-01-01'},{detail:'both'}]){
    assert.throws(()=>makeEntry({...input,...change}));
  }
});
test('overlaps are rejected while edits and adjoining sessions are allowed',()=>{
  const open=makeEntry(input,'a'),rows=parseRows([HEADER,open]);
  assert.throws(()=>checkSleepOverlap(rows,makeEntry({...input,when:at(9,9)},'b')),/overlap/);
  checkSleepOverlap(rows,makeEntry({...input,wake:at(9,6)},'a'));
  checkSleepOverlap(rows,makeEntry({...input,when:at(8,20),wake:at(8,21)},'b'));
});
test('seven local calendar rows clip nights at midnight and the week boundary, and open naps at now',()=>{
  const data=weeklyPatterns([night(3,22,480),night(7,23,420),nap(10,11,0),nap(11,2)],'sleep',now);
  assert.equal(data.days.length,7);
  assert.deepEqual(data.days.map(d=>d.events.length),[1,0,0,1,1,0,1]);
  assert.deepEqual(data.days[0].events[0].segments,[{left:0,right:360}]);
  assert.deepEqual(data.days[3].events[0].segments,[{left:1380,right:1440}]);
  assert.equal(data.days[6].events[0].ongoing,true);
  assert.equal(data.hourlyDays[0],2);
  assert.equal(data.hourlyDays[6],0);
  assert.equal(data.napsPerDay,1/7);
  assert.equal(data.sleepPerDay,(360+420+60)/7);
  assert.equal(data.meanDuration,null);
});
test('feeding and pumping use the same week and retain sessions without durations as points',()=>{
  const entry=(kind,amount,minutes)=>({...nap(10,8,minutes),kind,detail:'both',amount});
  const rows=[entry('bottle',70,0),entry('nursing',0,25),entry('pump',140,15),nap(10,9)];
  const feed=weeklyPatterns(rows,'feed',now),pump=weeklyPatterns(rows,'pump',now);
  assert.equal(feed.perDay,2/7);
  assert.equal(feed.volumePerDay,10);
  assert.equal(feed.meanDuration,25);
  assert.equal(feed.hourlyDays[8],1);
  assert.deepEqual(feed.days[6].events[0].segments,[{left:480,right:480}]);
  assert.equal(pump.perDay,1/7);
  assert.equal(pump.volumePerDay,20);
  assert.equal(pump.meanDuration,15);
});
test('the schedule separates nap order, averages cross-midnight nights, and reports sample sizes',()=>{
  const rows=[nap(3,7),nap(7,9),nap(7,14,40),nap(8,10),nap(8,15,20),
    night(7,23,120),night(8,2,240),night(9,1,360),nap(11,4)];
  const {slots,forecast}=sleepSchedule(rows,now);
  assert.deepEqual(slots,[
    {label:'Nap 1',start:570,wake:630,days:2,wakes:2},
    {label:'Nap 2',start:870,wake:900,days:2,wakes:2},
    {label:'Night sleep',start:1440,wake:1830,days:2,wakes:2}
  ]);
  assert.equal(forecast.when.toISOString(),at(10,14,30));
  assert.equal(forecast.samples,2);
  assert.equal(forecast.ordinal,2);
});
test('incomplete and sparse history are explicit and an elapsed last nap rolls forward to tomorrow',()=>{
  const active=sleepSchedule([nap(8,9),nap(9,9),nap(10,9,0)],now);
  assert.equal(active.forecast.state,'asleep');
  assert.equal(active.slots[0].wakes,2);
  assert.equal(active.slots[0].days,3);
  assert.equal(sleepSchedule([nap(9,9)],now).forecast.state,'learning');
  assert.equal(sleepSchedule([nap(8,9),nap(9,11)],now).forecast.when.toISOString(),at(11,10));
  assert.equal(sleepSchedule([nap(8,9),nap(9,11)],new Date(2025,0,10,10,5)).forecast.due,true);
  assert.deepEqual(sleepSchedule([],now).slots,[]);
});
test('clock-change days keep wall-clock positions and count actual elapsed sleep',()=>{
  const original=process.env.TZ;
  try{
    process.env.TZ='America/Chicago';
    for(const [month,day,hours,segments] of [[2,9,2,[[60,120],[180,240]]],[10,2,3,[[60,120],[60,180]]]]){
      const start=new Date(2025,month,day,1);
      const data=weeklyPatterns([{...nap(1,1),when:start.toISOString(),minutes:hours*60}],'sleep',new Date(2025,month,day,12));
      assert.deepEqual(data.days[6].events[0].segments.map(s=>[s.left,s.right]),segments);
      assert.equal(data.sleepPerDay,hours*60/7);
    }
  }finally{
    if(original===undefined)delete process.env.TZ;else process.env.TZ=original;
  }
});
