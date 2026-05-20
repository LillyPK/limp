import { writable } from 'svelte/store';

const DB_NAME = 'limp-offline';
const SONGS = 'songs';
const COLLECTIONS = 'collections';

export type StoredSong = {
	id: number;
	title: string;
	artist: string;
	album: string;
	blob: Blob;
	mimeType: string;
};

export type StoredCollection = {
	key: string; // `${type}:${id}`
	type: 'playlist' | 'album';
	id: number;
	name: string;
	songIds: number[];
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise;
	dbPromise = new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 2);
		req.onupgradeneeded = (e) => {
			const db = req.result;
			const old = e.oldVersion;
			if (old < 1) db.createObjectStore(SONGS, { keyPath: 'id' });
			if (old < 2) db.createObjectStore(COLLECTIONS, { keyPath: 'key' });
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
	return dbPromise;
}

function put<T>(store: string, value: T): Promise<void> {
	return openDb().then((db) => new Promise((resolve, reject) => {
		const tx = db.transaction(store, 'readwrite');
		tx.objectStore(store).put(value);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	}));
}

function getAll<T>(store: string): Promise<T[]> {
	return openDb().then((db) => new Promise((resolve, reject) => {
		const req = db.transaction(store).objectStore(store).getAll();
		req.onsuccess = () => resolve(req.result as T[]);
		req.onerror = () => reject(req.error);
	}));
}

// Songs
export async function saveSong(song: StoredSong): Promise<void> {
	return put(SONGS, song);
}

export async function getSong(id: number): Promise<StoredSong | null> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const req = db.transaction(SONGS).objectStore(SONGS).get(id);
		req.onsuccess = () => resolve((req.result as StoredSong) ?? null);
		req.onerror = () => reject(req.error);
	});
}

export async function getAllStoredSongs(): Promise<StoredSong[]> {
	return getAll<StoredSong>(SONGS);
}

export async function getStoredIds(): Promise<number[]> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const req = db.transaction(SONGS).objectStore(SONGS).getAllKeys();
		req.onsuccess = () => resolve(req.result as number[]);
		req.onerror = () => reject(req.error);
	});
}

// Collections (downloaded playlists / albums)
export async function saveCollection(
	type: 'playlist' | 'album',
	id: number,
	name: string,
	songIds: number[]
): Promise<void> {
	return put<StoredCollection>(COLLECTIONS, { key: `${type}:${id}`, type, id, name, songIds });
}

export async function getAllCollections(): Promise<StoredCollection[]> {
	return getAll<StoredCollection>(COLLECTIONS);
}

export async function clearAllSongs(): Promise<void> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction([SONGS, COLLECTIONS], 'readwrite');
		tx.objectStore(SONGS).clear();
		tx.objectStore(COLLECTIONS).clear();
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

// Reactive stores
export const offlineIds = writable<Set<number>>(new Set());
export const offlineCollections = writable<StoredCollection[]>([]);

export async function initOfflineStore(): Promise<void> {
	const [ids, collections] = await Promise.all([getStoredIds(), getAllCollections()]);
	offlineIds.set(new Set(ids));
	offlineCollections.set(collections);
}
