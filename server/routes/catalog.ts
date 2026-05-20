import { requireAuth, isResponse } from '../auth';
import { queries } from '../db';
import { encryptJSON, buildAudioStream } from '../crypto';
import { extname } from 'path';
import sharp from 'sharp';

const LQ_WIDTH = 200;

function reqPassword(req: Request): string {
	return req.headers.get('x-limp-password')!;
}

export async function handleGetSongArt(req: Request, songId: number): Promise<Response> {
	const auth = requireAuth(req);
	if (isResponse(auth)) return auth;
	const song = queries.getSongById.get(songId);
	if (!song || !song.album_art_path) return new Response(null, { status: 404 });
	const url = new URL(req.url);
	const lq = url.searchParams.has('lq');
	const artExt = extname(song.album_art_path).slice(1) || 'jpg';
	let artBytes: Uint8Array;
	try {
		artBytes = lq
			? new Uint8Array(await sharp(song.album_art_path).resize(LQ_WIDTH).toBuffer())
			: await Bun.file(song.album_art_path).bytes();
	} catch {
		return new Response(null, { status: 404 });
	}
	const artB64 = Buffer.from(artBytes).toString('base64');
	const enc = await encryptJSON({ artExt, artB64 }, reqPassword(req));
	return new Response(enc, { headers: { 'Content-Type': 'application/octet-stream' } });
}

export async function handleRelatedSongs(req: Request, songId: number): Promise<Response> {
	const auth = requireAuth(req);
	if (isResponse(auth)) return auth;
	const { db } = await import('../db');
	const song = queries.getSongById.get(songId);
	if (!song) return new Response('Not Found', { status: 404 });
	type SongRow = { id: number; title: string; album: string; artist: string; album_art_path: string; song_path: string };
	const related = db.query<SongRow, [string, string, number]>(
		`SELECT * FROM songs WHERE (artist = ? OR album = ?) AND id != ? ORDER BY album, title`
	).all(song.artist, song.album, songId);
	const enc = await encryptJSON(related, reqPassword(req));
	return new Response(enc, { headers: { 'Content-Type': 'application/octet-stream' } });
}

export async function handleListSongs(req: Request): Promise<Response> {
	const auth = requireAuth(req);
	if (isResponse(auth)) return auth;
	const songs = queries.listSongs.all();
	const enc = await encryptJSON(songs, reqPassword(req));
	return new Response(enc, { headers: { 'Content-Type': 'application/octet-stream' } });
}

export async function handleSearchSongs(req: Request): Promise<Response> {
	const auth = requireAuth(req);
	if (isResponse(auth)) return auth;
	const url = new URL(req.url);
	const q = `%${url.searchParams.get('q') ?? ''}%`;
	const songs = queries.searchSongs.all(q, q, q);
	const enc = await encryptJSON(songs, reqPassword(req));
	return new Response(enc, { headers: { 'Content-Type': 'application/octet-stream' } });
}

export async function handleStreamSong(req: Request, songId: number): Promise<Response> {
	const auth = requireAuth(req);
	if (isResponse(auth)) return auth;

	const song = queries.getSongById.get(songId);
	if (!song) return new Response('Not Found', { status: 404 });

	const url = new URL(req.url);
	const noArt = url.searchParams.has('no_album_art');
	const lqArt = url.searchParams.has('lq_album_art');

	const audioBytes = await Bun.file(song.song_path).bytes();
	const audioExt = extname(song.song_path).slice(1) || 'mp3';

	let artBytes: Uint8Array | null = null;
	let artExt = '';
	if (!noArt && song.album_art_path) {
		artExt = extname(song.album_art_path).slice(1) || 'jpg';
		if (lqArt) {
			artBytes = new Uint8Array(await sharp(song.album_art_path).resize(LQ_WIDTH).toBuffer());
		} else {
			artBytes = await Bun.file(song.album_art_path).bytes();
		}
	}

	const stream = await buildAudioStream(audioBytes, artBytes, artExt, reqPassword(req));

	return new Response(stream, {
		headers: {
			'Content-Type': 'application/octet-stream',
			'X-Audio-Ext': audioExt,
			'Cache-Control': 'no-store'
		}
	});
}
