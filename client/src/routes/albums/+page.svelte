<script lang="ts">
	import { onMount } from 'svelte';
	import { session } from '$lib/session';
	import { playTrack } from '$lib/player';
	import { listAlbums, getPlaylistSongs, getSongArt, listSongs, downloadSongAudio, type Playlist, type Song } from '$lib/api';
	import { offlineIds, offlineCollections, saveSong, saveCollection, getAllStoredSongs } from '$lib/offline';

	let albums = $state<Playlist[]>([]);
	let albumArts = $state<Record<number, string>>({});
	let selected = $state<Playlist | null>(null);
	let selectedSongs = $state<Song[]>([]);
	let loadingSongs = $state(false);
	let loading = $state(true);
	let error = $state('');
	let isOffline = $state(false);

	// Drag state
	let listEl = $state<HTMLElement | null>(null);
	let dragIdx = $state<number | null>(null);
	let dropIdx = $state<number | null>(null);

	function orderKey(id: number) { return `limp-order-album-${id}`; }

	function applyOrder(songs: Song[], id: number): Song[] {
		try {
			const raw = localStorage.getItem(orderKey(id));
			if (!raw) return songs;
			const ids: number[] = JSON.parse(raw);
			const map = new Map(songs.map(s => [s.id, s]));
			const ordered = ids.map(id => map.get(id)).filter(Boolean) as Song[];
			const seen = new Set(ids);
			songs.filter(s => !seen.has(s.id)).forEach(s => ordered.push(s));
			return ordered;
		} catch { return songs; }
	}

	function saveOrder(id: number, songs: Song[]) {
		localStorage.setItem(orderKey(id), JSON.stringify(songs.map(s => s.id)));
	}

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

	const downloadedAlbumIds = $derived(new Set($offlineCollections.filter(c => c.type === 'album').map(c => c.id)));

	onMount(async () => {
		if (!$session) return;
		try {
			const [albumList, allSongs] = await Promise.all([listAlbums($session), listSongs($session)]);
			albums = albumList;
			const sess = $session;
			for (const album of albums) {
				const song = allSongs.find(s => s.album === album.name);
				if (song) {
					getSongArt(song.id, sess, true).then(url => {
						if (url) albumArts = { ...albumArts, [album.id]: url };
					});
				}
			}
		} catch {
			isOffline = true;
			const offline = $offlineCollections.filter(c => c.type === 'album');
			if (offline.length > 0) {
				albums = offline.map(c => ({ id: c.id, name: c.name, kind: 'album', owner_user_id: null }));
			} else {
				error = 'No connection and no downloaded albums.';
			}
		}
		finally { loading = false; }
	});

	async function selectAlbum(album: Playlist) {
		if (!$session) return;
		selected = album;
		loadingSongs = true;
		try {
			const raw = await getPlaylistSongs(album.id, $session);
			selectedSongs = applyOrder(raw, album.id);
		} catch {
			const coll = $offlineCollections.find(c => c.type === 'album' && c.id === album.id);
			if (coll) {
				const stored = await getAllStoredSongs();
				const map = new Map(stored.map(s => [s.id, s]));
				selectedSongs = coll.songIds
					.map(id => map.get(id))
					.filter(Boolean)
					.map(s => ({ id: s!.id, title: s!.title, artist: s!.artist, album: s!.album, album_art_path: '', song_path: '' }));
			}
		}
		loadingSongs = false;
	}

	function playAlbum() {
		if (!$session || selectedSongs.length === 0 || !selected) return;
		playTrack(selectedSongs[0], $session, selectedSongs, 'album');
	}

	function playSong(song: Song) {
		if ($session) playTrack(song, $session, selectedSongs, 'album');
	}

	let downloadingAlbum = $state(false);

	async function downloadAlbum() {
		if (!$session || !selected || downloadingAlbum) return;
		downloadingAlbum = true;
		const album = selected;
		try {
			for (const song of selectedSongs) {
				if ($offlineIds.has(song.id)) continue;
				const { data, mimeType } = await downloadSongAudio(song.id, $session);
				await saveSong({ id: song.id, title: song.title, artist: song.artist, album: song.album, blob: data, mimeType });
				offlineIds.update(s => { s.add(song.id); return new Set(s); });
			}
			await saveCollection('album', album.id, album.name, selectedSongs.map(s => s.id));
			offlineCollections.update(cs => {
				const filtered = cs.filter(c => !(c.type === 'album' && c.id === album.id));
				return [...filtered, { key: `album:${album.id}`, type: 'album', id: album.id, name: album.name, songIds: selectedSongs.map(s => s.id) }];
			});
		} catch (e) {
			console.error('Album download failed', e);
		} finally {
			downloadingAlbum = false;
		}
	}
</script>

{#if loading}
	<div class="p-4 grid grid-cols-3 gap-3">
		{#each { length: 6 } as _}
			<div>
				<div class="aspect-square bg-surface-700 rounded-xl animate-pulse"></div>
				<div class="h-3 bg-surface-700 rounded mt-2 animate-pulse"></div>
			</div>
		{/each}
	</div>
{:else if error}
	<p class="p-6 text-error-400 text-sm">{error}</p>
{:else if !selected}
	<div class="p-4 overflow-y-auto h-full">
		<div class="flex items-center justify-between mb-4">
			<h1 class="text-xl font-bold text-surface-50">Albums</h1>
			{#if isOffline}
				<span class="text-xs text-warning-400 bg-warning-500/10 rounded-lg px-3 py-1">Offline</span>
			{/if}
		</div>
		{#if albums.length === 0}
			<p class="text-surface-500 text-sm text-center py-12">No albums yet</p>
		{:else}
			<div class="grid grid-cols-3 gap-3">
				{#each albums as album (album.id)}
					<button onclick={() => selectAlbum(album)} class="block text-left cursor-pointer group">
						<div class="relative aspect-square rounded-xl overflow-hidden bg-surface-700">
							{#if albumArts[album.id]}
								<img src={albumArts[album.id]} alt={album.name} class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
							{:else}
								<div class="w-full h-full flex items-center justify-center text-surface-500 text-4xl">◉</div>
							{/if}
							<!-- Decorative play indicator (pointer-events-none so tile click still fires) -->
							<div class="absolute inset-0 flex items-center justify-center pointer-events-none">
								<div class="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center">
									<svg class="w-6 h-6 text-white ml-0.5" viewBox="0 0 24 24" fill="currentColor">
										<path d="M8 5v14l11-7z"/>
									</svg>
								</div>
							</div>
							{#if downloadedAlbumIds.has(album.id)}
								<div class="absolute top-1.5 right-1.5 pointer-events-none w-5 h-5 rounded-full bg-primary-500 flex items-center justify-center">
									<svg class="w-3 h-3 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zm-6 7h14v2H5v-2z"/></svg>
								</div>
							{/if}
						</div>
						<p class="text-xs font-medium text-surface-200 truncate mt-1.5">{album.name}</p>
					</button>
				{/each}
			</div>
		{/if}
	</div>
{:else}
	<div class="flex flex-col h-full overflow-hidden">
		<div class="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-surface-700 shrink-0">
			<button onclick={() => { selected = null; selectedSongs = []; }} class="text-surface-400 hover:text-surface-100 p-1" aria-label="Back">
				<svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M19 12H5m7-7-7 7 7 7"/>
				</svg>
			</button>
			<h2 class="flex-1 text-lg font-semibold text-surface-50 truncate">{selected.name}</h2>
			<button
				onclick={downloadAlbum}
				disabled={loadingSongs || selectedSongs.length === 0 || downloadingAlbum}
				class="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-surface-600 text-surface-300 hover:bg-surface-700 disabled:opacity-50 text-sm transition-colors {downloadingAlbum ? 'animate-pulse' : ''}"
				aria-label="Download album"
			>
				<svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zm-8 2V5h2v6h1.17L12 13.17 9.83 11H11zm-6 7h14v2H5v-2z"/></svg>
				Download
			</button>
			<button
				onclick={playAlbum}
				disabled={loadingSongs || selectedSongs.length === 0}
				class="flex items-center gap-1.5 px-3 py-1.5 bg-primary-500 hover:bg-primary-400 disabled:opacity-50 text-white text-sm rounded-full transition-colors"
				aria-label="Play album"
			>
				<svg class="w-4 h-4 ml-0.5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
				Play songs
			</button>
		</div>
		<div class="flex-1 overflow-y-auto p-4 space-y-2">
			{#if loadingSongs}
				{#each { length: 4 } as _}
					<div class="h-14 bg-surface-800 rounded-xl animate-pulse"></div>
				{/each}
			{:else if selectedSongs.length === 0}
				<p class="text-surface-500 text-sm text-center py-8">No songs</p>
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

							<button onclick={() => playSong(song)} class="flex-1 min-w-0 text-left group/song">
								<div class="text-sm font-medium text-surface-50 truncate">{song.title}</div>
								<div class="text-xs text-surface-400 truncate">{song.artist}</div>
							</button>
							<div class="text-surface-600 group-hover:text-primary-400 transition-colors shrink-0 text-sm">▶</div>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>
{/if}
