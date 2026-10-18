const CACHE_NAME = 'mango-royal-kiosk-v10';
const APP_SHELL = [
    '/index.html',
    '/manifest.webmanifest',
    '/assets/icons/kiosk-pwa.svg',
    '/js/pwa.js',
    '/js/status-check.js',
    '/js/app.js',
    '/js/loader.js',
    '/js/utils.js',
    '/js/splash.js',
    '/js/intro.js',
    '/js/orderType.js',
    '/js/mainMenu.js',
    '/js/productDetail.js',
    '/js/cart.js',
    '/js/navigation.js',
    '/js/review.js',
    '/js/payment.js',
    '/js/queue.js',
    '/components/splash.html',
    '/components/intro.html',
    '/components/orderType.html',
    '/components/mainMenu.html',
    '/components/productDetail.html',
    '/components/cart.html',
    '/components/review.html',
    '/components/payment.html',
    '/components/queue.html',
    '/css/index.css',
    '/css/splash.css',
    '/css/orderType.css',
    '/css/mainMenu.css',
    '/css/productDetail.css',
    '/css/cart.css',
    '/css/review.css',
    '/css/payment.css',
    '/css/queue.css'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => Promise.all(
                cacheNames
                    .filter((cacheName) => cacheName.startsWith('mango-royal-kiosk-') && cacheName !== CACHE_NAME)
                    .map((cacheName) => caches.delete(cacheName))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.origin !== self.location.origin) return;

    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request).catch(() => caches.match('/index.html'))
        );
        return;
    }

    if (!/\.(?:html|css|js|webmanifest|svg)$/i.test(url.pathname)) return;

    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            if (cachedResponse) return cachedResponse;
            return fetch(request).then((response) => {
                if (response.ok) {
                    const responseToCache = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache));
                }
                return response;
            });
        })
    );
});
