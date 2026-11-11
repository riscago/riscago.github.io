/* Electron Push 서비스 워커 — 한 번 열면 오프라인에서도 동작 (웹 버전 전용, 앱에선 쓰지 않음) */
const CACHE='electron-push-932b82b947';
const ASSETS=['./','index.html','config.js','ads.js','manifest.webmanifest',
  'icons/icon-192.png','icons/icon-512.png','icons/maskable-512.png','icons/apple-touch-icon.png',
  'privacy-ko.html','privacy-en.html'];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  const req=e.request,url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==self.location.origin)return;   // 광고 등 외부 요청은 그대로 통과
  if(req.mode==='navigate'||url.pathname.endsWith('/config.js')){
    // 페이지·설정 파일: 네트워크 우선(새 버전·광고 설정 바로 반영), 오프라인이면 캐시
    const key=req.mode==='navigate'?'index.html':req;
    e.respondWith(fetch(req).then(res=>{if(res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(key,copy));}return res;})
      .catch(()=>caches.match(key,{ignoreSearch:true}).then(r=>r||(req.mode==='navigate'?caches.match('index.html'):new Response('',{headers:{'Content-Type':'application/javascript'}})))));
    return;
  }
  e.respondWith(caches.match(req,{ignoreSearch:true}).then(r=>r||fetch(req).then(res=>{
    if(res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy));}
    return res;
  })));
});
