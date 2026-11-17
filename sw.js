// The build script replaces BUILD_ID when website resources change.
const CACHE='collabdoc-106D556F717B';
// App files only (sample-doc.html ships with the app). User documents are never cached.
const ASSETS=['./index.html','./app.js','./sample-doc.html','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(
  caches.open(CACHE).then(cache=>cache.addAll(ASSETS.map(url=>new Request(url,{cache:'reload'}))))
));
self.addEventListener('message',event=>{
  if(event.data?.type==='ACTIVATE')event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const name of await caches.keys())if(name.startsWith('collabdoc-')&&name!==CACHE)await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=event.request.url;
  if(!ASSETS.some(asset=>new URL(asset,self.registration.scope).href===url))return;
  event.respondWith((async()=>{
    const hit=await(await caches.open(CACHE)).match(event.request);
    return hit||fetch(event.request);
  })());
});
