import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const header=['id','started_at','kind','amount_ml','duration_minutes','detail','notes','created_at','left_seconds','right_seconds'];
function backend(initial=[header]){
  let values=structuredClone(initial),writes=0,locks=0;
  const context=vm.createContext({
    PropertiesService:{getScriptProperties:()=>({getProperty:n=>n==='ACCESS_KEY'?'a'.repeat(64):'TEST_SHEET'})},
    LockService:{getScriptLock:()=>({waitLock:()=>locks++,hasLock:()=>true,releaseLock:()=>locks--})},
    SpreadsheetApp:{openById:()=>({getSheetByName:()=>({})})},
    ContentService:{MimeType:{JSON:'json'},createTextOutput:body=>({setMimeType:()=>JSON.parse(body)})},
    Sheets:{Spreadsheets:{Values:{get:()=>({values:structuredClone(values)}),append:body=>{writes++;values.push(...structuredClone(body.values));},update:(body,id,range)=>{writes++;if(range.includes('I1:J1'))values[0]=header;else values[Number(range.match(/A(\d+)/)[1])-1]=structuredClone(body.values[0]);}}}},
  });
  vm.runInContext(fs.readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8'),context);
  return {call:(action,data={})=>context.doPost({postData:{contents:JSON.stringify({key:'a'.repeat(64),action,...data})}}),get values(){return values;},get writes(){return writes;},get locks(){return locks;}};
}
const entry=()=>['test-id',new Date().toISOString(),'bottle',60,'','breast milk','=literal note',new Date().toISOString(),'',''];
test('key and action validation run before writes',()=>{
  const b=backend();assert.equal(b.call('read',{key:'bad'}).code,'unauthorized');assert.equal(b.call('delete').ok,false);assert.equal(b.writes,0);assert.equal(b.locks,0);
});
test('append is idempotent, validates input, and preserves literal notes',()=>{
  const b=backend(),row=entry();assert.equal(b.call('append',{row}).ok,true);assert.equal(b.call('append',{row}).ok,true);assert.equal(b.writes,1);assert.equal(b.values[1][6],'=literal note');
  assert.equal(b.call('append',{row:[...row.slice(0,3),-1,...row.slice(4)]}).ok,false);
  const changed=row.slice();changed[6]='different';assert.equal(b.call('append',{row:changed}).ok,false);assert.equal(b.writes,1);assert.equal(b.locks,0);
});
test('edits check original contents under lock and preserve creation time',()=>{
  const row=entry(),b=backend([header,row]),changed=row.slice();changed[6]='new';assert.equal(b.call('edit',{row:changed,original:row}).ok,true);
  assert.equal(b.call('edit',{row,original:row}).ok,false);assert.equal(b.values[1][6],'new');assert.equal(b.writes,1);assert.equal(b.locks,0);
});
test('header mismatch is rejected and old logs upgrade only empty timer columns',()=>{
  const bad=backend([['unrelated']]);assert.equal(bad.call('read').ok,false);assert.equal(bad.writes,0);
  const old=backend([header.slice(0,8)]);assert.equal(old.call('read').ok,true);assert.deepEqual(old.values[0],header);
  const occupied=backend([[...header.slice(0,8),'occupied']]);assert.equal(occupied.call('read').ok,false);assert.equal(occupied.writes,0);
});
test('sleep uses the existing columns and rejects overlaps and conflicting wake-time edits under lock',()=>{
  const b=backend();
  assert.equal(b.call('read').supportsSleep,true);
  const open=['night','2025-01-01T23:00:00Z','sleep','','','night','','2025-01-01T23:00:00Z','',''];
  const closed=open.slice();closed[4]=420;
  assert.equal(b.call('append',{row:open}).ok,true);
  assert.equal(b.call('append',{row:open}).ok,true);
  assert.match(b.call('append',{row:['another',...open.slice(1)]}).error,/overlap/);
  assert.equal(b.call('edit',{original:open,row:closed}).ok,true);
  assert.match(b.call('edit',{original:open,row:open}).error,/changed/);
  for(const [i,value] of [[4,-1],[4,1.5],[4,9999999999],[3,10],[5,'left'],[8,50]]){
    const bad=closed.slice();bad[i]=value;
    assert.equal(b.call('edit',{original:closed,row:bad}).ok,false);
  }
  assert.equal(b.writes,2);
  assert.equal(b.locks,0);
});
