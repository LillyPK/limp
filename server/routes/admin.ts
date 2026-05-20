import { requireAuth, isResponse } from '../auth';
import { queries } from '../db';
import { decrypt, encryptJSON } from '../crypto';
import { ADMIN_PASSWORD, MUSIC_DIR } from '../config';
import { join, extname } from 'path';
import { mkdir } from 'fs/promises';

async function readEncryptedBody(req: Request): Promise<Uint8Array> {
	const buf = await req.arrayBuffer();
	return decrypt(new Uint8Array(buf), ADMIN_PASSWORD);
}

function encResp(data: unknown): Promise<Response> {
	return encryptJSON(data, ADMIN_PASSWORD).then(
		(enc) => new Response(enc, { headers: { 'Content-Type': 'application/octet-stream' } })
	);
}

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function handleAdminUploadSong(req: Request): Promise<Response> {
	const auth = requireAuth(req, 'admin');
	if (isResponse(auth)) return auth;

	// Body is an encrypted multipart-ish payload packed as JSON:
	// { title, album, artist, songName, songB64, artName, artB64 }
	const plain = await readEncryptedBody(req);
	const body = JSON.parse(new TextDecoder().decode(plain)) as {
		title: string;
		album: string;
		artist: string;
		songName: string;
		songB64: string;
		artName?: string;
		artB64?: string;
	};

	await mkdir(MUSIC_DIR, { recursive: true });

	const songExt = extname(body.songName) || '.audio';
	const songFilename = `${Date.now()}_song${songExt}`;
	const songPath = join(MUSIC_DIR, songFilename);
	await Bun.write(songPath, Buffer.from(body.songB64, 'base64'));

	let artPath = '';
	if (body.artB64 && body.artName) {
		const artExt = extname(body.artName) || '.jpg';
		const artFilename = `${Date.now()}_art${artExt}`;
		artPath = join(MUSIC_DIR, artFilename);
		await Bun.write(artPath, Buffer.from(body.artB64, 'base64'));
	}

	const song = queries.createSong.get(body.title, body.album, body.artist, artPath, songPath);

	// Auto-associate with album playlist by album name
	if (body.album?.trim()) {
		const { db } = await import('../db');
		let album = db.query<{ id: number }, [string]>(
			`SELECT id FROM playlists WHERE name = ? AND kind = 'album' LIMIT 1`
		).get(body.album.trim());
		if (!album) {
			const created = queries.createPlaylist.get(null, body.album.trim(), 'album');
			album = { id: created.id };
		}
		const row = queries.maxPositionInPlaylist.get(album.id);
		queries.addSongToPlaylist.run(album.id, song.id, (row?.max_pos ?? -1) + 1);
	}

	return encResp(song);
}

export async function handleAdminDeleteSong(req: Request, songId: number): Promise<Response> {
	const auth = requireAuth(req, 'admin');
	if (isResponse(auth)) return auth;

	const song = queries.getSongById.get(songId);
	if (!song) return new Response('Not Found', { status: 404 });

	queries.deleteSong.run(songId);
	return new Response(null, { status: 204 });
}

export async function handleAdminCreateUser(req: Request): Promise<Response> {
	const auth = requireAuth(req, 'admin');
	if (isResponse(auth)) return auth;

	const plain = await readEncryptedBody(req);
	const body = JSON.parse(new TextDecoder().decode(plain)) as {
		username: string;
		is_admin?: boolean;
	};

	const user = queries.createUser.get(body.username, body.is_admin ? 1 : 0);
	return encResp(user);
}

export async function handleAdminListUsers(req: Request): Promise<Response> {
	const auth = requireAuth(req, 'admin');
	if (isResponse(auth)) return auth;

	// Inline query since it's admin-only
	const { db } = await import('../db');
	const users = db.query('SELECT id, username, is_admin FROM users ORDER BY username').all();
	return encResp(users);
}

export async function handleAdminListSongs(req: Request): Promise<Response> {
	const auth = requireAuth(req, 'admin');
	if (isResponse(auth)) return auth;

	const songs = queries.listSongs.all();
	return encResp(songs);
}

export async function handleAdminCreateAlbum(req: Request): Promise<Response> {
	const auth = requireAuth(req, 'admin');
	if (isResponse(auth)) return auth;

	const plain = await readEncryptedBody(req);
	const body = JSON.parse(new TextDecoder().decode(plain)) as { name: string };
	const playlist = queries.createPlaylist.get(null, body.name, 'album');
	return encResp(playlist);
}

export async function handleAdminDeleteUser(req: Request, userId: number): Promise<Response> {
	const auth = requireAuth(req, 'admin');
	if (isResponse(auth)) return auth;

	const user = queries.getUserById.get(userId);
	if (!user) return json({ error: 'Not found' }, 404);

	const { db } = await import('../db');
	const adminCount = db.query<{ count: number }, []>(
		'SELECT COUNT(*) as count FROM users WHERE is_admin = 1'
	).get()!;
	if (user.is_admin && adminCount.count <= 1) {
		return json({ error: 'Cannot delete the last admin user' }, 400);
	}

	queries.deleteUser.run(userId);
	return new Response(null, { status: 204 });
}

export async function handleAdminDeleteAlbum(req: Request, albumId: number): Promise<Response> {
	const auth = requireAuth(req, 'admin');
	if (isResponse(auth)) return auth;

	const playlist = queries.getPlaylistById.get(albumId);
	if (!playlist || playlist.kind !== 'album') return json({ error: 'Not found' }, 404);

	queries.deletePlaylist.run(albumId);
	return new Response(null, { status: 204 });
}
