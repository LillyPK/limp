import { decryptJSON, encryptJSON, decrypt, getKey, StreamReader } from './crypto';

export type Song = {
	id: number;
	title: string;
	album: string;
	artist: string;
	album_art_path: string;
	song_path: string;
};

export type Playlist = {
	id: number;
	owner_user_id: number | null;
	name: string;
	kind: string;
};

export type User = { id: number; username: string; is_admin: number };

export type Session = { user: User; password: string };

function headers(session: Session, extra: Record<string, string> = {}): HeadersInit {
	return {
		'x-limp-password': session.password,
		'x-limp-username': session.user.username,
		'x-limp-user-id': String(session.user.id),
		...extra
	};
}

async function getEncrypted<T>(url: string, session: Session): Promise<T> {
	const res = await fetch(url, { headers: headers(session) });
	if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
	const buf = await res.arrayBuffer();
	return decryptJSON<T>(new Uint8Array(buf), session.password);
}

async function postEncrypted<T>(url: string, body: unknown, session: Session, method = 'POST'): Promise<T | null> {
	const enc = await encryptJSON(body, session.password);
	const res = await fetch(url, {
		method,
		headers: headers(session, { 'Content-Type': 'application/octet-stream' }),
		body: enc
	});
	if (res.status === 204) return null;
	if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
	const buf = await res.arrayBuffer();
	return decryptJSON<T>(new Uint8Array(buf), session.password);
}

// Auth
export async function login(username: string, password: string): Promise<{ ok: boolean; user?: User; error?: string }> {
	const res = await fetch('/api/login', {
		method: 'POST',
		headers: { 'x-limp-username': username, 'x-limp-password': password }
	});
	const body = await res.json() as { ok: boolean; user?: User; error?: string };
	// Pre-warm the key cache so first playback is instant
	if (body.ok) getKey(password).catch(() => {});
	return body;
}

// Catalog
export function listSongs(session: Session): Promise<Song[]> {
	return getEncrypted<Song[]>('/api/songs', session);
}

export function searchSongs(q: string, session: Session): Promise<Song[]> {
	return getEncrypted<Song[]>(`/api/songs/search?q=${encodeURIComponent(q)}`, session);
}

const AUDIO_MIME: Record<string, string> = {
	mp3: 'audio/mpeg', mp4: 'audio/mp4', ogg: 'audio/ogg',
	wav: 'audio/wav', flac: 'audio/flac', aac: 'audio/aac', webm: 'audio/webm'
};

export type StreamCallbacks = {
	onArt?: (url: string) => void;
	onAudioUrl?: (url: string) => void; // MediaSource object URL, ready to assign
};

// Streams an encrypted song from the server, decrypts chunk-by-chunk.
// Calls onArt as soon as art is decrypted, feeds audio to MediaSource for immediate playback.
// Returns a cleanup function.
export async function streamSong(
	songId: number,
	session: Session,
	artMode: 'full' | 'none' | 'lq' = 'full',
	callbacks: StreamCallbacks = {}
): Promise<() => void> {
	const params = artMode === 'none' ? '?no_album_art' : artMode === 'lq' ? '?lq_album_art' : '';
	const res = await fetch(`/api/songs/${songId}/stream${params}`, { headers: headers(session) });
	if (!res.ok) throw new Error(`${res.status}`);
	if (!res.body) throw new Error('no response body');

	const audioExt = res.headers.get('X-Audio-Ext') ?? 'mp3';
	const mimeType = AUDIO_MIME[audioExt] ?? 'audio/mpeg';
	const key = await getKey(session.password);
	const reader = new StreamReader(res.body);

	const mediaSource = new MediaSource();
	const audioUrl = URL.createObjectURL(mediaSource);
	callbacks.onAudioUrl?.(audioUrl);

	let sourceBuffer: SourceBuffer | null = null;
	const pendingChunks: Uint8Array[] = [];
	let streamDone = false;

	function appendNext() {
		if (!sourceBuffer || sourceBuffer.updating) return;
		if (pendingChunks.length > 0) {
			sourceBuffer.appendBuffer(pendingChunks.shift()!);
		} else if (streamDone && mediaSource.readyState === 'open') {
			mediaSource.endOfStream();
		}
	}

	mediaSource.addEventListener('sourceopen', () => {
		try {
			sourceBuffer = mediaSource.addSourceBuffer(mimeType);
			sourceBuffer.addEventListener('updateend', appendNext);
			appendNext();
		} catch {
			// MediaSource not supported for this type — fall back handled below
		}
	});

	// Stream loop (runs in background)
	(async () => {
		try {
			// 1. Art header
			const artLen = await reader.readU32();
			if (artLen > 0) {
				const artEnc = await reader.readBytes(artLen);
				const iv = artEnc.slice(0, 12);
				const ct = artEnc.slice(12);
				const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
				const { artExt, artB64 } = JSON.parse(new TextDecoder().decode(plain)) as { artExt: string; artB64: string };
				const artBytes = Uint8Array.from(atob(artB64), c => c.charCodeAt(0));
				const artUrl = URL.createObjectURL(new Blob([artBytes], { type: `image/${artExt}` }));
				callbacks.onArt?.(artUrl);
			}

			// 2. Audio chunks
			let chunkLen: number;
			while ((chunkLen = await reader.readU32()) > 0) {
				const enc = await reader.readBytes(chunkLen);
				const iv = enc.slice(0, 12);
				const ct = enc.slice(12);
				const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct));
				pendingChunks.push(plain);
				appendNext();
			}
		} catch {
			// stream read error — ignore, mediaSource will error naturally
		} finally {
			streamDone = true;
			appendNext();
		}
	})();

	return () => URL.revokeObjectURL(audioUrl);
}

// Downloads and decrypts the full audio for a song (no art). Returns a Blob ready for IndexedDB.
export async function downloadSongAudio(
	songId: number,
	session: Session
): Promise<{ data: Blob; mimeType: string }> {
	const res = await fetch(`/api/songs/${songId}/stream?no_album_art`, { headers: headers(session) });
	if (!res.ok) throw new Error(`${res.status}`);
	if (!res.body) throw new Error('no response body');

	const audioExt = res.headers.get('X-Audio-Ext') ?? 'mp3';
	const mimeType = AUDIO_MIME[audioExt] ?? 'audio/mpeg';
	const key = await getKey(session.password);
	const reader = new StreamReader(res.body);

	// Skip art section
	const artLen = await reader.readU32();
	if (artLen > 0) await reader.readBytes(artLen);

	// Collect all decrypted audio chunks into one Blob
	const chunks: Uint8Array[] = [];
	let chunkLen: number;
	while ((chunkLen = await reader.readU32()) > 0) {
		const enc = await reader.readBytes(chunkLen);
		const iv = enc.slice(0, 12);
		const ct = enc.slice(12);
		chunks.push(new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)));
	}

	return { data: new Blob(chunks, { type: mimeType }), mimeType };
}

export function getRelatedSongs(songId: number, session: Session): Promise<Song[]> {
	return getEncrypted<Song[]>(`/api/songs/${songId}/related`, session);
}

export async function getSongArt(songId: number, session: Session, lq = false): Promise<string> {
	const params = lq ? '?lq' : '';
	const res = await fetch(`/api/songs/${songId}/art${params}`, { headers: headers(session) });
	if (!res.ok) return '';
	const buf = await res.arrayBuffer();
	const { artExt, artB64 } = await decryptJSON<{ artExt: string; artB64: string }>(new Uint8Array(buf), session.password);
	const artBytes = Uint8Array.from(atob(artB64), c => c.charCodeAt(0));
	return URL.createObjectURL(new Blob([artBytes], { type: `image/${artExt}` }));
}

// Playlists
export function listPlaylists(session: Session): Promise<Playlist[]> {
	return getEncrypted<Playlist[]>('/api/playlists', session);
}

export function listAlbums(session: Session): Promise<Playlist[]> {
	return getEncrypted<Playlist[]>('/api/albums', session);
}

export function getPlaylistSongs(playlistId: number, session: Session): Promise<Song[]> {
	return getEncrypted<Song[]>(`/api/playlists/${playlistId}/songs`, session);
}

export function createPlaylist(name: string, session: Session): Promise<Playlist> {
	return postEncrypted<Playlist>('/api/playlists', { name, userId: session.user.id }, session) as Promise<Playlist>;
}

export function deletePlaylist(playlistId: number, session: Session): Promise<null> {
	return fetch(`/api/playlists/${playlistId}`, { method: 'DELETE', headers: headers(session) }).then(() => null);
}

export function renamePlaylist(playlistId: number, name: string, session: Session): Promise<null> {
	return postEncrypted<null>(`/api/playlists/${playlistId}`, { name }, session, 'PATCH');
}

export function addSongToPlaylist(playlistId: number, songId: number, session: Session): Promise<null> {
	return postEncrypted<null>(`/api/playlists/${playlistId}/songs`, { songId }, session);
}

export function removeSongFromPlaylist(playlistId: number, songId: number, session: Session): Promise<null> {
	return postEncrypted<null>(`/api/playlists/${playlistId}/songs`, { songId }, session, 'DELETE');
}

export function reorderPlaylistSong(playlistId: number, songId: number, position: number, session: Session): Promise<null> {
	return postEncrypted<null>(`/api/playlists/${playlistId}/songs`, { songId, position }, session, 'PATCH');
}

function toBase64(bytes: Uint8Array): string {
	let binary = '';
	const chunk = 8192;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

// Admin
export async function adminUploadSong(
	title: string, album: string, artist: string,
	songFile: File, artFile: File | null,
	session: Session
): Promise<Song> {
	const songB64 = toBase64(new Uint8Array(await songFile.arrayBuffer()));
	let artB64: string | undefined;
	let artName: string | undefined;
	if (artFile) {
		artB64 = toBase64(new Uint8Array(await artFile.arrayBuffer()));
		artName = artFile.name;
	}

	const enc = await encryptJSON(
		{ title, album, artist, songName: songFile.name, songB64, artName, artB64 },
		session.password
	);
	const res = await fetch('/api/admin/songs', {
		method: 'POST',
		headers: headers(session, { 'Content-Type': 'application/octet-stream' }),
		body: enc
	});
	if (!res.ok) throw new Error(`${res.status}`);
	const buf = await res.arrayBuffer();
	return decryptJSON<Song>(new Uint8Array(buf), session.password);
}

export function adminListSongs(session: Session): Promise<Song[]> {
	return getEncrypted<Song[]>('/api/admin/songs', session);
}

export function adminDeleteSong(songId: number, session: Session): Promise<null> {
	return fetch(`/api/admin/songs/${songId}`, { method: 'DELETE', headers: headers(session) }).then(() => null);
}

export function adminListUsers(session: Session): Promise<User[]> {
	return getEncrypted<User[]>('/api/admin/users', session);
}

export function adminCreateUser(username: string, isAdmin: boolean, session: Session): Promise<User> {
	return postEncrypted<User>('/api/admin/users', { username, is_admin: isAdmin }, session) as Promise<User>;
}

export function adminCreateAlbum(name: string, session: Session): Promise<Playlist> {
	return postEncrypted<Playlist>('/api/admin/albums', { name }, session) as Promise<Playlist>;
}

export function adminDeleteUser(userId: number, session: Session): Promise<null> {
	return fetch(`/api/admin/users/${userId}`, { method: 'DELETE', headers: headers(session) }).then(() => null);
}

export function adminDeleteAlbum(albumId: number, session: Session): Promise<null> {
	return fetch(`/api/admin/albums/${albumId}`, { method: 'DELETE', headers: headers(session) }).then(() => null);
}
