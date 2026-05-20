import { requireAuth, isResponse } from '../auth';
import { queries } from '../db';
import { encryptJSON, decryptJSON } from '../crypto';

function reqPassword(req: Request): string {
	return req.headers.get('x-limp-password')!;
}

async function readBody(req: Request): Promise<unknown> {
	const buf = await req.arrayBuffer();
	return decryptJSON(new Uint8Array(buf), reqPassword(req));
}

function encResp(data: unknown, password: string): Promise<Response> {
	return encryptJSON(data, password).then(
		(enc) => new Response(enc, { headers: { 'Content-Type': 'application/octet-stream' } })
	);
}

export async function handleListPlaylists(req: Request): Promise<Response> {
	const auth = requireAuth(req);
	if (isResponse(auth)) return auth;

	const userId = parseInt(req.headers.get('x-limp-user-id') ?? '0', 10);
	const playlists = queries.listPlaylistsByUser.all(userId);
	return encResp(playlists, reqPassword(req));
}

export async function handleListAlbums(req: Request): Promise<Response> {
	const auth = requireAuth(req);
	if (isResponse(auth)) return auth;

	const albums = queries.listAlbums.all();
	return encResp(albums, reqPassword(req));
}

export async function handleGetPlaylistSongs(req: Request, playlistId: number): Promise<Response> {
	const auth = requireAuth(req);
	if (isResponse(auth)) return auth;

	const playlist = queries.getPlaylistById.get(playlistId);
	if (!playlist) return new Response('Not Found', { status: 404 });

	const songs = queries.getPlaylistSongs.all(playlistId);
	return encResp(songs, reqPassword(req));
}

export async function handleCreatePlaylist(req: Request): Promise<Response> {
	const auth = requireAuth(req);
	if (isResponse(auth)) return auth;

	const body = (await readBody(req)) as { name: string; userId: number };
	const playlist = queries.createPlaylist.get(body.userId, body.name, 'user');
	return encResp(playlist, reqPassword(req));
}

export async function handleDeletePlaylist(req: Request, playlistId: number): Promise<Response> {
	const auth = requireAuth(req);
	if (isResponse(auth)) return auth;

	const userId = parseInt(req.headers.get('x-limp-user-id') ?? '0', 10);
	const playlist = queries.getPlaylistById.get(playlistId);
	if (!playlist) return new Response('Not Found', { status: 404 });
	if (playlist.owner_user_id !== userId) return new Response('Forbidden', { status: 403 });

	queries.deletePlaylist.run(playlistId);
	return new Response(null, { status: 204 });
}

export async function handleRenamePlaylist(req: Request, playlistId: number): Promise<Response> {
	const auth = requireAuth(req);
	if (isResponse(auth)) return auth;

	const userId = parseInt(req.headers.get('x-limp-user-id') ?? '0', 10);
	const playlist = queries.getPlaylistById.get(playlistId);
	if (!playlist) return new Response('Not Found', { status: 404 });
	if (playlist.owner_user_id !== userId) return new Response('Forbidden', { status: 403 });

	const body = (await readBody(req)) as { name: string };
	queries.renamePlaylist.run(body.name, playlistId);
	return new Response(null, { status: 204 });
}

export async function handleAddSongToPlaylist(req: Request, playlistId: number): Promise<Response> {
	const auth = requireAuth(req);
	if (isResponse(auth)) return auth;

	const userId = parseInt(req.headers.get('x-limp-user-id') ?? '0', 10);
	const playlist = queries.getPlaylistById.get(playlistId);
	if (!playlist) return new Response('Not Found', { status: 404 });
	if (playlist.kind === 'user' && playlist.owner_user_id !== userId)
		return new Response('Forbidden', { status: 403 });
	if (playlist.kind === 'album' && auth !== 'admin') return new Response('Forbidden', { status: 403 });

	const body = (await readBody(req)) as { songId: number };
	const row = queries.maxPositionInPlaylist.get(playlistId);
	const pos = (row?.max_pos ?? -1) + 1;
	queries.addSongToPlaylist.run(playlistId, body.songId, pos);
	return new Response(null, { status: 204 });
}

export async function handleRemoveSongFromPlaylist(req: Request, playlistId: number): Promise<Response> {
	const auth = requireAuth(req);
	if (isResponse(auth)) return auth;

	const userId = parseInt(req.headers.get('x-limp-user-id') ?? '0', 10);
	const playlist = queries.getPlaylistById.get(playlistId);
	if (!playlist) return new Response('Not Found', { status: 404 });
	if (playlist.kind === 'user' && playlist.owner_user_id !== userId)
		return new Response('Forbidden', { status: 403 });
	if (playlist.kind === 'album' && auth !== 'admin') return new Response('Forbidden', { status: 403 });

	const body = (await readBody(req)) as { songId: number };
	queries.removeSongFromPlaylist.run(playlistId, body.songId);
	return new Response(null, { status: 204 });
}

export async function handleReorderPlaylistSong(req: Request, playlistId: number): Promise<Response> {
	const auth = requireAuth(req);
	if (isResponse(auth)) return auth;

	const userId = parseInt(req.headers.get('x-limp-user-id') ?? '0', 10);
	const playlist = queries.getPlaylistById.get(playlistId);
	if (!playlist) return new Response('Not Found', { status: 404 });
	if (playlist.kind === 'user' && playlist.owner_user_id !== userId)
		return new Response('Forbidden', { status: 403 });
	if (playlist.kind === 'album' && auth !== 'admin') return new Response('Forbidden', { status: 403 });

	const body = (await readBody(req)) as { songId: number; position: number };
	queries.reorderPlaylistSong.run(body.position, playlistId, body.songId);
	return new Response(null, { status: 204 });
}
