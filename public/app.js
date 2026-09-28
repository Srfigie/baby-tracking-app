import {HEADER,TAB,localInput,makeEntry,parseRows,totals,volume} from './model.js';
const $=id=>document.getElementById(id), SCOPE='https://www.googleapis.com/auth/drive.file', KEY='little-log.settings.v1';
let config={},token='',expires=0,epoch=0,timer,rows=[],kind='bottle',busy=false,ready=false,pending=null;
try{config=JSON.parse(localStorage.getItem(KEY)||'{}');if(!config||typeof config!=='object'||Array.isArray(config))config={};}catch{config={};}
$('unit').value=config.unit==='oz'?'oz':'ml';
$('when').value=localInput();
$('dateLabel').textContent=new Intl.DateTimeFormat(undefined,{weekday:'long',month:'long',day:'numeric'}).format(new Date()).toUpperCase();
function say(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
function persist(){localStorage.setItem(KEY,JSON.stringify(config));}
function paint(){
  $('tracker').hidden=!ready;$('welcome').hidden=ready;$('signOut').hidden=!token;
  $('signIn').hidden=!!token;$('chooseSheet').hidden=!token;
  $('connection').textContent=!navigator.onLine?'Offline':ready?'Shared sheet connected':token?'Choose your sheet':'Not connected';
  $('entryFields').disabled=busy||!ready||!navigator.onLine;
  $('refresh').disabled=busy||!navigator.onLine;
  for(const id of ['signIn','chooseSheet','settingsButton','signOut'])$(id).disabled=busy;
}
function clearSession(){epoch++;clearTimeout(timer);token='';expires=0;rows=[];ready=false;pending=null;$('entries').replaceChildren();$('feedCount').textContent='0';$('bottleTotal').textContent='0 mL';$('pumpTotal').textContent='0 mL';$('synced').textContent='';$('sheetLink').removeAttribute('href');$('entryForm').reset();$('when').value=localInput();$('unit').value=config.unit==='oz'?'oz':'ml';setKind('bottle');paint();}
function requireSession(){if(!token||Date.now()>=expires){clearSession();throw Error('Your Google session expired. Connect again to continue.');}}
async function run(fn){if(busy)return;busy=true;paint();try{await fn();}catch(error){say(error.message||'Something went wrong. Please try again.',true);}finally{busy=false;paint();}}
async function api(url,options={}){
  requireSession();const current=epoch;
  let response;
  try{response=await fetch(url,{...options,cache:'no-store',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(20000)});}catch{throw Error('Could not reach Google. Check your connection, then refresh before retrying a save.');}
  if(current!==epoch)throw Error('Session changed. Connect again.');
  if(response.status===401){clearSession();throw Error('Your Google session expired. Connect again.');}
  if(response.status===403){rows=[];ready=false;$('entries').replaceChildren();throw Error('Google denied access. Use an account with Editor access, enable the required APIs, and choose the shared sheet again.');}
  if(!response.ok)throw Error(response.status===429?'Google is busy. Wait a moment, then refresh.':`Google request failed (${response.status}). Refresh before retrying.`);
  return response.json();
}
function sheetBase(id=config.sheetId){if(!/^[a-zA-Z0-9_-]+$/.test(id||''))throw Error('Choose a Google Sheet first.');return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}`;}
const range=encodeURIComponent(`'${TAB}'!A:H`);
async function load(){
  const result=await api(`${sheetBase()}/values/${range}`);
  rows=parseRows(result.values);ready=true;render();say('Your shared log is up to date.');
}
async function connectSheet(id){
  const base=sheetBase(id);
  const access=await api(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=capabilities(canEdit)`);
  if(!access.capabilities?.canEdit)throw Error('This Google account needs Editor access to the shared sheet.');
  const meta=await api(`${base}?fields=sheets.properties.title`);
  if(!meta.sheets.some(s=>s.properties.title===TAB)){
    try{await api(`${base}:batchUpdate`,{method:'POST',body:JSON.stringify({requests:[{addSheet:{properties:{title:TAB}}}]})});}
    catch(error){const again=await api(`${base}?fields=sheets.properties.title`);if(!again.sheets.some(s=>s.properties.title===TAB))throw error;}
  }
  const existing=await api(`${base}/values/${range}`);
  if(!existing.values?.length)await api(`${base}/values/${encodeURIComponent(`'${TAB}'!A1:H1`)}?valueInputOption=RAW`,{method:'PUT',body:JSON.stringify({values:[HEADER]})});
  else parseRows(existing.values);
  config.sheetId=id;persist();await load();
}
function render(){
  const sum=totals(rows),unit=$('unit').value;
  $('feedCount').textContent=sum.feeds;$('bottleTotal').textContent=volume(sum.bottle,unit);$('pumpTotal').textContent=volume(sum.pump,unit);
  $('sheetLink').href=`https://docs.google.com/spreadsheets/d/${encodeURIComponent(config.sheetId)}/edit`;
  $('synced').textContent=`Updated ${new Date().toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})} · refreshes every 30 seconds`;
  $('entries').replaceChildren();
  if(!rows.length){const p=document.createElement('p');p.className='empty';p.textContent='Your first entry goes here. Add a feed or pumping session to get started.';$('entries').append(p);}
  for(const entry of rows.slice(0,100)){
    const article=document.createElement('article');article.className=`entry ${entry.kind}`;
    const symbol=document.createElement('span');symbol.className='symbol';symbol.textContent={bottle:'B',nursing:'N',pump:'P'}[entry.kind];symbol.setAttribute('aria-hidden','true');
    const body=document.createElement('div'), title=document.createElement('strong');
    title.textContent=({bottle:'Bottle',nursing:'Breastfeed',pump:'Pumping'}[entry.kind])+' · '+(entry.kind==='nursing'?`${entry.minutes} min`:volume(entry.amount,unit));
    const time=document.createElement('p');time.className='muted small';time.textContent=new Date(entry.when).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
    const detail=document.createElement('p');detail.className='small';detail.textContent=entry.detail+(entry.kind!=='nursing'&&entry.minutes?` · ${entry.minutes} min`:'');
    body.append(title,time,detail);if(entry.notes){const note=document.createElement('p');note.className='notes small';note.textContent=entry.notes;body.append(note);}article.append(symbol,body);$('entries').append(article);
  }
  if(rows.length>100){const p=document.createElement('p');p.textContent='Showing the latest 100 entries. All entries are in your sheet.';$('entries').append(p);}paint();
}
function setKind(value){kind=value;for(const b of document.querySelectorAll('[data-kind]'))b.setAttribute('aria-pressed',String(b.dataset.kind===kind));$('amountFields').hidden=kind==='nursing';$('amount').required=kind!=='nursing';$('milkField').hidden=kind!=='bottle';$('sideField').hidden=kind==='bottle';$('minutes').required=kind==='nursing';$('minutes').placeholder=kind==='nursing'?'Minutes':'Optional';$('save').textContent={bottle:'Save bottle',nursing:'Save breastfeed',pump:'Save pumping session'}[kind];}
for(const b of document.querySelectorAll('[data-kind]'))b.onclick=()=>setKind(b.dataset.kind);
$('unit').onchange=()=>{config.unit=$('unit').value;try{persist();}catch{say('This browser could not remember your unit preference.',true);}if(ready)render();};
$('entryForm').onsubmit=event=>{event.preventDefault();run(async()=>{
  requireSession();
  // Never automatically repeat an ambiguous append. Reconcile the previous ID first.
  if(pending){await load();if(rows.some(r=>r.id===pending[0])){pending=null;resetEntry();say('Your previous entry was saved.');return;}throw Error('The previous save could not be confirmed. Check the sheet before reloading this page and entering it again.');}
  const row=makeEntry({kind,when:$('when').value,amount:$('amount').value,unit:$('unit').value,minutes:$('minutes').value,detail:kind==='bottle'?$('milk').value:$('side').value,notes:$('notes').value});
  pending=row;
  try{await api(`${sheetBase()}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,{method:'POST',body:JSON.stringify({values:[row]})});}
  catch(error){throw Error(`${error.message} Save not confirmed; press Save again to check, without sending a duplicate.`);}
  pending=null;resetEntry();
  try{await load();say('Saved to your shared sheet.');}catch{say('Your entry was saved, but activity could not refresh. Do not enter it again; tap Refresh.',true);}
});};
function resetEntry(){$('amount').value='';$('minutes').value='';$('notes').value='';$('when').value=localInput();}
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
function openSettings(){for(const id of ['clientId','projectNumber','apiKey'])$(id).value=config[id]||'';$('settings').showModal();}
$('settingsButton').onclick=openSettings;$('closeSettings').onclick=()=>$('settings').close();
$('settingsForm').onsubmit=event=>{event.preventDefault();const clientId=$('clientId').value.trim();if(!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)){say('Enter a valid Google OAuth web client ID.',true);return;}clearSession();config={clientId,projectNumber:$('projectNumber').value.trim(),apiKey:$('apiKey').value.trim(),unit:$('unit').value};try{persist();$('settings').close();say('Settings saved on this phone. Connect with Google to continue.');}catch{say('Browser storage is unavailable. Allow site storage to remember setup.',true);}};
$('forget').onclick=()=>{clearSession();config={};localStorage.removeItem(KEY);$('settingsForm').reset();$('settings').close();say('Settings removed from this phone. Your Google Sheet has not changed.');};
$('signOut').onclick=()=>{clearSession();say('Signed out of Milky Way. Your shared sheet is unchanged.');};
window.addEventListener('offline',()=>{paint();say('You are offline. Connect to the internet to refresh or save entries.',true);});
window.addEventListener('online',()=>{paint();if(ready)run(load);else say('Back online. Connect with Google to continue.');});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&ready&&navigator.onLine)run(load);});
setInterval(()=>{if(ready&&navigator.onLine&&document.visibilityState==='visible')run(load);},30000);
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>say('Offline installation is unavailable in this browser. You can still use the app online.'));
if(document.modelContext?.registerTool){try{Promise.resolve(document.modelContext.registerTool({name:'refresh_shared_log',description:'Refresh the visible feeding and pumping activity from the connected Google Sheet.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:async input=>{if(!input||Object.keys(input).length)throw Error('No arguments expected.');if(busy||!ready)throw Error('Connect a sheet and wait for the current action first.');await run(load);return {connected:ready};}})).catch(()=>{});}catch{}}
paint();
