const { chromium }=require('playwright');
const assert=require('node:assert/strict');
const baseURL=process.env.TEST_BASE_URL||'http://127.0.0.1:4173';
const path=require('node:path'); require('node:fs').mkdirSync(path.join(__dirname,'../test-results'),{recursive:true});
(async()=>{
const browser=await chromium.launch({headless:true,channel:'msedge'});
const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
const page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
let values=[['id','started_at','kind','amount_ml','duration_minutes','detail','notes','created_at']],writes=0,deny=false,ambiguous=false,driveMissing=true,excelFile=false;
await page.route('https://accounts.google.com/gsi/client',route=>route.fulfill({contentType:'text/javascript',body:`window.google={accounts:{oauth2:{initTokenClient:options=>({requestAccessToken:()=>setTimeout(()=>options.callback({access_token:'TEST_ONLY_TOKEN',expires_in:3600,scope:'https://www.googleapis.com/auth/drive.file'}),10)}),hasGrantedAllScopes:()=>true}}};`}));
await page.route('https://apis.google.com/js/api.js',route=>route.fulfill({contentType:'text/javascript',body:`window.gapi={load:(name,options)=>{window.google.picker={Action:{PICKED:'picked'},ViewId:{SPREADSHEETS:'sheets'},DocsViewMode:{LIST:'list'},DocsView:class{setMode(){return this}},PickerBuilder:class{addView(){return this}setOAuthToken(){return this}setDeveloperKey(){return this}setAppId(){return this}setOrigin(){return this}setTitle(){return this}setCallback(cb){this.cb=cb;return this}build(){return this}setVisible(){setTimeout(()=>this.cb({action:'picked',docs:[{id:'TEST_SHEET'}]}),30)}}};options.callback();}};`}));
await page.route('https://www.googleapis.com/drive/v3/files/**',r=>{assert.equal(new URL(r.request().url()).searchParams.get('supportsAllDrives'),'true');return r.fulfill(driveMissing?{status:404,json:{error:{}}}:{json:{mimeType:excelFile?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/vnd.google-apps.spreadsheet',capabilities:{canEdit:true}}});});
await page.route('https://sheets.googleapis.com/**',async r=>{
 if(deny)return r.fulfill({status:403,json:{error:{}}});
 if(r.request().url().includes(':append')){writes++;values.push(...r.request().postDataJSON().values);if(ambiguous){ambiguous=false;return r.abort();}return r.fulfill({json:{updates:{updatedRows:1}}});}
 if(r.request().method()==='PUT'){const v=r.request().postDataJSON().values;const decoded=decodeURIComponent(r.request().url());if(decoded.includes('I1:J1')){values[0].push(...v[0]);}else{const row=Number(decoded.match(/!A(\d+):J/)[1]);values[row-1]=v[0];}return r.fulfill({json:{updatedRows:1}});}
 if(r.request().url().includes('/values/'))return r.fulfill({json:{values}});
 return r.fulfill({json:{sheets:[{properties:{title:'BabyLog'}}]}});
});
await page.goto(baseURL);
await page.getByRole('button',{name:'Settings',exact:true}).click();
await page.locator('#connectionMode').selectOption('google');await page.locator('#clientId').fill('TEST_ONLY.apps.googleusercontent.com');await page.locator('#projectNumber').fill('123456');await page.locator('#apiKey').fill('TEST_ONLY_KEY');await page.getByRole('button',{name:'Save settings',exact:true}).click();
await page.getByRole('button',{name:'Connect with Google'}).click();await page.getByRole('button',{name:'Choose shared sheet'}).click();await page.getByText(/checking file access in Google Drive \(404\)/).waitFor();assert.equal(await page.locator('#tracker').isVisible(),false);driveMissing=false;excelFile=true;await page.getByRole('button',{name:'Choose shared sheet'}).click();await page.getByText(/Choose a native Google Sheet/).waitFor();excelFile=false;await page.getByRole('button',{name:'Choose shared sheet'}).click();await page.locator('#tracker').waitFor({state:'visible'});
await page.locator('#amount').fill('60');await page.locator('#notes').fill('<img src=x onerror=alert(1)>');await page.getByRole('button',{name:'Save bottle',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#feedCount').textContent==='1');
assert.equal(await page.locator('#entries img').count(),0);assert.equal(writes,1);
await page.reload();await page.locator('#tracker').waitFor({state:'visible'});
assert.equal(await page.locator('#feedCount').textContent(),'1');
assert.equal(await page.locator('#signIn').isVisible(),false);
assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('little-log.session.v1')).token),'TEST_ONLY_TOKEN');
await page.getByRole('button',{name:'Pump',exact:true}).click();await page.locator('#unit').selectOption('oz');await page.locator('#amount').fill('2');await page.locator('#notes').fill('');await page.getByRole('button',{name:'Save pumping session',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#pumpTotal').textContent==='2 oz');
assert.equal(values[2][3],59.15);
await page.getByRole('button',{name:'Breastfeed',exact:true}).click();await page.locator('#minutes').fill('12');await page.getByRole('button',{name:'Save breastfeed',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#feedCount').textContent==='2');
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
await page.screenshot({path:path.join(__dirname,'../test-results/mobile.png'),fullPage:true});
await page.getByRole('button',{name:'Bottle',exact:true}).click();await page.locator('#amount').fill('1');ambiguous=true;await page.getByRole('button',{name:'Save bottle',exact:true}).click();await page.getByText(/Save not confirmed/).waitFor();assert.equal(writes,4);await page.getByRole('button',{name:'Save bottle',exact:true}).click();await page.getByText('Your previous entry was saved.',{exact:true}).waitFor();assert.equal(writes,4);
const storage=await page.evaluate(()=>JSON.stringify(localStorage));assert.ok(!storage.includes('TEST_ONLY_TOKEN'));assert.ok(!storage.includes('onerror'));assert.ok(!storage.includes('started_at'));
assert.equal(await page.locator('#entries .pump').count(),0);
await page.getByRole('button',{name:'Pumping',exact:true}).click();assert.equal(await page.locator('#entries .pump').count(),1);assert.equal(await page.locator('#entries .bottle').count(),0);
await page.getByRole('button',{name:'Feedings',exact:true}).click();assert.match(await page.locator('#lastFeed').textContent(),/\d+h \d+m ago/);
await page.locator('#entries .bottle .editButton').first().click();await page.locator('#notes').fill('Edited in app');await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.waitForTimeout(500);console.log('EDIT STATUS',await page.locator('#status').textContent(),await page.locator('input:invalid').evaluateAll(es=>es.map(e=>[e.id,e.value,e.validationMessage])));await page.getByText('Changes saved to your shared sheet.',{exact:true}).waitFor();assert.equal(writes,4);assert.ok(values.some(r=>r[6]==='Edited in app'));
await page.locator('#entries .bottle .editButton').first().click();const editId=values.find(r=>r[6]==='Edited in app')[0];values.find(r=>r[0]===editId)[6]='Changed by other parent';await page.locator('#notes').fill('Should not overwrite');await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByText(/changed on another device/).waitFor();assert.equal(values.find(r=>r[0]===editId)[6],'Changed by other parent');await page.getByRole('button',{name:'Cancel editing'}).click();
await page.getByRole('button',{name:'Breastfeed',exact:true}).click();await page.clock.install();await page.getByRole('button',{name:'Start left',exact:true}).click();await page.clock.fastForward(65000);await page.getByRole('button',{name:'Start right',exact:true}).click();await page.clock.fastForward(35000);await page.getByRole('button',{name:'Pause right',exact:true}).click();assert.equal(await page.locator('#leftClock').textContent(),'01:05');assert.equal(await page.locator('#rightClock').textContent(),'00:35');assert.equal(await page.locator('#minutes').inputValue(),'2');assert.equal(await page.locator('#side').inputValue(),'both');
await page.getByRole('button',{name:'Switch to dark theme'}).click();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(__dirname,'../test-results/dark-timer.png'),fullPage:true});
await page.getByRole('button',{name:'Save breastfeed',exact:true}).click();await page.getByText('Saved to your shared sheet.',{exact:true}).waitFor();assert.equal(writes,5);assert.deepEqual(values.at(-1).slice(8),[65,35]);assert.equal(values.at(-1)[4],2);assert.equal(await page.locator('#timerTotal').textContent(),'00:00');
console.log('PASS: activity filters, elapsed labels, edit persistence, conflict protection, per-side timers, dark theme, timer storage.');
await context.setOffline(true);await page.waitForFunction(()=>document.querySelector('#save').disabled);assert.equal(await page.locator('#save').isDisabled(),true);await context.setOffline(false);await page.waitForFunction(()=>!document.querySelector('#save').disabled);
deny=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByText(/Google denied access/).waitFor();assert.equal(await page.locator('#tracker').isVisible(),false);assert.equal(await page.locator('#entries').textContent(),'');
await page.getByRole('button',{name:'Sign out',exact:true}).click();assert.equal(await page.locator('#tracker').isVisible(),false);
assert.equal(await page.evaluate(()=>sessionStorage.getItem('little-log.session.v1')),null);
await page.reload();await page.locator('#signIn').waitFor({state:'visible'});
assert.equal(await page.locator('#tracker').isVisible(),false);
await page.evaluate(()=>sessionStorage.setItem('little-log.session.v1',JSON.stringify({token:'EXPIRED',expires:Date.now()-1000,clientId:'TEST_ONLY.apps.googleusercontent.com'})));
await page.reload();await page.locator('#signIn').waitFor({state:'visible'});
assert.equal(await page.evaluate(()=>sessionStorage.getItem('little-log.session.v1')),null);
deny=false;
await page.getByRole('button',{name:'Connect with Google'}).click();await page.locator('#tracker').waitFor({state:'visible'});
assert.deepEqual(errors,[]);console.log('PASS: mobile layout, Google mock flow, bottle/nursing/pump saves, literal notes, no token in localStorage, ambiguous append reconciliation, offline controls, denied access, sign-out.');
await context.close();
const scriptContext=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
const scriptPage=await scriptContext.newPage();const scriptErrors=[];scriptPage.on('pageerror',e=>scriptErrors.push(e.message));
await scriptPage.route('https://accounts.google.com/**',r=>r.abort());await scriptPage.route('https://apis.google.com/**',r=>r.abort());
let scriptValues=[['id','started_at','kind','amount_ml','duration_minutes','detail','notes','created_at','left_seconds','right_seconds']],scriptWrites=0;
await scriptPage.route('https://script.google.com/macros/s/TEST_DEPLOYMENT/exec',async r=>{
 const request=r.request().postDataJSON();assert.equal(r.request().method(),'POST');assert.match(r.request().headers()['content-type'],/^text\/plain/);assert.ok(!r.request().url().includes('key='));
 if(request.key!=='a'.repeat(64))return r.fulfill({json:{ok:false,code:'unauthorized',error:'Access key rejected.'}});
 if(request.action==='read')return r.fulfill({json:{ok:true,sheetId:'TEST_SHEET',values:scriptValues}});
 if(request.action==='append'){scriptWrites++;scriptValues.push(request.row);}
 if(request.action==='edit'){const i=scriptValues.findIndex(row=>row[0]===request.row[0]);assert.deepEqual(scriptValues[i],request.original);scriptValues[i]=request.row;}
 return r.fulfill({json:{ok:true}});
});
await scriptPage.goto(baseURL);await scriptPage.locator('#settingsButton').click();await scriptPage.locator('#scriptUrl').fill('https://script.google.com/macros/s/TEST_DEPLOYMENT/exec');await scriptPage.locator('#accessKey').fill('a'.repeat(64));await scriptPage.getByRole('button',{name:'Save settings',exact:true}).click();await scriptPage.locator('#tracker').waitFor({state:'visible'});
await scriptPage.locator('#amount').fill('60');await scriptPage.locator('#save').click();await scriptPage.getByText('Saved to your shared sheet.',{exact:true}).waitFor();assert.equal(scriptWrites,1);
await scriptPage.evaluate(()=>sessionStorage.clear());await scriptPage.reload();await scriptPage.locator('#tracker').waitFor({state:'visible'});assert.equal(await scriptPage.locator('#feedCount').textContent(),'1');assert.equal(await scriptPage.locator('#chooseSheet').isVisible(),false);
await scriptPage.locator('.editButton').first().click();await scriptPage.locator('#notes').fill('Script edit');await scriptPage.locator('#save').click();await scriptPage.getByText('Changes saved to your shared sheet.',{exact:true}).waitFor();assert.equal(scriptValues[1][6],'Script edit');
await scriptPage.locator('#settingsButton').click();await scriptPage.locator('#accessKey').fill('b'.repeat(64));await scriptPage.getByRole('button',{name:'Save settings',exact:true}).click();await scriptPage.getByText('Access key rejected.',{exact:true}).waitFor();assert.equal(await scriptPage.locator('#tracker').isVisible(),false);
await scriptPage.locator('#settingsButton').click();await scriptPage.locator('#forget').click();assert.equal(await scriptPage.evaluate(()=>localStorage.getItem('little-log.settings.v1')),null);assert.deepEqual(scriptErrors,[]);await scriptContext.close();console.log('PASS: Apps Script setup, POST key transport, save, fresh-session reconnect, edit, wrong-key rejection, forget settings.');
const shell=await browser.newContext();const p=await shell.newPage();await p.goto(baseURL);await p.evaluate(()=>navigator.serviceWorker.ready);await p.reload();await shell.setOffline(true);await p.reload();assert.equal(await p.title(),'Milky Way');const cacheUrls=await p.evaluate(async()=>{const cache=await caches.open('little-log-shell-v9');return (await cache.keys()).map(r=>r.url)});assert.equal(cacheUrls.length,10);assert.ok(cacheUrls.every(u=>u.startsWith(baseURL+'/')));console.log('PASS: offline shell and cache allowlist.');
await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
