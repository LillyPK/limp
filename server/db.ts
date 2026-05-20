import { Database } from 'bun:sqlite';
import { join, dirname } from 'path';
import { mkdirSync } from 'fs';

const DB_PATH = join(import.meta.dir, '..', 'data', 'limp.db');

mkdirSync(dirname(DB_PATH), { recursive: true });
export const db = new Database(DB_PATH, { create: true });

db.exec(`PRAGMA journal_mode=WAL;`);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  username  TEXT NOT NULL UNIQUE,
  is_admin  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS songs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  title          TEXT NOT NULL,
  album          TEXT NOT NULL DEFAULT '',
  artist         TEXT NOT NULL DEFAULT '',
  album_art_path TEXT NOT NULL DEFAULT '',
  song_path      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playlists (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER REFERENCES users(id),
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK(kind IN ('user', 'album'))
);

CREATE TABLE IF NOT EXISTS playlist_songs (
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  song_id     INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, song_id)
);
`);

// Backfill: create album playlists for any songs that have an album name but no playlist yet
{
	const songsWithAlbum = db.query<{ id: number; album: string }, []>(
		`SELECT id, album FROM songs WHERE album != '' AND id NOT IN (SELECT song_id FROM playlist_songs ps JOIN playlists p ON ps.playlist_id = p.id WHERE p.kind = 'album')`
	).all();

	for (const song of songsWithAlbum) {
		let album = db.query<{ id: number }, [string]>(
			`SELECT id FROM playlists WHERE name = ? AND kind = 'album' LIMIT 1`
		).get(song.album);
		if (!album) {
			const row = db.query<{ id: number }, [string, string]>(
				`INSERT INTO playlists (owner_user_id, name, kind) VALUES (NULL, ?, 'album') RETURNING id`
			).get(song.album)!;
			album = row;
		}
		const pos = db.query<{ max_pos: number | null }, [number]>(
			`SELECT MAX(position) as max_pos FROM playlist_songs WHERE playlist_id = ?`
		).get(album.id);
		db.query(`INSERT OR IGNORE INTO playlist_songs (playlist_id, song_id, position) VALUES (?, ?, ?)`)
			.run(album.id, song.id, (pos?.max_pos ?? -1) + 1);
	}
}

export type User = { id: number; username: string; is_admin: number };
export type Song = {
	id: number;
	title: string;
	album: string;
	artist: string;
	album_art_path: string;
	song_path: string;
};
export type Playlist = { id: number; owner_user_id: number | null; name: string; kind: string };
export type PlaylistSong = { playlist_id: number; song_id: number; position: number };

export const queries = {
	getUserByUsername: db.query<User, [string]>(`SELECT * FROM users WHERE username = ?`),
	getUserById: db.query<User, [number]>(`SELECT * FROM users WHERE id = ?`),
	createUser: db.query<User, [string, number]>(
		`INSERT INTO users (username, is_admin) VALUES (?, ?) RETURNING *`
	),

	getSongById: db.query<Song, [number]>(`SELECT * FROM songs WHERE id = ?`),
	listSongs: db.query<Song, []>(`SELECT * FROM songs ORDER BY album, title`),
	searchSongs: db.query<Song, [string, string, string]>(
		`SELECT * FROM songs WHERE title LIKE ? OR album LIKE ? OR artist LIKE ? ORDER BY album, title`
	),
	createSong: db.query<Song, [string, string, string, string, string]>(
		`INSERT INTO songs (title, album, artist, album_art_path, song_path) VALUES (?, ?, ?, ?, ?) RETURNING *`
	),
	deleteSong: db.query<void, [number]>(`DELETE FROM songs WHERE id = ?`),
	deleteUser: db.query<void, [number]>(`DELETE FROM users WHERE id = ?`),

	getPlaylistById: db.query<Playlist, [number]>(`SELECT * FROM playlists WHERE id = ?`),
	listPlaylistsByUser: db.query<Playlist, [number]>(
		`SELECT * FROM playlists WHERE owner_user_id = ? AND kind = 'user' ORDER BY name`
	),
	listAlbums: db.query<Playlist, []>(
		`SELECT * FROM playlists WHERE kind = 'album' ORDER BY name`
	),
	createPlaylist: db.query<Playlist, [number | null, string, string]>(
		`INSERT INTO playlists (owner_user_id, name, kind) VALUES (?, ?, ?) RETURNING *`
	),
	deletePlaylist: db.query<void, [number]>(`DELETE FROM playlists WHERE id = ?`),
	renamePlaylist: db.query<void, [string, number]>(`UPDATE playlists SET name = ? WHERE id = ?`),

	getPlaylistSongs: db.query<Song, [number]>(`
    SELECT s.* FROM songs s
    JOIN playlist_songs ps ON ps.song_id = s.id
    WHERE ps.playlist_id = ?
    ORDER BY ps.position
  `),
	addSongToPlaylist: db.query<void, [number, number, number]>(
		`INSERT OR REPLACE INTO playlist_songs (playlist_id, song_id, position) VALUES (?, ?, ?)`
	),
	removeSongFromPlaylist: db.query<void, [number, number]>(
		`DELETE FROM playlist_songs WHERE playlist_id = ? AND song_id = ?`
	),
	maxPositionInPlaylist: db.query<{ max_pos: number | null }, [number]>(
		`SELECT MAX(position) as max_pos FROM playlist_songs WHERE playlist_id = ?`
	),
	reorderPlaylistSong: db.query<void, [number, number, number]>(
		`UPDATE playlist_songs SET position = ? WHERE playlist_id = ? AND song_id = ?`
	)
};
