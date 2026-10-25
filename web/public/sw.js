// service worker آسان دسک وب: برنامه نصب‌شدنی می‌شود و پوستهٔ صفحه بدون اینترنت هم باز می‌شود.
// فقط فایل‌های خود سایت ذخیره می‌شوند؛ API، وب‌سوکت‌ها و هر چیز دیگر مستقیم به شبکه می‌رود.
const CACHE = 'asandesk-web-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/favicon.svg'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) return;
  if (req.mode === 'navigate') {
    // صفحه همیشه تازه از سرور؛ بدون اینترنت نسخهٔ ذخیره‌شده
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    // نام فایل‌های بیلد هش دارد و عوض نمی‌شود
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
  }
});
