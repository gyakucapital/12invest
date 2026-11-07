const V = "12i-a4fe2299", BASE = "/12invest/";
const PRE = [BASE, BASE + "offline.html", BASE + "assets/site.css?v=3803155e", BASE + "assets/app.js?v=db8a86aa", BASE + "fonts/silkscreen-400.woff2", BASE + "fonts/silkscreen-700.woff2", BASE + "icons/icon-192.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(PRE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin || !u.pathname.startsWith(BASE)) return;
  if (r.mode === "navigate" || (r.headers.get("accept") || "").includes("text/html")) {
    e.respondWith(fetch(r).then(res => { const c = res.clone(); caches.open(V).then(x => x.put(r, c)); return res; })
      .catch(() => caches.match(r).then(m => m || caches.match(BASE + "offline.html"))));
    return;
  }
  if (/\.json$/.test(u.pathname)) { e.respondWith(fetch(r).catch(() => caches.match(r))); return; }
  e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => { if (res.ok) { const c = res.clone(); caches.open(V).then(x => x.put(r, c)); } return res; })));
});
