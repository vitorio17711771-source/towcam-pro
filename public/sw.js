// Increment this cache identifier whenever any application asset changes.
// Keep old clients on their own complete snapshot until activation.
const CACHE='towcam-pro-1.0.0';
const ASSETS=['./','./index.html','./styles.css','./app.js','./camera.js','./config.js','./engine.js','./processor.js','./worker.js','./image-service.js','./storage.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./icons/maskable-512.png'];
const URLS=new Set(ASSETS.map(a=>new URL(a,self.registration.scope).href));
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await cache.addAll(ASSETS.map(a=>new Request(new URL(a,self.registration.scope),{cache:'reload'})));
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const keys=await caches.keys();await Promise.all(keys.filter(k=>k.startsWith('towcam-pro-')&&k!==CACHE).map(k=>caches.delete(k)));
  await self.clients.claim();
})()));
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE')self.skipWaiting();});
self.addEventListener('fetch',event=>{
  const req=event.request,url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==self.location.origin)return;
  if(req.mode==='navigate'&&url.pathname===new URL(self.registration.scope).pathname){
    event.respondWith((async()=>{const cache=await caches.open(CACHE);return await cache.match(new URL('./index.html',self.registration.scope))||fetch(req);})());return;
  }
  if(!URLS.has(url.href))return;
  event.respondWith((async()=>{const cache=await caches.open(CACHE);return await cache.match(req)||fetch(req);})());
});
