/* ===================================================================
   RONT WEB APPS — SERVICE WORKER (PWA)
   ===================================================================
   Tanggung jawab file ini HANYA app-shell (HTML/CSS/JS statis + font
   & Chart.js dari CDN), supaya halaman tetap bisa dibuka walau offline.

   Data dashboard (getTicketsData, getTacticalData, dst) SENGAJA TIDAK
   di-cache di sini. Semua panggilan API ke GAS_EXEC_URL adalah POST
   lintas-origin ke script.google.com, dan Cache API tidak didesain
   untuk mem-versi-kan response POST berdasarkan body request (semua
   panggilan fn berbeda akan menimpa entry cache yang sama kalau
   dipaksakan). Cache "data terakhir" untuk mode offline ditangani di
   level aplikasi (lihat callGAS() di index.html), disimpan per-fn di
   localStorage -- bukan di service worker ini.
   =================================================================== */

const SHELL_CACHE  = 'ront-shell-v1';
const RUNTIME_CACHE = 'ront-runtime-v1';

// File yang WAJIB ada di app-shell. Path relatif terhadap lokasi sw.js
// (taruh sw.js di root yang sama dengan index.html/login.html).
const SHELL_FILES = [
  './',
  './index.html',
  './login.html',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => {
      // addAll akan gagal total kalau SATU saja resource gagal di-fetch
      // -- dipecah per-file supaya file yang berhasil tetap ke-cache
      // walau ada yang gagal (misal saat pertama kali di-deploy, salah
      // satu path belum ada).
      return Promise.all(
        SHELL_FILES.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[sw] gagal precache:', url, err);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // JANGAN pernah campur tangan pada request non-GET (semua panggilan
  // API ke GAS_EXEC_URL pakai POST) -- biarkan lewat langsung ke
  // jaringan seperti biasa, offline-fallback untuk data ditangani di
  // callGAS() pada index.html/login.html, bukan di sini.
  if (req.method !== 'GET') {
    return;
  }

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;

  if (isSameOrigin) {
    // App-shell sendiri: cache-first, lalu refresh cache di background.
    event.respondWith(
      caches.match(req).then((cached) => {
        const fetchPromise = fetch(req)
          .then((res) => {
            if (res && res.ok) {
              const clone = res.clone();
              caches.open(SHELL_CACHE).then((cache) => cache.put(req, clone));
            }
            return res;
          })
          .catch(() => cached);

        return cached || fetchPromise;
      })
    );
  } else {
    // Aset CDN (Google Fonts, Chart.js dari jsdelivr): stale-while-
    // revalidate, supaya chart tetap bisa dirender walau offline.
    // TIDAK berlaku untuk GAS_EXEC_URL karena itu selalu POST (sudah
    // ditangkap oleh guard method !== 'GET' di atas).
    event.respondWith(
      caches.open(RUNTIME_CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          const fetchPromise = fetch(req)
            .then((res) => {
              if (res && (res.ok || res.type === 'opaque')) {
                cache.put(req, res.clone());
              }
              return res;
            })
            .catch(() => cached);

          return cached || fetchPromise;
        })
      )
    );
  }
});
