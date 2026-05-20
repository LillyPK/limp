<script lang="ts">
	import { onMount } from 'svelte';
	import { session } from '$lib/session';
	import { playTrack } from '$lib/player';
	import { listSongs, type Song } from '$lib/api';
	import { offlineIds, getAllStoredSongs, type StoredSong } from '$lib/offline';

	let songs = $state<Song[]>([]);
	let downloadedSongs = $state<StoredSong[]>([]);
	let error = $state('');
	let loading = $state(true);
	let isOffline = $state(false);

	onMount(async () => {
		if (!$session) return;
		// Always load downloaded songs from IndexedDB
		downloadedSongs = await getAllStoredSongs().catch(() => []);
		try {
			songs = await listSongs($session);
		} catch {
			isOffline = true;
		} finally {
			loading = false;
		}
	});

	function toSong(s: StoredSong): Song {
		return { id: s.id, title: s.title, artist: s.artist, album: s.album, album_art_path: '', song_path: '' };
	}
</script>

<div class="p-4 md:p-6 space-y-6">
	{#if isOffline}
		<div class="text-xs text-warning-400 bg-warning-500/10 rounded-lg px-3 py-2">Offline — only downloaded songs will play</div>
	{/if}

	<!-- Main library (online / SW cache) -->
	{#if !isOffline}
		<div>
			<h1 class="text-2xl font-bold text-surface-50 mb-4">Library</h1>

			{#if loading}
				<div class="space-y-3">
					{#each { length: 5 } as _}
						<div class="h-16 bg-surface-800 rounded-xl animate-pulse"></div>
					{/each}
				</div>
			{:else if error}
				<p class="text-error-400 text-sm">{error}</p>
			{:else if songs.length === 0}
				<div class="text-center py-16 text-surface-500">
					<div class="text-5xl mb-3">♫</div>
					<p>No songs yet.</p>
				</div>
			{:else}
				<ul class="space-y-2">
					{#each songs as song (song.id)}
						<li>
							<button
								onclick={() => $session && playTrack(song, $session, songs, 'library')}
								class="w-full flex items-center gap-4 p-3 rounded-xl bg-surface-800 hover:bg-surface-700 transition-colors text-left group"
							>
								<div class="w-10 h-10 rounded-lg bg-surface-600 flex items-center justify-center text-surface-400 group-hover:bg-primary-500/20 group-hover:text-primary-400 transition-colors shrink-0">
									{#if $offlineIds.has(song.id)}
										<svg class="w-4 h-4 text-primary-400" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zm-6 7h14v2H5v-2z"/></svg>
									{:else}
										♫
									{/if}
								</div>
								<div class="flex-1 min-w-0">
									<div class="text-sm font-medium text-surface-50 truncate">{song.title}</div>
									<div class="text-xs text-surface-400 truncate">{song.artist}{song.album ? ` · ${song.album}` : ''}</div>
								</div>
								<div class="text-surface-600 group-hover:text-primary-400 transition-colors text-lg shrink-0">▶</div>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}

	<!-- Downloads section (always visible when songs are downloaded) -->
	{#if downloadedSongs.length > 0}
		<div>
			<h2 class="text-lg font-semibold text-surface-200 mb-3 flex items-center gap-2">
				<svg class="w-4 h-4 text-primary-400" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zm-6 7h14v2H5v-2z"/></svg>
				Downloads
				<span class="text-xs font-normal text-surface-500">{downloadedSongs.length} {downloadedSongs.length === 1 ? 'song' : 'songs'}</span>
			</h2>
			<ul class="space-y-2">
				{#each downloadedSongs as s (s.id)}
					{@const song = toSong(s)}
					<li>
						<button
							onclick={() => $session && playTrack(song, $session, downloadedSongs.map(toSong), 'library')}
							class="w-full flex items-center gap-4 p-3 rounded-xl bg-surface-800 hover:bg-surface-700 transition-colors text-left group"
						>
							<div class="w-10 h-10 rounded-lg bg-primary-500/10 flex items-center justify-center text-primary-400 shrink-0">
								<svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zm-6 7h14v2H5v-2z"/></svg>
							</div>
							<div class="flex-1 min-w-0">
								<div class="text-sm font-medium text-surface-50 truncate">{s.title}</div>
								<div class="text-xs text-surface-400 truncate">{s.artist}{s.album ? ` · ${s.album}` : ''}</div>
							</div>
							<div class="text-surface-600 group-hover:text-primary-400 transition-colors text-lg shrink-0">▶</div>
						</button>
					</li>
				{/each}
			</ul>
		</div>
	{:else if isOffline}
		<div class="text-center py-16 text-surface-500">
			<div class="text-5xl mb-3">📥</div>
			<p>No downloaded songs yet.</p>
			<p class="text-xs mt-1">Connect to download songs for offline playback.</p>
		</div>
	{/if}
</div>
