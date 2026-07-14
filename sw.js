/* Cache-first with background refresh. Bump CACHE to invalidate. */
var CACHE = "worldclock-v1.5.1";
var ASSETS = [
  "./", "index.html", "css/tokens.css", "css/site.css",
  "js/zones.js", "js/data.js", "js/settings.js", "js/clocks.js",
  "js/mapdata.js", "js/map.js", "js/qol.js", "js/pet.js",
  "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png"
];
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(ASSETS.map(function (u) { return new Request(u, { cache: "reload" }); }));
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(e.request, { ignoreSearch: true }).then(function (hit) {
      var key = e.request.url.split("?")[0];
      var net = fetch(e.request).then(function (res) {
        if (res && res.status === 200 && res.type === "basic") c.put(key, res.clone());
        return res;
      }).catch(function () { return hit || Response.error(); });
      return hit || net;
    });
  }));
});
