const CACHE = 'limp-v1';

// API list endpoints: cache so pages work offline (network-first)
function isCacheable(pathname) {
	return pathname === '/api/songs'
		|| pathname === '/api/playlists'
		|| pathname === '/api/albums'
		|| /^\/api\/playlists\/\d+\/songs$/.test(pathname);
}

self.addEventListener('install', (e) => {
	e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (e) => {
	e.waitUntil(
		caches.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (e) => {
	if (!e.request.url.startsWith(self.location.origin)) return;
	const url = new URL(e.request.url);

	if (url.pathname.startsWith('/api/')) {
		if (isCacheable(url.pathname)) {
			// Network-first: always try server, fall back to cache when offline
			e.respondWith(
				fetch(e.request.clone()).then((res) => {
					if (res.ok) {
						const clone = res.clone();
						caches.open(CACHE).then((c) => c.put(e.request, clone));
					}
					return res;
				}).catch(() => caches.match(e.request))
			);
		}
		// All other API paths (stream, art, login, admin, related): pass through
		return;
	}

	// Cache-first for app shell and static assets
	e.respondWith(
		caches.match(e.request).then((cached) => {
			if (cached) return cached;
			return fetch(e.request).then((res) => {
				if (res.ok && res.type === 'basic') {
					const clone = res.clone();
					caches.open(CACHE).then((c) => c.put(e.request, clone));
				}
				return res;
			});
		})
	);
});
