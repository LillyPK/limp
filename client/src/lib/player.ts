import { writable, get } from 'svelte/store';
import { streamSong, type Song, type Session } from './api';
import { artMode } from './settings';
import { getSong } from './offline';

export type ContextType = 'library' | 'playlist' | 'album' | 'search' | 'related';
export type RepeatMode = null | 'context' | 'song';
export const repeatMode = writable<RepeatMode>(null);

export type PlayerState = {
	song: Song;
	audioUrl: string;
	artUrl: string;
	loading: boolean;
	queue: Song[];
	queueIndex: number;
	contextType: ContextType | null;
};

export const player = writable<PlayerState | null>(null);
export const playerError = writable<string>('');
export const playerExpanded = writable<boolean>(false);

let currentCleanup: (() => void) | null = null;

export async function playTrack(
	song: Song,
	session: Session,
	queue: Song[] = [],
	contextType: ContextType | null = null
) {
	// Clean up previous stream's object URL
	if (currentCleanup) { currentCleanup(); currentCleanup = null; }

	const idx = queue.findIndex(s => s.id === song.id);
	player.set({ song, audioUrl: '', artUrl: '', loading: true, queue, queueIndex: idx >= 0 ? idx : 0, contextType });
	playerError.set('');
	try {
		// Play from offline storage if available
		const offline = await getSong(song.id);
		if (offline) {
			const url = URL.createObjectURL(offline.blob);
			player.update(s => s ? { ...s, audioUrl: url, loading: false } : null);
			currentCleanup = () => URL.revokeObjectURL(url);
			return;
		}

		const mode = get(artMode);
		const cleanup = await streamSong(song.id, session, mode, {
			onAudioUrl: (url) => {
				player.update(s => s ? { ...s, audioUrl: url, loading: false } : null);
			},
			onArt: (url) => {
				player.update(s => s ? { ...s, artUrl: url } : null);
			}
		});
		currentCleanup = cleanup;
	} catch (e) {
		playerError.set(String(e));
		player.set(null);
	}
}

export async function playAtIndex(index: number, session: Session) {
	const state = get(player);
	if (!state || index < 0 || index >= state.queue.length) return;
	await playTrack(state.queue[index], session, state.queue, state.contextType);
}
