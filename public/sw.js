const CACHE='little-log-shell-v4';
const ASSETS=['./','./index.html','./style.css','./app.js','./model.js','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png','./privacy.html'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('little-log-shell-')&&key!==CACHE).map(key=>caches.delete(key))))));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  // Explicit shell allowlist: never cache Google requests, tokens, or records.
  if(event.request.method!=='GET'||url.origin!==self.location.origin||url.search)return;
  const allowed=ASSETS.map(path=>new URL(path,self.registration.scope).href);
  if(!allowed.includes(url.href))return;
  event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}return response;}).catch(()=>caches.match(event.request)));
});
