import {HEADER,TIMER_HEADER,TAB,localInput,makeEntry,parseRows,totals,volume,elapsedLabel,timerSeconds,editRowIndex,ML_PER_OZ} from './model.js';
const $=id=>document.getElementById(id), SCOPE='https://www.googleapis.com/auth/drive.file', KEY='little-log.settings.v1';
let config={},token='',expires=0,epoch=0,timer,rows=[],kind='bottle',busy=false,ready=false,pending=null;
let activity='feed',editing=null;
const nursing={left:{elapsed:0,started:null},right:{elapsed:0,started:null}};
let nursingStarted=false;
try{config=JSON.parse(localStorage.getItem(KEY)||'{}');if(!config||typeof config!=='object'||Array.isArray(config))config={};}catch{config={};}
$('unit').value=config.unit==='oz'?'oz':'ml';
$('when').value=localInput();
$('dateLabel').textContent=new Intl.DateTimeFormat(undefined,{weekday:'long',month:'long',day:'numeric'}).format(new Date()).toUpperCase();
function say(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
function persist(){localStorage.setItem(KEY,JSON.stringify(config));}
function paint(){
  $('tracker').hidden=!ready&&!nursingStarted;$('welcome').hidden=ready;$('signOut').hidden=!token;
  $('signIn').hidden=!!token;$('chooseSheet').hidden=!token;
  $('connection').textContent=!navigator.onLine?'Offline':ready?'Shared sheet connected':token?'Choose your sheet':'Not connected';
  $('entryFields').disabled=busy; $('save').disabled=!ready||!navigator.onLine; $('cancelEdit').disabled=busy;
  $('refresh').disabled=busy||!ready||!navigator.onLine;
  for(const button of document.querySelectorAll('.editButton'))button.disabled=busy||!!pending;
  for(const id of ['signIn','chooseSheet','settingsButton','signOut'])$(id).disabled=busy;
}
function clearSession(){epoch++;clearTimeout(timer);token='';expires=0;rows=[];ready=false;$('entries').replaceChildren();$('feedCount').textContent='0';$('bottleTotal').textContent='0 mL';$('pumpTotal').textContent='0 mL';$('synced').textContent='';$('sheetLink').removeAttribute('href');if(!nursingStarted&&!editing&&!pending){$('entryForm').reset();$('when').value=localInput();$('unit').value=config.unit==='oz'?'oz':'ml';setKind('bottle');}updateSince();paint();}
function requireSession(){if(!token||Date.now()>=expires){clearSession();throw Error('Your Google session expired. Connect again to continue.');}}
async function run(fn){if(busy)return;busy=true;paint();try{await fn();}catch(error){say(error.message||'Something went wrong. Please try again.',true);}finally{busy=false;paint();}}
async function api(url,options={}){
  requireSession();const current=epoch;
  let response;
  try{response=await fetch(url,{...options,cache:'no-store',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(20000)});}catch{throw Error('Could not reach Google. Check your connection, then refresh before retrying a save.');}
  if(current!==epoch)throw Error('Session changed. Connect again.');
  if(response.status===401){clearSession();throw Error('Your Google session expired. Connect again.');}
  if(response.status===403){rows=[];ready=false;$('entries').replaceChildren();throw Error('Google denied access. Use an account with Editor access, enable the required APIs, and choose the shared sheet again.');}
  if(response.status===404){const stage=url.includes('/drive/v3/files/')?'checking file access in Google Drive':url.includes('/values/')?'reading or writing the BabyLog tab':'opening the spreadsheet in Google Sheets';throw Error('Google could not find or grant access to this file while '+stage+' (404). Choose the sheet again using an account that can edit it.');}
  if(!response.ok)throw Error(response.status===429?'Google is busy. Wait a moment, then refresh.':`Google request failed (${response.status}). Refresh before retrying.`);
  return response.json();
}
function sheetBase(id=config.sheetId){if(!/^[a-zA-Z0-9_-]+$/.test(id||''))throw Error('Choose a Google Sheet first.');return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}`;}
const range=encodeURIComponent(`'${TAB}'!A:J`);
async function load(){
  const result=await api(`${sheetBase()}/values/${range}`);
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
function render(){
  const sum=totals(rows),unit=$('unit').value;
  $('feedCount').textContent=sum.feeds;$('bottleTotal').textContent=volume(sum.bottle,unit);$('pumpTotal').textContent=volume(sum.pump,unit);
  $('sheetLink').href=`https://docs.google.com/spreadsheets/d/${encodeURIComponent(config.sheetId)}/edit`;
  $('synced').textContent=`Updated ${new Date().toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})} · refreshes every 30 seconds`;
  updateSince();
  const visible=rows.filter(r=>activity==='pump'?r.kind==='pump':r.kind!=='pump');
  $('entries').replaceChildren();
  if(!visible.length){const p=document.createElement('p');p.className='empty';p.textContent='Your first entry goes here. Add a feed or pumping session to get started.';$('entries').append(p);}
  for(const entry of visible.slice(0,100)){
    const article=document.createElement('article');article.className=`entry ${entry.kind}`;
    const symbol=document.createElement('span');symbol.className='symbol';symbol.textContent={bottle:'B',nursing:'N',pump:'P'}[entry.kind];symbol.setAttribute('aria-hidden','true');
    const body=document.createElement('div'), title=document.createElement('strong');
    title.textContent=({bottle:'Bottle',nursing:'Breastfeed',pump:'Pumping'}[entry.kind])+' · '+(entry.kind==='nursing'?`${entry.minutes} min`:volume(entry.amount,unit));
    const time=document.createElement('p');time.className='muted small';time.textContent=new Date(entry.when).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
    const detail=document.createElement('p');detail.className='small';detail.textContent=entry.detail+(entry.kind!=='nursing'&&entry.minutes?` · ${entry.minutes} min`:'');
    body.append(title,time,detail);if(entry.left||entry.right){const sides=document.createElement('p');sides.className='small';sides.textContent=`Left ${clock(entry.left)} · Right ${clock(entry.right)}`;body.append(sides);}const edit=document.createElement('button');edit.className='quiet editButton';edit.textContent='Edit';edit.setAttribute('aria-label','Edit '+title.textContent+' '+time.textContent);edit.disabled=busy||!!pending;edit.onclick=()=>startEdit(entry);body.append(edit);if(entry.notes){const note=document.createElement('p');note.className='notes small';note.textContent=entry.notes;body.append(note);}article.append(symbol,body);$('entries').append(article);
  }
  if(visible.length>100){const p=document.createElement('p');p.textContent='Showing the latest 100 entries. All entries are in your sheet.';$('entries').append(p);}paint();
}
function setKind(value){kind=value;for(const b of document.querySelectorAll('[data-kind]'))b.setAttribute('aria-pressed',String(b.dataset.kind===kind));$('amountFields').hidden=kind==='nursing';$('amount').required=kind!=='nursing';$('milkField').hidden=kind!=='bottle';$('sideField').hidden=kind==='bottle';$('nursingTimer').hidden=kind!=='nursing';$('minutes').required=kind==='nursing';$('minutes').placeholder=kind==='nursing'?'Minutes':'Optional';$('save').textContent=editing?'Save changes':{bottle:'Save bottle',nursing:'Save breastfeed',pump:'Save pumping session'}[kind];}
for(const b of document.querySelectorAll('[data-kind]'))b.onclick=()=>{if(nursingStarted&&b.dataset.kind!=='nursing'){say('Save the breastfeeding session or reset its timers before switching type.',true);return;}setKind(b.dataset.kind);};
$('unit').onchange=()=>{config.unit=$('unit').value;try{persist();}catch{say('This browser could not remember your unit preference.',true);}if(ready)render();};
$('entryForm').onsubmit=event=>{event.preventDefault();run(async()=>{
  requireSession();
  // Never automatically repeat an ambiguous append. Reconcile the previous ID first.
  if(pending){await load();if(rows.some(r=>r.id===pending[0])){pending=null;resetEntry();say('Your previous entry was saved.');return;}throw Error('The previous save could not be confirmed. Check the sheet before reloading this page and entering it again.');}
  if(kind==='nursing'&&nursingStarted){pauseNursing();updateNursing();}
  const row=makeEntry({kind,when:$('when').value,amount:$('amount').value,unit:$('unit').value,minutes:$('minutes').value,detail:kind==='bottle'?$('milk').value:$('side').value,notes:$('notes').value},editing?.id);
  row.push(kind==='nursing'&&nursingStarted?timerSeconds(nursing.left):'',kind==='nursing'&&nursingStarted?timerSeconds(nursing.right):'');
  if(editing){
    row[7]=editing.raw[7];
    const latest=await api(`${sheetBase()}/values/${range}`);parseRows(latest.values);
    const rowNumber=editRowIndex(latest.values,editing.raw);
    try{await api(`${sheetBase()}/values/${encodeURIComponent(`'${TAB}'!A${rowNumber}:J${rowNumber}`)}?valueInputOption=RAW`,{method:'PUT',body:JSON.stringify({values:[row]})});}
    catch(error){throw Error(error.message+' Edit not confirmed. Refresh and inspect the entry before retrying.');}
    resetEntry();await load();say('Changes saved to your shared sheet.');return;
  }
  pending=row;
  try{await api(`${sheetBase()}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,{method:'POST',body:JSON.stringify({values:[row]})});}
  catch(error){throw Error(`${error.message} Save not confirmed; press Save again to check, without sending a duplicate.`);}
  pending=null;resetEntry();
  try{await load();say('Saved to your shared sheet.');}catch{say('Your entry was saved, but activity could not refresh. Do not enter it again; tap Refresh.',true);}
});};
function resetEntry(){editing=null;$('cancelEdit').hidden=true;$('formTitle').textContent='What are we logging?';resetNursing();setKind(kind);$('amount').value='';$('minutes').value='';$('notes').value='';$('when').value=localInput();}
$('refresh').onclick=()=>run(load);
$('signIn').onclick=()=>{
  if(!config.clientId||!config.apiKey||!config.projectNumber){openSettings();return;}
  if(!globalThis.google?.accounts?.oauth2){say('Google sign-in is still loading. Check your internet connection and try again.',true);return;}
  const attempt=epoch;
  const client=google.accounts.oauth2.initTokenClient({client_id:config.clientId,scope:SCOPE,include_granted_scopes:false,callback:response=>{
    if(attempt!==epoch)return;
    if(response.error||!response.access_token){say('Google access was not granted. Please try again.',true);return;}
    if(!google.accounts.oauth2.hasGrantedAllScopes(response,SCOPE)){say('Allow access to the sheet you select to use the log.',true);return;}
    token=response.access_token;expires=Date.now()+Math.max(0,Number(response.expires_in)*1000-60000);clearTimeout(timer);
    timer=setTimeout(()=>{clearSession();say('Your Google session expired. Connect again to continue.');},Math.max(0,expires-Date.now()));
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
function openSettings(){if(nursingStarted||editing||pending){say('Save or cancel the current entry before changing settings.',true);return;}for(const id of ['clientId','projectNumber','apiKey'])$(id).value=config[id]||'';$('settings').showModal();}
$('settingsButton').onclick=openSettings;$('closeSettings').onclick=()=>$('settings').close();
$('settingsForm').onsubmit=event=>{event.preventDefault();const clientId=$('clientId').value.trim();if(!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)){say('Enter a valid Google OAuth web client ID.',true);return;}clearSession();config={clientId,projectNumber:$('projectNumber').value.trim(),apiKey:$('apiKey').value.trim(),unit:$('unit').value};try{persist();$('settings').close();say('Settings saved on this phone. Connect with Google to continue.');}catch{say('Browser storage is unavailable. Allow site storage to remember setup.',true);}};
$('forget').onclick=()=>{clearSession();config={};localStorage.removeItem(KEY);$('settingsForm').reset();$('settings').close();say('Settings removed from this phone. Your Google Sheet has not changed.');};
$('signOut').onclick=()=>{if((nursingStarted||editing||pending)&&!confirm('Sign out and discard this unsaved session?'))return;resetEntry();pending=null;clearSession();say('Signed out of Milky Way. Your shared sheet is unchanged.');};
window.addEventListener('offline',()=>{paint();say('You are offline. Connect to the internet to refresh or save entries.',true);});
window.addEventListener('online',()=>{paint();if(ready)run(load);else say('Back online. Connect with Google to continue.');});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&ready&&navigator.onLine)run(load);});
setInterval(()=>{if(ready&&navigator.onLine&&document.visibilityState==='visible')run(load);},30000);
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>say('Offline installation is unavailable in this browser. You can still use the app online.'));
if(document.modelContext?.registerTool){try{Promise.resolve(document.modelContext.registerTool({name:'refresh_shared_log',description:'Refresh the visible feeding and pumping activity from the connected Google Sheet.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:async input=>{if(!input||Object.keys(input).length)throw Error('No arguments expected.');if(busy||!ready)throw Error('Connect a sheet and wait for the current action first.');await run(load);return {connected:ready};}})).catch(()=>{});}catch{}}
paint();

function clock(seconds){return `${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;}
function updateSince(){for(const [id,isPump] of [['lastFeed',false],['lastPump',true]])$(id).textContent=elapsedLabel(rows.find(r=>(r.kind==='pump')===isPump)?.when);}
function pauseNursing(){for(const side of ['left','right']){const t=nursing[side];if(t.started!==null){t.elapsed+=Date.now()-t.started;t.started=null;}}}
function updateNursing(){const left=timerSeconds(nursing.left),right=timerSeconds(nursing.right);$('leftClock').textContent=clock(left);$('rightClock').textContent=clock(right);$('timerTotal').textContent=clock(left+right);for(const side of ['left','right'])$(side+'Timer').textContent=(nursing[side].started===null?'Start ':'Pause ')+side;
  $('minutes').readOnly=kind==='nursing'&&nursingStarted;$('side').disabled=kind==='nursing'&&nursingStarted;
  if(kind==='nursing'&&nursingStarted){$('minutes').value=Math.max(1,Math.ceil((left+right)/60));$('side').value=left&&right?'both':right?'right':'left';}}
function resetNursing(){pauseNursing();for(const side of ['left','right'])nursing[side].elapsed=0;nursingStarted=false;updateNursing();}
for(const side of ['left','right'])$(side+'Timer').onclick=()=>{const active=nursing[side].started!==null;pauseNursing();if(!nursingStarted){nursingStarted=true;if(!editing)$('when').value=localInput();}if(!active)nursing[side].started=Date.now();updateNursing();};
$('resetTimer').onclick=()=>{if(nursingStarted&&!confirm('Reset both breast timers?'))return;resetNursing();$('minutes').value='';};
function startEdit(entry){if(busy)return;if(nursingStarted||editing||pending||$('amount').value||$('minutes').value||$('notes').value){say('Save or cancel the current entry before editing another.',true);return;}editing={...entry,raw:entry.raw.slice()};setKind(entry.kind);$('formTitle').textContent='Edit entry';$('cancelEdit').hidden=false;$('when').value=localInput(new Date(entry.when));$('amount').value=entry.kind==='nursing'?'':(config.unit==='oz'?entry.amount/ML_PER_OZ:entry.amount);$('minutes').value=entry.minutes||'';$(entry.kind==='bottle'?'milk':'side').value=entry.detail;$('notes').value=entry.notes;
  if(entry.left||entry.right){nursingStarted=true;nursing.left.elapsed=entry.left*1000;nursing.right.elapsed=entry.right*1000;updateNursing();}$('entryForm').scrollIntoView({behavior:'smooth',block:'start'});}
$('cancelEdit').onclick=()=>{resetEntry();say('Editing cancelled.');};
for(const [id,value] of [['feedTab','feed'],['pumpTab','pump']])$(id).onclick=()=>{activity=value;$('feedTab').setAttribute('aria-pressed',String(value==='feed'));$('pumpTab').setAttribute('aria-pressed',String(value==='pump'));render();};
const media=matchMedia('(prefers-color-scheme: dark)');let theme;try{theme=localStorage.getItem('milky-way.theme');}catch{}
function applyTheme(){const dark=theme?theme==='dark':media.matches;document.documentElement.dataset.theme=dark?'dark':'light';$('themeToggle').textContent=dark?'Light theme':'Dark theme';$('themeToggle').setAttribute('aria-label',dark?'Switch to light theme':'Switch to dark theme');document.querySelector('meta[name="theme-color"]').content=dark?'#11182b':'#192e57';}
$('themeToggle').onclick=()=>{theme=document.documentElement.dataset.theme==='dark'?'light':'dark';try{localStorage.setItem('milky-way.theme',theme);}catch{}applyTheme();};media.addEventListener('change',applyTheme);applyTheme();
setInterval(()=>{updateSince();updateNursing();},1000);
window.addEventListener('beforeunload',event=>{if(nursingStarted||editing||pending){event.preventDefault();event.returnValue='';}});
