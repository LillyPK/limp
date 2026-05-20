<script lang="ts">
	import { session } from '$lib/session';
	import { playTrack } from '$lib/player';
	import { searchSongs, type Song } from '$lib/api';

	let query = $state('');
	let results = $state<Song[]>([]);
	let error = $state('');
	let searching = $state(false);
	let debounce: ReturnType<typeof setTimeout>;

	async function search() {
		if (!$session || !query.trim()) { results = []; return; }
		searching = true;
		try {
			results = await searchSongs(query, $session);
		} catch (e) {
			error = String(e);
		} finally {
			searching = false;
		}
	}

	function onInput() {
		clearTimeout(debounce);
		debounce = setTimeout(search, 300);
	}
</script>

<div class="p-4 md:p-6 space-y-4">
	<h1 class="text-2xl font-bold text-surface-50">Search</h1>

	<div class="relative">
		<span class="absolute left-4 top-1/2 -translate-y-1/2 text-surface-400">⌕</span>
		<input
			type="search"
			placeholder="Songs, albums, artists…"
			bind:value={query}
			oninput={onInput}
			class="w-full bg-surface-800 border border-surface-700 rounded-xl pl-10 pr-4 py-3 text-surface-50 placeholder-surface-500 focus:outline-none focus:border-primary-500 transition-colors"
		/>
	</div>

	{#if searching}
		<div class="space-y-2">
			{#each { length: 3 } as _}
				<div class="h-14 bg-surface-800 rounded-xl animate-pulse"></div>
			{/each}
		</div>
	{:else if error}
		<p class="text-error-400 text-sm">{error}</p>
	{:else if results.length}
		<ul class="space-y-2">
			{#each results as song (song.id)}
				<li>
					<button
						onclick={() => $session && playTrack(song, $session, results, 'search')}
						class="w-full flex items-center gap-4 p-3 rounded-xl bg-surface-800 hover:bg-surface-700 transition-colors text-left group"
					>
						<div class="w-10 h-10 rounded-lg bg-surface-600 flex items-center justify-center text-surface-400 group-hover:bg-primary-500/20 group-hover:text-primary-400 transition-colors shrink-0">♫</div>
						<div class="flex-1 min-w-0">
							<div class="text-sm font-medium text-surface-50 truncate">{song.title}</div>
							<div class="text-xs text-surface-400 truncate">{song.artist}{song.album ? ` · ${song.album}` : ''}</div>
						</div>
						<div class="text-surface-600 group-hover:text-primary-400 transition-colors text-lg shrink-0">▶</div>
					</button>
				</li>
			{/each}
		</ul>
	{:else if query.trim()}
		<div class="text-center py-12 text-surface-500">No results for "{query}"</div>
	{/if}
</div>
