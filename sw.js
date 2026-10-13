const CACHE='aula-static-v18';
const ASSETS=['./','./index.html','./style.css','./app.mjs','./core.mjs','./file-store.mjs','./idoceo.mjs','./vendor/xlsx.mini.min.js','./vendor/jsQR.js','./vendor/atkinson-hyperlegible-next-latin.woff2','./manifest.webmanifest','./icon.svg','./icon.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
// Borra las versiones anteriores de la caché al activar la nueva.
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('aula-static-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;e.respondWith(caches.open(CACHE).then(async c=>(await c.match(e.request))||fetch(e.request)));});
