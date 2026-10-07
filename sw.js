/* 西班牙獨旅 service worker
   - App 本體：網路優先（有網路就拿新版），沒網路用快取
   - 地圖圖磚：只快取「看過的」圖磚（不預先大量下載，符合 OSM 使用規範），背景更新
   - 字型：快取後背景更新 */
const SHELL_CACHE = "ss-shell-v3";
const TILE_CACHE = "ss-tiles";
const FONT_CACHE = "ss-fonts";
const MAP_CACHE = "ss-maps"; // 使用者手動下載的城市離線地圖，由頁面管理
const TILE_LIMIT = 3000;
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./apple-touch-icon.png", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL_CACHE);
    await Promise.allSettled(SHELL.map((u) => c.add(u)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keep = [SHELL_CACHE, TILE_CACHE, FONT_CACHE, MAP_CACHE];
    for (const k of await caches.keys()) if (!keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function trimTiles() {
  const c = await caches.open(TILE_CACHE);
  const keys = await c.keys();
  if (keys.length > TILE_LIMIT) {
    for (const k of keys.slice(0, keys.length - TILE_LIMIT)) await c.delete(k);
  }
}

async function staleWhileRevalidate(req, cacheName, onStore) {
  const c = await caches.open(cacheName);
  const hit = await c.match(req);
  const net = fetch(req).then(async (res) => {
    if (res && (res.ok || res.type === "opaque")) {
      await c.put(req, res.clone());
      if (onStore) onStore();
    }
    return res;
  }).catch(() => null);
  if (hit) return hit;
  const res = await net;
  return res || new Response("", { status: 504 });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        const c = await caches.open(SHELL_CACHE);
        c.put("./index.html", res.clone());
        return res;
      } catch (err) {
        return (await caches.match("./index.html")) || (await caches.match("./")) || new Response("離線中，且尚未快取", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
    })());
    return;
  }

  if (/(^|\.)tile\.openstreetmap\.(org|fr)$/.test(url.hostname)) {
    e.respondWith(staleWhileRevalidate(req, TILE_CACHE, trimTiles));
    return;
  }

  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(staleWhileRevalidate(req, FONT_CACHE));
    return;
  }

  // 城市地圖檔由頁面自己下載存入 ss-maps，service worker 不攔截
  if (url.origin === self.location.origin && url.pathname.endsWith(".pmtiles")) return;

  if (url.origin === self.location.origin) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
});
