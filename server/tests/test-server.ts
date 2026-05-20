// Minimal server for integration tests, runs on port 3001
import { handleLogin } from '../routes/auth';
import { handleListSongs, handleSearchSongs, handleStreamSong } from '../routes/catalog';

const server = Bun.serve({
	port: 3001,
	async fetch(req) {
		const url = new URL(req.url);
		const { pathname } = url;
		const method = req.method.toUpperCase();

		if (pathname === '/api/login' && method === 'POST') return handleLogin(req);
		if (pathname === '/api/songs' && method === 'GET') return handleListSongs(req);
		if (pathname === '/api/songs/search' && method === 'GET') return handleSearchSongs(req);

		const streamMatch = pathname.match(/^\/api\/songs\/(\d+)\/stream$/);
		if (streamMatch && method === 'GET') return handleStreamSong(req, parseInt(streamMatch[1], 10));

		return new Response('Not Found', { status: 404 });
	}
});

export default server;
