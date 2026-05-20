<script lang="ts">
	import { onMount } from 'svelte';
	import { session } from '$lib/session';
	import { playTrack } from '$lib/player';
	import {
		listPlaylists, getPlaylistSongs, createPlaylist, deletePlaylist,
		renamePlaylist, addSongToPlaylist, removeSongFromPlaylist,
		listSongs, downloadSongAudio,
		type Playlist, type Song
	} from '$lib/api';
	import { offlineIds, offlineCollections, saveSong, saveCollection, getAllStoredSongs } from '$lib/offline';

	let playlists = $state<Playlist[]>([]);
	let allSongs = $state<Song[]>([]);
	let selected = $state<Playlist | null>(null);
	let selectedSongs = $state<Song[]>([]);
	let loading = $state(true);
	let error = $state('');
	let isOffline = $state(false);
	let newName = $state('');
	let renameTarget = $state<Playlist | null>(null);
	let renameValue = $state('');
	let showAddSongs = $state(false);

	// Drag state
	let listEl = $state<HTMLElement | null>(null);
	let dragIdx = $state<number | null>(null);
	let dropIdx = $state<number | null>(null);

	function orderKey(id: number) { return `limp-order-playlist-${id}`; }

	function applyOrder(songs: Song[], id: number): Song[] {
		try {
			const raw = localStorage.getItem(orderKey(id));
			if (!raw) return songs;
			const ids: number[] = JSON.parse(raw);
			const map = new Map(songs.map(s => [s.id, s]));
			const ordered = ids.map(id => map.get(id)).filter(Boolean) as Song[];
			// Append any new songs not in saved order
			const seen = new Set(ids);
			songs.filter(s => !seen.has(s.id)).forEach(s => ordered.push(s));
			return ordered;
		} catch { return songs; }
	}

	function saveOrder(id: number, songs: Song[]) {
		localStorage.setItem(orderKey(id), JSON.stringify(songs.map(s => s.id)));
	}

	onMount(async () => {
		if (!$session) return;
		try {
			[playlists, allSongs] = await Promise.all([listPlaylists($session), listSongs($session)]);
		} catch {
			// Offline fallback: show downloaded playlists from IndexedDB
			isOffline = true;
			const offline = $offlineCollections.filter(c => c.type === 'playlist');
			if (offline.length > 0) {
				playlists = offline.map(c => ({ id: c.id, name: c.name, kind: 'playlist', owner_user_id: null }));
			} else {
				error = 'No connection and no downloaded playlists.';
			}
		}
		finally { loading = false; }
	});

	async function selectPlaylist(pl: Playlist) {
		if (!$session) return;
		selected = pl;
		showAddSongs = false;
		try {
			const raw = await getPlaylistSongs(pl.id, $session);
			selectedSongs = applyOrder(raw, pl.id);
		} catch {
			// Offline: reconstruct song list from IndexedDB
			const coll = $offlineCollections.find(c => c.type === 'playlist' && c.id === pl.id);
			if (coll) {
				const stored = await getAllStoredSongs();
				const map = new Map(stored.map(s => [s.id, s]));
				selectedSongs = coll.songIds
					.map(id => map.get(id))
					.filter(Boolean)
					.map(s => ({ id: s!.id, title: s!.title, artist: s!.artist, album: s!.album, album_art_path: '', song_path: '' }));
			}
		}
	}

	async function create() {
		if (!$session || !newName.trim()) return;
		const pl = await createPlaylist(newName.trim(), $session);
		playlists = [...playlists, pl];
		newName = '';
	}

	async function remove(pl: Playlist) {
		if (!$session) return;
		await deletePlaylist(pl.id, $session);
		playlists = playlists.filter(p => p.id !== pl.id);
		if (selected?.id === pl.id) { selected = null; selectedSongs = []; }
	}

	async function saveRename() {
		if (!$session || !renameTarget || !renameValue.trim()) return;
		await renamePlaylist(renameTarget.id, renameValue.trim(), $session);
		playlists = playlists.map(p => p.id === renameTarget!.id ? { ...p, name: renameValue.trim() } : p);
		if (selected?.id === renameTarget.id) selected = { ...selected, name: renameValue.trim() };
		renameTarget = null;
	}

	async function addSong(songId: number) {
		if (!$session || !selected) return;
		await addSongToPlaylist(selected.id, songId, $session);
		const raw = await getPlaylistSongs(selected.id, $session);
		selectedSongs = applyOrder(raw, selected.id);
	}

	async function removeSong(songId: number) {
		if (!$session || !selected) return;
		await removeSongFromPlaylist(selected.id, songId, $session);
		selectedSongs = selectedSongs.filter(s => s.id !== songId);
		saveOrder(selected.id, selectedSongs);
	}

	function play(song: Song) {
		if ($session) playTrack(song, $session, selectedSongs, 'playlist');
	}

	async function playPlaylist(pl: Playlist) {
		if (!$session) return;
		const songs = selected?.id === pl.id ? selectedSongs : applyOrder(await getPlaylistSongs(pl.id, $session), pl.id);
		if (songs.length > 0) playTrack(songs[0], $session, songs, 'playlist');
	}

	// --- Drag to reorder ---
	function startDrag(e: MouseEvent | TouchEvent, idx: number) {
		dragIdx = idx;
		dropIdx = idx;

		const getY = (ev: MouseEvent | TouchEvent) =>
			'touches' in ev ? ev.touches[0].clientY : ev.clientY;

		function calcDrop(y: number) {
			if (!listEl) return;
			const rows = Array.from(listEl.querySelectorAll<HTMLElement>('[data-row]'));
			let target = rows.length - 1;
			for (let i = 0; i < rows.length; i++) {
				const rect = rows[i].getBoundingClientRect();
				if (y < rect.top + rect.height / 2) { target = i; break; }
			}
			dropIdx = target;
		}

		function onMove(ev: MouseEvent | TouchEvent) {
			ev.preventDefault();
			calcDrop(getY(ev));
		}

		function onEnd() {
			if (dragIdx !== null && dropIdx !== null && dragIdx !== dropIdx) {
				const arr = [...selectedSongs];
				const [moved] = arr.splice(dragIdx, 1);
				arr.splice(dropIdx, 0, moved);
				selectedSongs = arr;
				if (selected) saveOrder(selected.id, arr);
			}
			dragIdx = null;
			dropIdx = null;
			document.removeEventListener('mousemove', onMove as EventListener);
			document.removeEventListener('mouseup', onEnd);
			document.removeEventListener('touchmove', onMove as EventListener);
			document.removeEventListener('touchend', onEnd);
		}

		if ('touches' in e) {
			document.addEventListener('touchmove', onMove as EventListener, { passive: false });
			document.addEventListener('touchend', onEnd, { passive: true });
		} else {
			document.addEventListener('mousemove', onMove as EventListener);
			document.addEventListener('mouseup', onEnd);
		}
	}

	const inPlaylist = $derived(new Set(selectedSongs.map(s => s.id)));
	const downloadedPlaylistIds = $derived(new Set($offlineCollections.filter(c => c.type === 'playlist').map(c => c.id)));

	let downloadingPlaylistId = $state<number | null>(null);

	async function downloadPlaylist(pl: Playlist) {
		if (!$session || downloadingPlaylistId !== null) return;
		downloadingPlaylistId = pl.id;
		try {
			const songs = selected?.id === pl.id
				? selectedSongs
				: applyOrder(await getPlaylistSongs(pl.id, $session), pl.id);
			for (const song of songs) {
				if ($offlineIds.has(song.id)) continue;
				const { data, mimeType } = await downloadSongAudio(song.id, $session);
				await saveSong({ id: song.id, title: song.title, artist: song.artist, album: song.album, blob: data, mimeType });
				offlineIds.update(s => { s.add(song.id); return new Set(s); });
			}
			await saveCollection('playlist', pl.id, pl.name, songs.map(s => s.id));
			offlineCollections.update(cs => {
				const filtered = cs.filter(c => !(c.type === 'playlist' && c.id === pl.id));
				return [...filtered, { key: `playlist:${pl.id}`, type: 'playlist', id: pl.id, name: pl.name, songIds: songs.map(s => s.id) }];
			});
		} catch (e) {
			console.error('Playlist download failed', e);
		} finally {
			downloadingPlaylistId = null;
		}
	}
</script>

<div class="flex flex-col md:flex-row h-full overflow-hidden">

	<!-- Playlist list -->
	<div class="md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-surface-700 overflow-y-auto">
		<div class="p-4 space-y-3">
			<h1 class="text-xl font-bold text-surface-50">Playlists</h1>
			{#if isOffline}
				<div class="text-xs text-warning-400 bg-warning-500/10 rounded-lg px-3 py-2">Offline — showing downloaded playlists</div>
			{/if}

			<form onsubmit={(e) => { e.preventDefault(); create(); }} class="flex gap-2">
				<input
					type="text"
					placeholder="New playlist…"
					bind:value={newName}
					class="flex-1 min-w-0 bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-surface-50 placeholder-surface-500 focus:outline-none focus:border-primary-500"
				/>
				<button type="submit" class="px-3 py-2 bg-primary-500 hover:bg-primary-400 text-white rounded-lg text-sm font-medium transition-colors">+</button>
			</form>

			{#if loading}
				<div class="space-y-2">
					{#each { length: 3 } as _}
						<div class="h-10 bg-surface-700 rounded-lg animate-pulse"></div>
					{/each}
				</div>
			{:else if playlists.length === 0}
				<p class="text-surface-500 text-sm text-center py-4">No playlists yet</p>
			{:else}
				<ul class="space-y-1">
					{#each playlists as pl (pl.id)}
						<li class="flex items-center gap-1 rounded-lg {selected?.id === pl.id ? 'bg-surface-700' : ''}">
							<button
								onclick={() => selectPlaylist(pl)}
								class="flex-1 text-left px-3 py-2 text-sm text-surface-200 truncate min-w-0 flex items-center gap-1"
							>
								<span class="truncate">{pl.name}</span>
								{#if downloadedPlaylistIds.has(pl.id)}
									<svg class="w-3 h-3 text-primary-400 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/></svg>
								{/if}
							</button>
							<button onclick={() => playPlaylist(pl)} class="px-2 py-2 text-primary-400 hover:text-primary-300 text-xs" aria-label="Play {pl.name}">▶</button>
							<button
								onclick={() => downloadPlaylist(pl)}
								disabled={downloadingPlaylistId !== null}
								class="px-2 py-2 text-xs transition-colors {downloadingPlaylistId === pl.id ? 'text-primary-400 animate-pulse' : 'text-surface-500 hover:text-surface-300'}"
								aria-label="Download {pl.name}"
							>
								<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zm-8 2V5h2v6h1.17L12 13.17 9.83 11H11zm-6 7h14v2H5v-2z"/></svg>
							</button>
							<button onclick={() => { renameTarget = pl; renameValue = pl.name; }} class="px-2 py-2 text-surface-500 hover:text-surface-300 text-xs">✎</button>
							<button onclick={() => remove(pl)} class="px-2 py-2 text-surface-500 hover:text-error-400 text-xs">✕</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>

	<!-- Playlist detail -->
	<div class="flex-1 overflow-y-auto p-4 space-y-3">
		{#if selected}
			<div class="flex items-center justify-between">
				<h2 class="text-lg font-semibold text-surface-50">{selected.name}</h2>
				<button
					onclick={() => showAddSongs = !showAddSongs}
					class="text-sm px-3 py-1.5 rounded-lg border border-surface-600 text-surface-300 hover:bg-surface-700 transition-colors"
				>{showAddSongs ? 'Done' : '+ Add songs'}</button>
			</div>

			{#if showAddSongs}
				<div class="bg-surface-800 rounded-xl p-3 space-y-1 max-h-56 overflow-y-auto">
					{#each allSongs as song (song.id)}
						<div class="flex items-center gap-3 py-1.5">
							<span class="flex-1 text-sm text-surface-200 truncate">{song.title} <span class="text-surface-500">· {song.artist}</span></span>
							{#if inPlaylist.has(song.id)}
								<button onclick={() => removeSong(song.id)} class="text-xs px-2 py-1 rounded bg-surface-600 text-surface-400 hover:bg-error-500/20 hover:text-error-400 transition-colors">Remove</button>
							{:else}
								<button onclick={() => addSong(song.id)} class="text-xs px-2 py-1 rounded bg-primary-500/20 text-primary-400 hover:bg-primary-500/40 transition-colors">Add</button>
							{/if}
						</div>
					{/each}
				</div>
			{/if}

			{#if selectedSongs.length === 0}
				<p class="text-surface-500 text-sm text-center py-8">No songs in this playlist</p>
			{:else}
				<ul class="space-y-2" bind:this={listEl}>
					{#each selectedSongs as song, i (song.id)}
						<li
							data-row
							class="flex items-center gap-2 p-3 rounded-xl bg-surface-800 group transition-colors
								{dragIdx === i ? 'opacity-40' : ''}
								{dropIdx === i && dragIdx !== null && dragIdx !== i ? 'ring-2 ring-primary-500' : ''}"
						>
							<!-- Drag handle -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="cursor-grab active:cursor-grabbing touch-none shrink-0 text-surface-600 hover:text-surface-300 px-1 py-2 select-none"
								onmousedown={(e) => { e.preventDefault(); startDrag(e, i); }}
								ontouchstart={(e) => startDrag(e, i)}
								aria-label="Drag to reorder"
							>
								<svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
									<path d="M8 6a2 2 0 110-4 2 2 0 010 4zM8 14a2 2 0 110-4 2 2 0 010 4zM8 22a2 2 0 110-4 2 2 0 010 4zM16 6a2 2 0 110-4 2 2 0 010 4zM16 14a2 2 0 110-4 2 2 0 010 4zM16 22a2 2 0 110-4 2 2 0 010 4z"/>
								</svg>
							</div>

							<button onclick={() => play(song)} class="flex-1 min-w-0 text-left">
								<div class="text-sm font-medium text-surface-50 truncate">{song.title}</div>
								<div class="text-xs text-surface-400 truncate">{song.artist}</div>
							</button>
							<button onclick={() => removeSong(song.id)} class="opacity-0 group-hover:opacity-100 text-surface-500 hover:text-error-400 transition-all text-xs px-2">✕</button>
						</li>
					{/each}
				</ul>
			{/if}
		{:else}
			<div class="flex items-center justify-center h-full text-surface-600">
				<p>Select a playlist</p>
			</div>
		{/if}
	</div>
</div>

<!-- Rename modal -->
{#if renameTarget}
	<div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
		<div class="bg-surface-800 rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-xl">
			<h3 class="text-lg font-semibold text-surface-50">Rename playlist</h3>
			<input
				type="text"
				bind:value={renameValue}
				class="w-full bg-surface-700 border border-surface-600 rounded-lg px-4 py-3 text-surface-50 focus:outline-none focus:border-primary-500"
			/>
			<div class="flex gap-3">
				<button onclick={() => renameTarget = null} class="flex-1 py-2.5 rounded-lg border border-surface-600 text-surface-300 text-sm hover:bg-surface-700 transition-colors">Cancel</button>
				<button onclick={saveRename} class="flex-1 py-2.5 rounded-lg bg-primary-500 hover:bg-primary-400 text-white text-sm font-medium transition-colors">Save</button>
			</div>
		</div>
	</div>
{/if}

{#if error}<p class="p-4 text-error-400 text-sm">{error}</p>{/if}
