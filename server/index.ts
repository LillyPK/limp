import { PORT } from './config';
import { db, queries } from './db';
import { handleLogin } from './routes/auth';
import {
	handleListSongs,
	handleSearchSongs,
	handleStreamSong,
	handleGetSongArt,
	handleRelatedSongs
} from './routes/catalog';
import {
	handleListPlaylists,
	handleListAlbums,
	handleGetPlaylistSongs,
	handleCreatePlaylist,
	handleDeletePlaylist,
	handleRenamePlaylist,
	handleAddSongToPlaylist,
	handleRemoveSongFromPlaylist,
	handleReorderPlaylistSong
} from './routes/playlists';
import {
	handleAdminUploadSong,
	handleAdminDeleteSong,
	handleAdminCreateUser,
	handleAdminListUsers,
	handleAdminListSongs,
	handleAdminCreateAlbum,
	handleAdminDeleteUser,
	handleAdminDeleteAlbum
} from './routes/admin';
import { join } from 'path';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';

const CLIENT_BUILD = join(import.meta.dir, '..', 'client', 'build');

// Compute SHA-256 hashes of SvelteKit's inline bootstrap scripts so we can
// whitelist them in CSP without 'unsafe-inline'. Re-runs on each server start
// so a rebuild automatically picks up the new hash.
function inlineScriptHashes(htmlPath: string): string[] {
	try {
		const html = readFileSync(htmlPath, 'utf8');
		return [...html.matchAll(/<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/g)]
			.map(m => m[1])
			.filter(s => s.trim())
			.map(s => `'sha256-${createHash('sha256').update(s).digest('base64')}'`);
	} catch {
		return [];
	}
}

const scriptHashes = inlineScriptHashes(join(CLIENT_BUILD, 'index.html'));

const CSP = [
	"default-src 'self'",
	`script-src 'self' ${scriptHashes.join(' ')}`.trimEnd(),
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' blob: data:",
	"media-src blob:",
	"connect-src 'self'",
	"worker-src 'self'",
	"frame-ancestors 'none'",
].join('; ');

function withSecurityHeaders(res: Response, isHttps: boolean): Response {
	const h = new Headers(res.headers);
	h.set('Content-Security-Policy', CSP);
	h.set('X-Content-Type-Options', 'nosniff');
	h.set('X-Frame-Options', 'DENY');
	h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	if (isHttps) h.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
	return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

// Allowlist of every path this app legitimately serves.
// Anything not matched here gets a 404 before it reaches handlers or static files.
const ALLOWED_PAGES = [
	/^\/$/, /^\/login$/, /^\/albums$/, /^\/playlists$/, /^\/search$/, /^\/admin$/,
];

const ALLOWED_API = [
	/^\/api\/login$/,
	/^\/api\/songs$/, /^\/api\/songs\/search$/,
	/^\/api\/songs\/\d+\/stream$/, /^\/api\/songs\/\d+\/art$/, /^\/api\/songs\/\d+\/related$/,
	/^\/api\/playlists$/, /^\/api\/albums$/,
	/^\/api\/playlists\/\d+$/, /^\/api\/playlists\/\d+\/songs$/,
	/^\/api\/admin\/songs$/, /^\/api\/admin\/songs\/\d+$/,
	/^\/api\/admin\/users$/, /^\/api\/admin\/users\/\d+$/,
	/^\/api\/admin\/albums$/, /^\/api\/admin\/albums\/\d+$/,
];

const STATIC_ROOTS = new Set([
	'/sw.js', '/favicon.svg', '/manifest.webmanifest', '/robots.txt',
	'/apple-touch-icon.png', '/icon.svg', '/icon-192.png', '/icon-512.png',
]);

function isAllowed(pathname: string): boolean {
	if (pathname.startsWith('/_app/') || STATIC_ROOTS.has(pathname)) return true;
	return ALLOWED_PAGES.some(re => re.test(pathname)) || ALLOWED_API.some(re => re.test(pathname));
}

function serveStatic(pathname: string): Promise<Response> | null {
	const candidates = [
		join(CLIENT_BUILD, pathname),
		join(CLIENT_BUILD, pathname, 'index.html'),
		join(CLIENT_BUILD, 'index.html') // SPA fallback
	];

	const MIME: Record<string, string> = {
		'.webmanifest': 'application/manifest+json',
		'.js': 'application/javascript',
		'.wasm': 'application/wasm',
	};

	// Bypass Pinggy's interstitial warning page so the browser sees the real app
	const BASE_HEADERS: Record<string, string> = {
		'x-pinggy-no-hint': '1',
	};

	async function tryFiles(paths: string[]): Promise<Response> {
		for (const p of paths) {
			const f = Bun.file(p);
			if (await f.exists()) {
				const ext = p.slice(p.lastIndexOf('.'));
				const headers: Record<string, string> = { ...BASE_HEADERS };
				if (MIME[ext]) headers['Content-Type'] = MIME[ext];
				// SW must not be cached so browsers always get the latest version
				if (p.endsWith('sw.js')) headers['Cache-Control'] = 'no-cache';
				return new Response(f, { headers });
			}
		}
		// SPA fallback always exists if built
		return new Response(Bun.file(join(CLIENT_BUILD, 'index.html')), { headers: BASE_HEADERS });
	}

	return tryFiles(candidates);
}

const server = Bun.serve({
	port: PORT,
	async fetch(req) {
		const url = new URL(req.url);
		const { pathname } = url;
		const method = req.method.toUpperCase();
		const isHttps = req.headers.get('x-forwarded-proto') === 'https';

		const res = await route(req, url, pathname, method);
		return withSecurityHeaders(res, isHttps);
	},
	error(err) {
		console.error(err);
		return new Response('Internal Server Error', { status: 500 });
	}
});

async function route(req: Request, url: URL, pathname: string, method: string): Promise<Response> {
	if (!isAllowed(pathname)) return new Response('Not Found', { status: 404 });

	// --- API routes ---
	if (pathname === '/api/login' && method === 'POST') return handleLogin(req);

	if (pathname === '/api/songs' && method === 'GET') return handleListSongs(req);
	if (pathname === '/api/songs/search' && method === 'GET') return handleSearchSongs(req);

	const streamMatch = pathname.match(/^\/api\/songs\/(\d+)\/stream$/);
	if (streamMatch && method === 'GET') return handleStreamSong(req, parseInt(streamMatch[1], 10));

	const artMatch = pathname.match(/^\/api\/songs\/(\d+)\/art$/);
	if (artMatch && method === 'GET') return handleGetSongArt(req, parseInt(artMatch[1], 10));

	const relatedMatch = pathname.match(/^\/api\/songs\/(\d+)\/related$/);
	if (relatedMatch && method === 'GET') return handleRelatedSongs(req, parseInt(relatedMatch[1], 10));

	if (pathname === '/api/playlists' && method === 'GET') return handleListPlaylists(req);
	if (pathname === '/api/playlists' && method === 'POST') return handleCreatePlaylist(req);
	if (pathname === '/api/albums' && method === 'GET') return handleListAlbums(req);

	const playlistMatch = pathname.match(/^\/api\/playlists\/(\d+)$/);
	if (playlistMatch) {
		const id = parseInt(playlistMatch[1], 10);
		if (method === 'DELETE') return handleDeletePlaylist(req, id);
		if (method === 'PATCH') return handleRenamePlaylist(req, id);
	}

	const playlistSongsMatch = pathname.match(/^\/api\/playlists\/(\d+)\/songs$/);
	if (playlistSongsMatch) {
		const id = parseInt(playlistSongsMatch[1], 10);
		if (method === 'GET') return handleGetPlaylistSongs(req, id);
		if (method === 'POST') return handleAddSongToPlaylist(req, id);
		if (method === 'DELETE') return handleRemoveSongFromPlaylist(req, id);
		if (method === 'PATCH') return handleReorderPlaylistSong(req, id);
	}

	// --- Admin routes ---
	if (pathname === '/api/admin/songs' && method === 'GET') return handleAdminListSongs(req);
	if (pathname === '/api/admin/songs' && method === 'POST') return handleAdminUploadSong(req);

	const adminSongMatch = pathname.match(/^\/api\/admin\/songs\/(\d+)$/);
	if (adminSongMatch && method === 'DELETE') return handleAdminDeleteSong(req, parseInt(adminSongMatch[1], 10));

	if (pathname === '/api/admin/users' && method === 'GET') return handleAdminListUsers(req);
	if (pathname === '/api/admin/users' && method === 'POST') return handleAdminCreateUser(req);
	if (pathname === '/api/admin/albums' && method === 'POST') return handleAdminCreateAlbum(req);

	const adminUserMatch = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
	if (adminUserMatch && method === 'DELETE') return handleAdminDeleteUser(req, parseInt(adminUserMatch[1], 10));

	const adminAlbumMatch = pathname.match(/^\/api\/admin\/albums\/(\d+)$/);
	if (adminAlbumMatch && method === 'DELETE') return handleAdminDeleteAlbum(req, parseInt(adminAlbumMatch[1], 10));

	// --- Static / SPA ---
	const staticResp = await serveStatic(pathname === '/' ? '/index.html' : pathname);
	if (staticResp) return staticResp;

	return new Response('Not Found', { status: 404 });
}

// Bootstrap: ensure at least one admin user exists on first run
const adminExists = db.query<{ count: number }, []>('SELECT COUNT(*) as count FROM users WHERE is_admin = 1').get();
if (!adminExists || adminExists.count === 0) {
	queries.createUser.get('admin', 1);
	console.log('Created default admin user: admin');
}

console.log(`limp server running on http://localhost:${server.port}`);
