import {HEADER,TIMER_HEADER,TAB,localInput,makeEntry,parseRows,totals,rollingAverages,volume,elapsedLabel,timerSeconds,editRowIndex,ML_PER_OZ,isFeed,wakeTime,checkSleepOverlap} from './model.js';
import {renderPatterns,durationText} from './patterns-view.js';
const $=id=>document.getElementById(id), SCOPE='https://www.googleapis.com/auth/drive.file', KEY='little-log.settings.v1';
const SESSION_KEY='little-log.session.v1';
let config={},token='',expires=0,epoch=0,timer,rows=[],kind=null,busy=false,ready=false,pending=null;
let activity='feed',editing=null,showPatterns=false,supportsSleep=false;
const nursing={left:{elapsed:0,started:null},right:{elapsed:0,started:null}};
let nursingStarted=false;
try{config=JSON.parse(localStorage.getItem(KEY)||'{}');if(!config||typeof config!=='object'||Array.isArray(config))config={};}catch{config={};}
if(!config.mode&&config.clientId)config.mode='google';
$('unit').value=config.unit==='oz'?'oz':'ml';
$('when').value=localInput();
$('dateLabel').textContent=new Intl.DateTimeFormat(undefined,{weekday:'long',month:'long',day:'numeric'}).format(new Date()).toUpperCase();
function say(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
function persist(){localStorage.setItem(KEY,JSON.stringify(config));}
const scriptMode=()=>config.mode==='script';
async function scriptApi(action,data={}){
  if(!config.scriptUrl||!config.accessKey)throw Error('Enter the Apps Script URL and access key in Settings.');
  const current=epoch;
  let result;
  try{
    const response=await fetch(config.scriptUrl,{method:'POST',credentials:'omit',redirect:'follow',cache:'no-store',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,key:config.accessKey,...data}),signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error();
    result=await response.json();
  }catch{throw Error('Could not reach Apps Script. Check internet and the /exec deployment URL; deploy with access set to Anyone. Refresh before retrying a save.');}
  if(current!==epoch)throw Error('Settings changed. Connect again.');
  if(!result.ok){
    if(result.code==='unauthorized')clearLog();
    const error=Error(result.error||'Apps Script request failed.');
    error.code=result.code;
    throw error;
  }
  return result;
}
function forgetSession(){try{sessionStorage.removeItem(SESSION_KEY);}catch{}}
function armSession(){
  clearTimeout(timer);
  timer=setTimeout(()=>{clearSession();say('Your Google session expired. Connect again to continue.');},Math.max(0,expires-Date.now()));
}
function restoreSession(){
  if(scriptMode()){run(load);return;}
  try{
    const saved=JSON.parse(sessionStorage.getItem(SESSION_KEY)||'null');
    if(!saved||saved.clientId!==config.clientId||typeof saved.token!=='string'||!saved.token||!Number.isFinite(saved.expires)||saved.expires<=Date.now()){forgetSession();return;}
    token=saved.token;expires=saved.expires;armSession();
    if(config.sheetId)run(()=>connectSheet(config.sheetId));else paint();
  }catch{forgetSession();}
}
function paint(){
  const connecting=busy&&!ready;
  $('connecting').hidden=!connecting;
  $('patternsButton').disabled=!ready;
  $('logView').hidden=ready&&showPatterns;
  $('patternsView').hidden=!ready||!showPatterns;
  $('tracker').hidden=!ready&&!nursingStarted;$('welcome').hidden=ready||connecting;$('signOut').hidden=!token;
  $('status').hidden=connecting;
  $('signIn').hidden=scriptMode()?ready:!!token;$('chooseSheet').hidden=scriptMode()||!token;
  $('signIn').textContent=scriptMode()?'Connect to shared log':'Connect with Google';
  $('connection').textContent=!navigator.onLine?'Offline':ready?'Shared sheet connected':token?'Choose your sheet':'Not connected';
  $('kindFields').disabled=busy; $('entryFields').disabled=busy; $('save').disabled=!ready||!navigator.onLine; $('cancelEdit').disabled=busy;
  $('refresh').disabled=$('patternRefresh').disabled=busy||!ready||!navigator.onLine;
  for(const button of document.querySelectorAll('.editButton')){
    button.disabled=busy||!!pending||(button.classList.contains('wakeNow')&&!navigator.onLine);
  }
  for(const id of ['signIn','chooseSheet','settingsButton','signOut'])$(id).disabled=busy;
}
function clearLog(){
  rows=[];
  ready=supportsSleep=false;
  $('entries').replaceChildren();
  $('feedCount').textContent='0';
  $('bottleTotal').textContent=$('pumpTotal').textContent=volume(0,$('unit').value);
  $('synced').textContent='';
  $('sheetLink').removeAttribute('href');
  $('patternGroup').value='sleep';
  renderPatterns(rows,$('unit').value);
  renderAverages();
  updateSince();
}
function clearSession(){forgetSession();epoch++;clearTimeout(timer);token='';expires=0;clearLog();if(!nursingStarted&&!editing&&!pending){$('entryForm').reset();$('when').value=localInput();$('unit').value=config.unit==='oz'?'oz':'ml';setKind(null);}paint();}
function requireSession(){if(scriptMode()){if(!config.accessKey)throw Error('Enter your access key in Settings.');return;}if(!token||Date.now()>=expires){clearSession();throw Error('Your Google session expired. Connect again to continue.');}}
async function run(fn){if(busy)return;busy=true;paint();try{await fn();}catch(error){say(error.message||'Something went wrong. Please try again.',true);}finally{busy=false;paint();}}
async function api(url,options={}){
  requireSession();const current=epoch;
  let response;
  try{response=await fetch(url,{...options,cache:'no-store',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(20000)});}catch{throw Error('Could not reach Google. Check your connection, then refresh before retrying a save.');}
  if(current!==epoch)throw Error('Session changed. Connect again.');
  if(response.status===401){clearSession();throw Error('Your Google session expired. Connect again.');}
  if(response.status===403){clearLog();throw Error('Google denied access. Use an account with Editor access, enable the required APIs, and choose the shared sheet again.');}
  if(response.status===404){const stage=url.includes('/drive/v3/files/')?'checking file access in Google Drive':url.includes('/values/')?'reading or writing the BabyLog tab':'opening the spreadsheet in Google Sheets';throw Error('Google could not find or grant access to this file while '+stage+' (404). Choose the sheet again using an account that can edit it.');}
  if(!response.ok)throw Error(response.status===429?'Google is busy. Wait a moment, then refresh.':`Google request failed (${response.status}). Refresh before retrying.`);
  return response.json();
}
function sheetBase(id=config.sheetId){if(!/^[a-zA-Z0-9_-]+$/.test(id||''))throw Error('Choose a Google Sheet first.');return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}`;}
const range=encodeURIComponent(`'${TAB}'!A:J`);
async function load(){
  const result=scriptMode()?await scriptApi('read'):await api(`${sheetBase()}/values/${range}`);
  if(scriptMode())config.sheetId=result.sheetId;
  supportsSleep=!scriptMode()||result.supportsSleep===true;
  rows=parseRows(result.values);ready=true;render();say('Your shared log is up to date.');
}
async function connectSheet(id){
  const base=sheetBase(id);
  const access=await api(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=capabilities(canEdit),mimeType`);
  if(access.mimeType!=='application/vnd.google-apps.spreadsheet')throw Error('Choose a native Google Sheet. For an Excel file, open it in Google Sheets and use File > Save as Google Sheets, then choose the converted file.');
  if(!access.capabilities?.canEdit)throw Error('This Google account needs Editor access to the shared sheet.');
  const meta=await api(`${base}?fields=sheets.properties.title`);
  if(!meta.sheets.some(s=>s.properties.title===TAB)){
    try{await api(`${base}:batchUpdate`,{method:'POST',body:JSON.stringify({requests:[{addSheet:{properties:{title:TAB}}}]})});}
    catch(error){const again=await api(`${base}?fields=sheets.properties.title`);if(!again.sheets.some(s=>s.properties.title===TAB))throw error;}
  }
  const existing=await api(`${base}/values/${range}`);
  if(!existing.values?.length)await api(`${base}/values/${encodeURIComponent(`'${TAB}'!A1:J1`)}?valueInputOption=RAW`,{method:'PUT',body:JSON.stringify({values:[[...HEADER,...TIMER_HEADER]]})});
  else {
    parseRows(existing.values);
    const extra=existing.values[0].slice(8,10);
    if(extra.every((v,i)=>v===TIMER_HEADER[i])&&extra.length===2){}
    else if(existing.values.every(row=>!row[8]&&!row[9]))await api(`${base}/values/${encodeURIComponent(`'${TAB}'!I1:J1`)}?valueInputOption=RAW`,{method:'PUT',body:JSON.stringify({values:[TIMER_HEADER]})});
    else throw Error('Columns I and J are already in use. Keep them free for left_seconds and right_seconds before connecting.');
  }
  config.sheetId=id;persist();await load();
}
function renderAverages(){
  const average=rollingAverages(rows),unit=$('unit').value;
  const feeds=new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(average.feeds);
  $('feedAverage').textContent=feeds+' feedings/day avg';
  $('bottleAverage').textContent=volume(average.bottle,unit)+'/day avg';
  $('pumpAverage').textContent=volume(average.pump,unit)+'/day avg';
}
function render(){
  const sum=totals(rows),unit=$('unit').value;
  renderAverages();
  $('feedCount').textContent=sum.feeds;$('bottleTotal').textContent=volume(sum.bottle,unit);$('pumpTotal').textContent=volume(sum.pump,unit);
  $('sheetLink').href=`https://docs.google.com/spreadsheets/d/${encodeURIComponent(config.sheetId)}/edit`;
  $('synced').textContent=`Updated ${new Date().toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})} · tap Refresh to update`;
  updateSince();
  if(showPatterns&&ready)renderPatterns(rows,unit);
  const visible=rows.filter(r=>activity==='feed'?isFeed(r.kind):r.kind===activity);
  $('entries').replaceChildren();
  if(!visible.length){const p=document.createElement('p');p.className='empty';p.textContent={sleep:'No sleep entries yet. Choose Sleep to log a nap or bedtime.',feed:'No feedings logged yet.',pump:'No pumping sessions logged yet.'}[activity];$('entries').append(p);}
  for(const entry of visible.slice(0,100)){
    const article=document.createElement('article');article.className=`entry ${entry.kind}`;
    const symbol=document.createElement('span');symbol.className='symbol';symbol.textContent={bottle:'B',nursing:'N',pump:'P',sleep:'S'}[entry.kind];symbol.setAttribute('aria-hidden','true');
    const body=document.createElement('div'), title=document.createElement('strong');
    const sleep=entry.kind==='sleep',wake=sleep?wakeTime(entry):null;
    title.textContent=sleep?(entry.detail==='nap'?'Nap':'Night sleep')+' · '+(wake?durationText(entry.minutes):'In progress'):({bottle:'Bottle',nursing:'Breastfeed',pump:'Pumping'}[entry.kind])+' · '+(entry.kind==='nursing'?`${entry.minutes} min`:volume(entry.amount,unit));
    const time=document.createElement('p');time.className='muted small';time.textContent=new Date(entry.when).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
    const detail=document.createElement('p');detail.className='small';detail.textContent=sleep?(wake?'Woke '+wake.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Wake time pending'):entry.detail+(entry.kind!=='nursing'&&entry.minutes?` · ${entry.minutes} min`:'');
    body.append(title,time,detail);
    if(entry.left||entry.right){const sides=document.createElement('p');sides.className='small';sides.textContent=`Left ${clock(entry.left)} · Right ${clock(entry.right)}`;body.append(sides);}
    const actions=document.createElement('div');
    actions.className='entryActions';
    const edit=document.createElement('button');
    edit.className='quiet editButton';
    edit.textContent=sleep&&!wake?'Set wake time':'Edit';
    const entryLabel=' · '+title.textContent+' '+time.textContent;
    edit.setAttribute('aria-label',edit.textContent+entryLabel);
    edit.onclick=()=>startEdit(entry);
    actions.append(edit);
    if(sleep&&entry.detail==='nap'&&!wake&&supportsSleep){
      const button=document.createElement('button');
      button.className='secondary editButton wakeNow';
      button.textContent='Wake Now';
      button.setAttribute('aria-label',button.textContent+entryLabel);
      button.onclick=()=>run(()=>wakeNapNow(entry));
      actions.append(button);
    }
    body.append(actions);
    if(entry.notes){const note=document.createElement('p');note.className='notes small';note.textContent=entry.notes;body.append(note);}
    article.append(symbol,body);$('entries').append(article);
  }
  if(visible.length>100){const p=document.createElement('p');p.textContent='Showing the latest 100 entries. All entries are in your sheet.';$('entries').append(p);}paint();
}
function setKind(value){
  if(value&&!kind&&!editing)$('when').value=localInput();
  kind=value;
  const sleep=kind==='sleep',hasAmount=kind==='bottle'||kind==='pump';
  $('entryForm').hidden=$('entryHint').hidden=!kind;
  for(const b of document.querySelectorAll('[data-kind]'))b.setAttribute('aria-pressed',String(b.dataset.kind===kind));
  $('amountFields').hidden=$('amount').disabled=!hasAmount;
  $('amount').required=hasAmount;
  $('milkField').hidden=kind!=='bottle';
  $('sideField').hidden=kind!=='nursing'&&kind!=='pump';
  $('whenLabel').textContent=sleep?'Bedtime':'When';
  $('sleepFields').hidden=$('wake').disabled=!sleep;
  $('durationField').hidden=$('minutes').disabled=sleep;
  $('nursingTimer').hidden=kind!=='nursing';
  $('minutes').required=kind==='nursing';
  $('minutes').placeholder=kind==='nursing'?'Minutes':'Optional';
  $('save').textContent=editing?'Save changes':{bottle:'Save bottle',nursing:'Save breastfeed',pump:'Save pumping session',sleep:'Save sleep'}[kind]||'Save entry';
}
for(const b of document.querySelectorAll('[data-kind]'))b.onclick=()=>{if(nursingStarted&&b.dataset.kind!=='nursing'){say('Save the breastfeeding session or reset its timers before switching type.',true);return;}setKind(b.dataset.kind);};
$('unit').onchange=()=>{config.unit=$('unit').value;try{persist();}catch{say('This browser could not remember your unit preference.',true);}if(ready)render();};
async function saveEdit(row,original){
  if(scriptMode()){
    await scriptApi('edit',{row,original});
    return;
  }
  const latest=await api(`${sheetBase()}/values/${range}`);
  const rowNumber=editRowIndex(latest.values,original);
  checkSleepOverlap(parseRows(latest.values),row);
  try{await api(`${sheetBase()}/values/${encodeURIComponent(`'${TAB}'!A${rowNumber}:J${rowNumber}`)}?valueInputOption=RAW`,{method:'PUT',body:JSON.stringify({values:[row]})});}
  catch(error){throw Error(error.message+' Edit not confirmed. Refresh and inspect the entry before retrying.');}
}
async function wakeNapNow(entry){
  if(editing?.id===entry.id)throw Error('Save or cancel your edits to this nap first.');
  // Sleep durations use whole minutes. Rounding up could put the wake time in the future.
  const minutes=Math.floor((Date.now()-Date.parse(entry.when))/60000);
  if(minutes<1)throw Error('The nap must be at least one minute long to record a wake time.');
  // Sheets omits trailing empty cells, while Apps Script expects all ten columns.
  const row=Array.from({length:10},(_,i)=>entry.raw[i]??'');
  row[4]=minutes;
  try{await saveEdit(row,entry.raw);}
  catch(error){
    if(!ready)throw error;
    // A rejected or unconfirmed edit may already have a wake time in the shared log.
    try{await load();}catch{throw error;}
    const latest=rows.find(r=>r.id===entry.id&&r.kind==='sleep'&&r.detail==='nap');
    if(!latest||!wakeTime(latest))throw error;
    say('This nap already has a wake time. Showing the saved time.');
    return;
  }
  try{await load();say('Wake time saved.');}
  catch(error){say('Wake time saved. '+error.message,true);}
}
$('entryForm').onsubmit=event=>{event.preventDefault();run(async()=>{
  requireSession();
  // Never automatically repeat an ambiguous append. Reconcile the previous ID first.
  if(pending){await load();if(rows.some(r=>r.id===pending[0])){if(pending[2]==='sleep')setActivity('sleep');pending=null;resetEntry();render();say('Your previous entry was saved.');return;}throw Error('The previous save could not be confirmed. Check the sheet before reloading this page and entering it again.');}
  if(kind==='nursing'&&nursingStarted){pauseNursing();updateNursing();}
  if(kind==='sleep'&&!supportsSleep)throw Error('Sleep logging needs the updated Apps Script. Ask the sheet owner to deploy the latest Code.gs, then tap Refresh.');
  const detail=kind==='sleep'?$('sleepType').value:kind==='bottle'?$('milk').value:$('side').value;
  const originalWake=editing?.kind==='sleep'?wakeTime(editing):null;
  const wake=originalWake&&localInput(originalWake)===$('wake').value?originalWake:$('wake').value;
  const when=kind==='sleep'&&editing&&localInput(new Date(editing.when))===$('when').value?editing.when:$('when').value;
  const row=makeEntry({kind,when,wake,amount:$('amount').value,unit:$('unit').value,minutes:$('minutes').value,detail,notes:$('notes').value},editing?.id);
  row.push(kind==='nursing'&&nursingStarted?timerSeconds(nursing.left):'',kind==='nursing'&&nursingStarted?timerSeconds(nursing.right):'');
  if(editing){
    row[7]=editing.raw[7];
    await saveEdit(row,editing.raw);
    resetEntry();await load();say('Changes saved to your shared sheet.');return;
  }
  if(kind==='sleep'&&!scriptMode()){
    const latest=await api(`${sheetBase()}/values/${range}`);
    checkSleepOverlap(parseRows(latest.values),row);
  }
  pending=row;
  try{if(scriptMode())await scriptApi('append',{row});else await api(`${sheetBase()}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,{method:'POST',body:JSON.stringify({values:[row]})});}
  catch(error){if(error.code==='sleep_overlap'){pending=null;throw error;}throw Error(`${error.message} Save not confirmed; press Save again to check, without sending a duplicate.`);}
  if(kind==='sleep')setActivity('sleep');
  pending=null;resetEntry();
  try{await load();say('Saved to your shared sheet.');}catch{say('Your entry was saved, but activity could not refresh. Do not enter it again; tap Refresh.',true);}
});};
function resetEntry(){editing=null;$('wake').value='';$('sleepType').value='nap';$('cancelEdit').hidden=true;$('formTitle').textContent='What are we logging?';resetNursing();setKind(null);$('amount').value='';$('minutes').value='';$('notes').value='';$('when').value=localInput();}
$('refresh').onclick=$('patternRefresh').onclick=()=>run(load);
$('signIn').onclick=()=>{
  if(scriptMode()){run(load);return;}
  if(!config.clientId||!config.apiKey||!config.projectNumber){openSettings();return;}
  if(!globalThis.google?.accounts?.oauth2){say('Google sign-in is still loading. Check your internet connection and try again.',true);return;}
  const attempt=epoch;
  const client=google.accounts.oauth2.initTokenClient({client_id:config.clientId,scope:SCOPE,include_granted_scopes:false,callback:response=>{
    if(attempt!==epoch)return;
    if(response.error||!response.access_token){say('Google access was not granted. Please try again.',true);return;}
    if(!google.accounts.oauth2.hasGrantedAllScopes(response,SCOPE)){say('Allow access to the sheet you select to use the log.',true);return;}
    token=response.access_token;expires=Date.now()+Math.max(0,Number(response.expires_in)*1000-60000);clearTimeout(timer);
    armSession();
    try{sessionStorage.setItem(SESSION_KEY,JSON.stringify({token,expires,clientId:config.clientId}));}catch{say('Connected, but browser storage is unavailable; refreshing will require reconnecting.',true);}
    paint();if(config.sheetId)run(()=>connectSheet(config.sheetId));else say('Connected. Choose your shared Google Sheet; a BabyLog tab will be added if needed.');
  },error_callback:()=>say('Sign-in was closed or blocked. Allow the Google pop-up and try again.',true)});
  client.requestAccessToken({prompt:'select_account'});
};
$('chooseSheet').onclick=()=>run(async()=>{
  requireSession();if(!globalThis.gapi)throw Error('Google Picker is still loading. Try again in a moment.');
  await new Promise((resolve,reject)=>gapi.load('picker',{callback:resolve,onerror:()=>reject(Error('Could not load Google Picker.')),timeout:15000,ontimeout:()=>reject(Error('Google Picker timed out.'))}));
  requireSession();const current=epoch;
  new google.picker.PickerBuilder().addView(new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS).setMode(google.picker.DocsViewMode.LIST)).setOAuthToken(token).setDeveloperKey(config.apiKey).setAppId(config.projectNumber).setOrigin(location.origin).setTitle('Choose your shared baby log sheet').setCallback(data=>{
    if(current!==epoch)return;
    if(data.action===google.picker.Action.PICKED)run(()=>connectSheet(data.docs[0].id));
  }).build().setVisible(true);
});
function openSettings(){if(nursingStarted||editing||pending){say('Save or cancel the current entry before changing settings.',true);return;}for(const id of ['clientId','projectNumber','apiKey','scriptUrl','accessKey'])$(id).value=config[id]||'';$('connectionMode').value=config.mode||'script';updateSettingsMode();$('settings').showModal();}
$('settingsButton').onclick=openSettings;$('closeSettings').onclick=()=>$('settings').close();
function updateSettingsMode(){const script=$('connectionMode').value==='script';$('scriptSettings').hidden=!script;$('googleSettings').hidden=script;for(const id of ['scriptUrl','accessKey'])$(id).required=script;for(const id of ['clientId','projectNumber','apiKey'])$(id).required=!script;}
$('connectionMode').onchange=updateSettingsMode;
$('settingsForm').onsubmit=event=>{
  event.preventDefault();const mode=$('connectionMode').value;
  let next={mode,unit:$('unit').value};
  if(mode==='script'){
    const scriptUrl=$('scriptUrl').value.trim(),accessKey=$('accessKey').value.trim();
    if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(scriptUrl)){say('Enter the deployed Apps Script URL ending in /exec.',true);return;}
    if(!/^[a-f0-9]{64}$/i.test(accessKey)){say('Enter the 64-character access key generated during script setup.',true);return;}
    next={...next,scriptUrl,accessKey};
  }else{
    const clientId=$('clientId').value.trim();
    if(!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)){say('Enter a valid Google OAuth web client ID.',true);return;}
    next={...next,clientId,projectNumber:$('projectNumber').value.trim(),apiKey:$('apiKey').value.trim(),...(config.clientId===clientId&&config.sheetId?{sheetId:config.sheetId}:{})};
  }
  try{localStorage.setItem(KEY,JSON.stringify(next));}catch{say('Browser storage is unavailable. Allow site storage to remember setup.',true);return;}
  clearSession();config=next;$('settings').close();if(scriptMode())run(load);else say('Settings saved on this phone. Connect with Google to continue.');
};
$('forget').onclick=()=>{clearSession();config={};localStorage.removeItem(KEY);$('settingsForm').reset();$('settings').close();say('Settings removed from this phone. Your Google Sheet has not changed.');};
$('signOut').onclick=()=>{if((nursingStarted||editing||pending)&&!confirm('Sign out and discard this unsaved session?'))return;resetEntry();pending=null;clearSession();say('Signed out of Milky Way. Your shared sheet is unchanged.');};
window.addEventListener('offline',()=>{paint();say('You are offline. Connect to the internet to refresh or save entries.',true);});
window.addEventListener('online',()=>{paint();say(ready?'Back online. Tap Refresh to update your shared log.':'Back online. Connect to your shared log to continue.');});
let workerRegistration;
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(reg=>{workerRegistration=reg;}).catch(()=>say('Offline installation is unavailable in this browser. You can still use the app online.'));
$('checkUpdate').onclick=async()=>{
  const message=$('updateStatus');
  if(busy||nursingStarted||editing||pending||kind==='sleep'||$('amount').value||$('minutes').value||$('notes').value){message.textContent='Save or cancel your current entry before updating.';return;}
  if(!navigator.onLine){message.textContent='Connect to the internet to update.';return;}
  $('checkUpdate').disabled=true;message.textContent='Checking for updates…';
  try{
    const reg=workerRegistration||await navigator.serviceWorker.getRegistration();
    if(!reg)throw Error('Updates are unavailable. Reopen the app online.');
    await reg.update();
    if(reg.installing)await new Promise((resolve,reject)=>{
      const worker=reg.installing;
      const timeout=setTimeout(()=>{worker.removeEventListener('statechange',changed);reject(Error('Update download timed out. Try again.'));},20000);
      function changed(){if(worker.state==='installed'||worker.state==='redundant'){clearTimeout(timeout);worker.removeEventListener('statechange',changed);worker.state==='installed'?resolve():reject(Error('Update download failed. Try again.'));}}
      worker.addEventListener('statechange',changed);changed();
    });
    if(reg.waiting){
      await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>{navigator.serviceWorker.removeEventListener('controllerchange',changed);reject(Error('Update activation timed out. Close and reopen the app.'));},10000);
        function changed(){clearTimeout(timeout);navigator.serviceWorker.removeEventListener('controllerchange',changed);resolve();}
        navigator.serviceWorker.addEventListener('controllerchange',changed);reg.waiting.postMessage({type:'ACTIVATE_UPDATE'});
      });
    }
    const url=new URL(location.href);url.searchParams.set('update',Date.now());location.replace(url.href);
  }catch(error){message.textContent=error.message||'Could not check for updates. Try again.';$('checkUpdate').disabled=false;}
};
if(document.modelContext?.registerTool){try{Promise.resolve(document.modelContext.registerTool({name:'refresh_shared_log',description:'Refresh the visible sleep, feeding and pumping activity from the connected Google Sheet.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:async input=>{if(!input||Object.keys(input).length)throw Error('No arguments expected.');if(busy||!ready)throw Error('Connect a sheet and wait for the current action first.');await run(load);return {connected:ready};}})).catch(()=>{});}catch{}}
paint();

function clock(seconds){return `${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;}
function updateSince(){$('lastFeed').textContent=elapsedLabel(rows.find(r=>isFeed(r.kind))?.when);$('lastPump').textContent=elapsedLabel(rows.find(r=>r.kind==='pump')?.when);}
function pauseNursing(){for(const side of ['left','right']){const t=nursing[side];if(t.started!==null){t.elapsed+=Date.now()-t.started;t.started=null;}}}
function updateNursing(){const left=timerSeconds(nursing.left),right=timerSeconds(nursing.right);$('leftClock').textContent=clock(left);$('rightClock').textContent=clock(right);$('timerTotal').textContent=clock(left+right);for(const side of ['left','right'])$(side+'Timer').textContent=(nursing[side].started===null?'Start ':'Pause ')+side;
  $('minutes').readOnly=kind==='nursing'&&nursingStarted;$('side').disabled=kind==='nursing'&&nursingStarted;
  if(kind==='nursing'&&nursingStarted){$('minutes').value=Math.max(1,Math.ceil((left+right)/60));$('side').value=left&&right?'both':right?'right':'left';}}
function resetNursing(){pauseNursing();for(const side of ['left','right'])nursing[side].elapsed=0;nursingStarted=false;updateNursing();}
for(const side of ['left','right'])$(side+'Timer').onclick=()=>{const active=nursing[side].started!==null;pauseNursing();if(!nursingStarted){nursingStarted=true;if(!editing)$('when').value=localInput();}if(!active)nursing[side].started=Date.now();updateNursing();};
$('resetTimer').onclick=()=>{if(nursingStarted&&!confirm('Reset both breast timers?'))return;resetNursing();$('minutes').value='';};
function startEdit(entry){
  if(busy)return;
  if(nursingStarted||editing||pending||$('wake').value||$('amount').value||$('minutes').value||$('notes').value){
    say('Save or cancel the current entry before editing another.',true);
    return;
  }
  editing={...entry,raw:entry.raw.slice()};
  setKind(entry.kind);
  $('formTitle').textContent='Edit entry';
  $('cancelEdit').hidden=false;
  $('when').value=localInput(new Date(entry.when));
  $('notes').value=entry.notes;
  if(entry.kind==='sleep'){
    $('sleepType').value=entry.detail;
    $('wake').value=localInput(wakeTime(entry)||new Date());
  }else{
    if(entry.kind!=='nursing')$('amount').value=config.unit==='oz'?entry.amount/ML_PER_OZ:entry.amount;
    $('minutes').value=entry.minutes||'';
    $(entry.kind==='bottle'?'milk':'side').value=entry.detail;
  }
  if(entry.left||entry.right){
    nursingStarted=true;
    nursing.left.elapsed=entry.left*1000;
    nursing.right.elapsed=entry.right*1000;
    updateNursing();
  }
  $('entryForm').scrollIntoView({behavior:'smooth',block:'start'});
}
$('cancelEdit').onclick=()=>{resetEntry();say('Editing cancelled.');};
function setActivity(value){
  activity=value;
  for(const tab of ['feed','pump','sleep'])$(tab+'Tab').setAttribute('aria-pressed',String(tab===value));
}
for(const tab of ['feed','pump','sleep'])$(tab+'Tab').onclick=()=>{setActivity(tab);render();};
function switchView(patterns){
  showPatterns=patterns;
  $('logViewButton').setAttribute('aria-pressed',String(!patterns));
  $('patternsButton').setAttribute('aria-pressed',String(patterns));
  if(patterns&&ready)renderPatterns(rows,$('unit').value);
  paint();
}
$('logViewButton').onclick=()=>switchView(false);
$('patternsButton').onclick=()=>switchView(true);
$('patternGroup').onchange=()=>renderPatterns(rows,$('unit').value);
setInterval(()=>{if(ready&&showPatterns&&!document.hidden)renderPatterns(rows,$('unit').value);},60000);
const media=matchMedia('(prefers-color-scheme: dark)');let theme;try{theme=localStorage.getItem('milky-way.theme');}catch{}
function applyTheme(){const dark=theme?theme==='dark':media.matches;document.documentElement.dataset.theme=dark?'dark':'light';$('themeToggle').textContent=dark?'Light theme':'Dark theme';$('themeToggle').setAttribute('aria-label',dark?'Switch to light theme':'Switch to dark theme');document.querySelector('meta[name="theme-color"]').content=dark?'#11182b':'#192e57';}
$('themeToggle').onclick=()=>{theme=document.documentElement.dataset.theme==='dark'?'light':'dark';try{localStorage.setItem('milky-way.theme',theme);}catch{}applyTheme();};media.addEventListener('change',applyTheme);applyTheme();
setInterval(()=>{updateSince();updateNursing();renderAverages();},1000);
window.addEventListener('beforeunload',event=>{if(nursingStarted||editing||pending){event.preventDefault();event.returnValue='';}});
restoreSession();
