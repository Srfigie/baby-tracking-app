const { chromium }=require('playwright');
const assert=require('node:assert/strict');
const baseURL=process.env.TEST_BASE_URL||'http://127.0.0.1:4173';
const path=require('node:path'); require('node:fs').mkdirSync(path.join(__dirname,'../test-results'),{recursive:true});
(async()=>{
const browser=await chromium.launch({headless:true,channel:'msedge'});
const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
let values=[['id','started_at','kind','amount_ml','duration_minutes','detail','notes','created_at']],writes=0,deny=false,ambiguous=false;
await page.route('https://accounts.google.com/gsi/client',route=>route.fulfill({contentType:'text/javascript',body:`window.google={accounts:{oauth2:{initTokenClient:options=>({requestAccessToken:()=>setTimeout(()=>options.callback({access_token:'TEST_ONLY_TOKEN',expires_in:3600,scope:'https://www.googleapis.com/auth/drive.file'}),10)}),hasGrantedAllScopes:()=>true}}};`}));
await page.route('https://apis.google.com/js/api.js',route=>route.fulfill({contentType:'text/javascript',body:`window.gapi={load:(name,options)=>{window.google.picker={Action:{PICKED:'picked'},ViewId:{SPREADSHEETS:'sheets'},DocsViewMode:{LIST:'list'},DocsView:class{setMode(){return this}},PickerBuilder:class{addView(){return this}setOAuthToken(){return this}setDeveloperKey(){return this}setAppId(){return this}setOrigin(){return this}setTitle(){return this}setCallback(cb){this.cb=cb;return this}build(){return this}setVisible(){setTimeout(()=>this.cb({action:'picked',docs:[{id:'TEST_SHEET'}]}),30)}}};options.callback();}};`}));
await page.route('https://www.googleapis.com/drive/v3/files/**',r=>r.fulfill({json:{capabilities:{canEdit:true}}}));
await page.route('https://sheets.googleapis.com/**',async r=>{
 if(deny)return r.fulfill({status:403,json:{error:{}}});
 if(r.request().url().includes(':append')){writes++;values.push(...r.request().postDataJSON().values);if(ambiguous){ambiguous=false;return r.abort();}return r.fulfill({json:{updates:{updatedRows:1}}});}
 if(r.request().url().includes('/values/'))return r.fulfill({json:{values}});
 return r.fulfill({json:{sheets:[{properties:{title:'BabyLog'}}]}});
});
await page.goto(baseURL);
await page.getByRole('button',{name:'Settings',exact:true}).click();
await page.locator('#clientId').fill('TEST_ONLY.apps.googleusercontent.com');await page.locator('#projectNumber').fill('123456');await page.locator('#apiKey').fill('TEST_ONLY_KEY');await page.getByRole('button',{name:'Save settings',exact:true}).click();
await page.getByRole('button',{name:'Connect with Google'}).click();await page.getByRole('button',{name:'Choose shared sheet'}).click();await page.locator('#tracker').waitFor({state:'visible'});
await page.locator('#amount').fill('60');await page.locator('#notes').fill('<img src=x onerror=alert(1)>');await page.getByRole('button',{name:'Save bottle',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#feedCount').textContent==='1');
assert.equal(await page.locator('#entries img').count(),0);assert.equal(writes,1);
await page.getByRole('button',{name:'Pump',exact:true}).click();await page.locator('#unit').selectOption('oz');await page.locator('#amount').fill('2');await page.locator('#notes').fill('');await page.getByRole('button',{name:'Save pumping session',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#pumpTotal').textContent==='2 oz');
assert.equal(values[2][3],59.15);
await page.getByRole('button',{name:'Breastfeed',exact:true}).click();await page.locator('#minutes').fill('12');await page.getByRole('button',{name:'Save breastfeed',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#feedCount').textContent==='2');
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
await page.screenshot({path:path.join(__dirname,'../test-results/mobile.png'),fullPage:true});
await page.getByRole('button',{name:'Bottle',exact:true}).click();await page.locator('#amount').fill('1');ambiguous=true;await page.getByRole('button',{name:'Save bottle',exact:true}).click();await page.getByText(/Save not confirmed/).waitFor();assert.equal(writes,4);await page.getByRole('button',{name:'Save bottle',exact:true}).click();await page.getByText('Your previous entry was saved.',{exact:true}).waitFor();assert.equal(writes,4);
const storage=await page.evaluate(()=>JSON.stringify(localStorage));assert.ok(!storage.includes('TEST_ONLY_TOKEN'));assert.ok(!storage.includes('onerror'));assert.ok(!storage.includes('started_at'));
await context.setOffline(true);await page.waitForFunction(()=>document.querySelector('#entryFields').disabled);assert.equal(await page.locator('#save').isDisabled(),true);await context.setOffline(false);await page.waitForFunction(()=>!document.querySelector('#entryFields').disabled);
deny=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByText(/Google denied access/).waitFor();assert.equal(await page.locator('#tracker').isVisible(),false);assert.equal(await page.locator('#entries').textContent(),'');
await page.getByRole('button',{name:'Sign out',exact:true}).click();assert.equal(await page.locator('#tracker').isVisible(),false);
assert.deepEqual(errors,[]);console.log('PASS: mobile layout, Google mock flow, bottle/nursing/pump saves, literal notes, no token persistence, ambiguous append reconciliation, offline controls, denied access, sign-out.');
await context.close();
const shell=await browser.newContext();const p=await shell.newPage();await p.goto(baseURL);await p.evaluate(()=>navigator.serviceWorker.ready);await p.reload();await shell.setOffline(true);await p.reload();assert.equal(await p.title(),'Little Log');const cacheUrls=await p.evaluate(async()=>{const cache=await caches.open('little-log-shell-v1');return (await cache.keys()).map(r=>r.url)});assert.equal(cacheUrls.length,10);assert.ok(cacheUrls.every(u=>u.startsWith(baseURL+'/')));console.log('PASS: offline shell and cache allowlist.');
await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
