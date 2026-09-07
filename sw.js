const CACHE='aula-static-v11';
const ASSETS=['./','./index.html','./style.css','./app.mjs','./core.mjs','./file-store.mjs','./idoceo.mjs','./vendor/xlsx.mini.min.js','./vendor/jsQR.js','./manifest.webmanifest','./icon.svg','./icon.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;e.respondWith(caches.open(CACHE).then(async c=>(await c.match(e.request))||fetch(e.request)));});
