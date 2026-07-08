const CACHE_NAME = 'polinasi-cache-v1';
const ASSETS = ['./index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  e.respondWith(caches.match(e.request).then((res) => res || fetch(e.request)));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (clients.openWindow) return clients.openWindow('./index.html');
    })
  );
});

// ================= Pengecekan tenggat di latar belakang =================
// Berjalan lewat Periodic Background Sync (kalau didukung HP/browser),
// membaca data dari IndexedDB yang disimpan oleh halaman utama.
const HARI_KE_SERBUK = 9;
const HARI_KE_BUKA = 15;
const DB_NAME = 'polinasiDB', STORE_ROWS = 'rows', STORE_NOTIFIED = 'notified';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_ROWS)) db.createObjectStore(STORE_ROWS, { keyPath: '_id' });
      if (!db.objectStoreNames.contains(STORE_NOTIFIED)) db.createObjectStore(STORE_NOTIFIED, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function getAll(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function putRecord(db, storeName, record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
function addDays(ms, n) { return ms + n * 86400000; }
function dayFloor(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }

async function checkDeadlinesAndNotify() {
  try {
    const db = await openDB();
    const rows = await getAll(db, STORE_ROWS);
    const notified = await getAll(db, STORE_NOTIFIED);
    const notifiedKeys = new Set(notified.map((n) => n.key));
    const today = dayFloor(Date.now());

    for (const r of rows) {
      if (r.tgl_buka_bungkus) continue; // sudah dibuka, tak perlu notifikasi tenggat lagi

      const deadlineServuk = addDays(r.tgl_bungkus, HARI_KE_SERBUK);
      const actualServuk = r.tgl_penyerbukan || null;
      let activeDeadline, activeLabel;
      if (actualServuk) {
        activeDeadline = addDays(actualServuk, HARI_KE_BUKA);
        activeLabel = 'Batas Buka Bungkus';
      } else {
        activeDeadline = deadlineServuk;
        activeLabel = 'Batas Penyerbukan';
      }

      const dDiff = Math.round((activeDeadline - today) / 86400000);
      if (dDiff <= 0) {
        const key = r._id + '|' + activeLabel + '|' + activeDeadline;
        if (!notifiedKeys.has(key)) {
          const title = `${r.pos_blok} / ${r.no_pohon}`;
          const body = dDiff < 0
            ? `Terlambat ${Math.abs(dDiff)} hari untuk ${activeLabel.toLowerCase()}.`
            : `${activeLabel} jatuh tempo hari ini.`;
          await self.registration.showNotification(title, {
            body, icon: 'icon-192.png', badge: 'icon-192.png', tag: key,
          });
          await putRecord(db, STORE_NOTIFIED, { key, at: Date.now() });
        }
      }
    }
  } catch (e) {
    // IndexedDB belum terisi atau browser tidak mendukung — abaikan diam-diam
  }
}

self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'check-polinasi') e.waitUntil(checkDeadlinesAndNotify());
});

// fallback untuk browser yang cuma dukung background sync biasa (bukan periodic)
self.addEventListener('sync', (e) => {
  if (e.tag === 'check-polinasi') e.waitUntil(checkDeadlinesAndNotify());
});
