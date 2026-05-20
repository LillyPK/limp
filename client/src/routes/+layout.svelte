<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { session } from '$lib/session';
	import { player, playerError, playerExpanded, playAtIndex, repeatMode, type RepeatMode } from '$lib/player';
	import { settings } from '$lib/settings';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { get } from 'svelte/store';
	import { onMount } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { getRelatedSongs, downloadSongAudio } from '$lib/api';
	import { offlineIds, offlineCollections, initOfflineStore, saveSong, clearAllSongs } from '$lib/offline';

	let { children } = $props();

	let audioEl = $state<HTMLAudioElement | null>(null);
	let playing = $state(false);
	let currentTime = $state(0);
	let duration = $state(0);
	let settingsOpen = $state(false);

	// Drag-to-dismiss expanded player
	let dragHandleEl = $state<HTMLElement | null>(null);
	let dragOffset = $state(0);
	let isDragging = $state(false);
	let dragStartY = 0;

	// Swipe nav slide direction: 1 = forward (new page from right), -1 = backward (new page from left), 0 = no anim
	let navDir = $state(0);

	// PWA install prompt
	let installPrompt = $state<any>(null);
	let isStandalone = $state(false);

	// Offline download state
	let downloadingCurrent = $state(false);

	const publicPaths = ['/login'];
	const swipeTabs = ['/', '/search', '/playlists', '/albums'];

	// --- Slide transition functions ---
	function slideIn(node: Element) {
		if (navDir === 0) return { duration: 0 };
		const x = navDir * 100;
		return { duration: 280, easing: cubicOut, css: (t: number) => `transform: translateX(${x * (1 - t)}%)` };
	}
	function slideOut(node: Element) {
		if (navDir === 0) return { duration: 0 };
		const x = -navDir * 100;
		return { duration: 280, easing: cubicOut, css: (t: number) => `transform: translateX(${x * t}%)` };
	}

	// Navigate with slide direction set based on tab order
	function gotoTab(href: string) {
		const fromIdx = swipeTabs.indexOf(get(page).url.pathname);
		const toIdx = swipeTabs.indexOf(href);
		navDir = (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) ? (toIdx > fromIdx ? 1 : -1) : 0;
		goto(href).then(() => setTimeout(() => { navDir = 0; }, 350));
	}

	$effect(() => {
		if (typeof window !== 'undefined' && !$session && !publicPaths.includes($page.url.pathname)) {
			goto('/login');
		}
	});

	$effect(() => {
		const url = $player?.audioUrl;
		if (url && audioEl && audioEl.src !== url) {
			audioEl.src = url;
			audioEl.play().catch(() => {});
		}
	});

	$effect(() => {
		if (!$player || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
		navigator.mediaSession.metadata = new MediaMetadata({
			title: $player.song.title,
			artist: $player.song.artist,
			album: $player.song.album,
			artwork: $player.artUrl ? [{ src: $player.artUrl, sizes: '200x200' }] : []
		});
	});

	// Drag handle — non-passive touchmove to preventDefault
	$effect(() => {
		const el = dragHandleEl;
		if (!el) return;

		function onStart(e: TouchEvent) { isDragging = true; dragStartY = e.touches[0].clientY; dragOffset = 0; }
		function onMove(e: TouchEvent) {
			if (!isDragging) return;
			dragOffset = Math.max(0, e.touches[0].clientY - dragStartY);
			e.preventDefault();
		}
		function onEnd() {
			if (!isDragging) return;
			isDragging = false;
			if (dragOffset > 150) playerExpanded.set(false);
			dragOffset = 0;
		}
		function onMouseDown(e: MouseEvent) {
			isDragging = true; dragStartY = e.clientY; dragOffset = 0;
			const mm = (e: MouseEvent) => { dragOffset = Math.max(0, e.clientY - dragStartY); };
			const mu = () => {
				isDragging = false;
				if (dragOffset > 150) playerExpanded.set(false);
				dragOffset = 0;
				document.removeEventListener('mousemove', mm);
				document.removeEventListener('mouseup', mu);
			};
			document.addEventListener('mousemove', mm);
			document.addEventListener('mouseup', mu);
		}
		el.addEventListener('touchstart', onStart, { passive: true });
		el.addEventListener('touchmove', onMove, { passive: false });
		el.addEventListener('touchend', onEnd, { passive: true });
		el.addEventListener('mousedown', onMouseDown);
		return () => {
			el.removeEventListener('touchstart', onStart);
			el.removeEventListener('touchmove', onMove);
			el.removeEventListener('touchend', onEnd);
			el.removeEventListener('mousedown', onMouseDown);
		};
	});

	async function downloadCurrent() {
		const song = get(player)?.song;
		const sess = get(session);
		if (!song || !sess || downloadingCurrent || get(offlineIds).has(song.id)) return;
		downloadingCurrent = true;
		try {
			const { data, mimeType } = await downloadSongAudio(song.id, sess);
			await saveSong({ id: song.id, title: song.title, artist: song.artist, album: song.album, blob: data, mimeType });
			offlineIds.update(s => { s.add(song.id); return new Set(s); });
		} catch (e) {
			console.error('Download failed', e);
		} finally {
			downloadingCurrent = false;
		}
	}

	async function clearDownloads() {
		await clearAllSongs();
		offlineIds.set(new Set());
	}

	async function installApp() {
		if (installPrompt) {
			installPrompt.prompt();
			const { outcome } = await installPrompt.userChoice;
			if (outcome === 'accepted') installPrompt = null;
		} else {
			alert('To install: open your browser menu and choose "Add to Home Screen" or "Install app".');
		}
	}

	// Swipe left/right to navigate tabs
	onMount(() => {
		if ('serviceWorker' in navigator) {
			navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
		}

		initOfflineStore().catch(() => {});

		isStandalone = window.matchMedia('(display-mode: standalone)').matches
			|| ('standalone' in navigator && (navigator as any).standalone === true);

		window.addEventListener('beforeinstallprompt', (e) => {
			e.preventDefault();
			installPrompt = e;
		});
		window.addEventListener('appinstalled', () => { installPrompt = null; isStandalone = true; });

		let startX = 0, startY = 0, axis: 'x' | 'y' | null = null;

		function onStart(e: TouchEvent) { startX = e.touches[0].clientX; startY = e.touches[0].clientY; axis = null; }
		function onMove(e: TouchEvent) {
			if (isDragging || get(playerExpanded)) return;
			const dx = Math.abs(e.touches[0].clientX - startX);
			const dy = Math.abs(e.touches[0].clientY - startY);
			if (!axis && (dx > 8 || dy > 8)) axis = dx > dy ? 'x' : 'y';
			if (axis === 'x') e.preventDefault();
		}
		function onEnd(e: TouchEvent) {
			if (isDragging || get(playerExpanded)) { axis = null; return; }
			const dx = e.changedTouches[0].clientX - startX;
			if (axis === 'x' && Math.abs(dx) > 60) {
				const dir = dx < 0 ? 1 : -1;
				const idx = settingsOpen ? swipeTabs.length : swipeTabs.indexOf(get(page).url.pathname);
				if (idx === -1) { axis = null; return; }
				const next = idx + dir;
				if (next < 0) { axis = null; return; }
				if (next === swipeTabs.length) {
					settingsOpen = true;
				} else if (next < swipeTabs.length) {
					settingsOpen = false;
					navDir = dir;
					goto(swipeTabs[next]).then(() => setTimeout(() => { navDir = 0; }, 350));
				}
			}
			axis = null;
		}
		document.addEventListener('touchstart', onStart, { passive: true });
		document.addEventListener('touchmove', onMove, { passive: false });
		document.addEventListener('touchend', onEnd, { passive: true });
		return () => {
			document.removeEventListener('touchstart', onStart);
			document.removeEventListener('touchmove', onMove);
			document.removeEventListener('touchend', onEnd);
		};
	});

	function setupMediaSession() {
		if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
		navigator.mediaSession.setActionHandler('play', () => audioEl?.play());
		navigator.mediaSession.setActionHandler('pause', () => audioEl?.pause());
		navigator.mediaSession.setActionHandler('nexttrack', () => skipNext());
		navigator.mediaSession.setActionHandler('previoustrack', () => skipPrev());
	}

	function skipNext() {
		const state = get(player);
		const sess = get(session);
		if (!state || !sess || state.queueIndex >= state.queue.length - 1) return;
		playAtIndex(state.queueIndex + 1, sess);
	}

	function skipPrev() {
		const state = get(player);
		const sess = get(session);
		if (!state || !sess) return;
		if (currentTime > 3) { audioEl ? audioEl.currentTime = 0 : null; return; }
		if (state.queueIndex > 0) playAtIndex(state.queueIndex - 1, sess);
	}

	function onEnded() {
		playing = false;
		const mode = get(repeatMode);
		if (mode === 'song') {
			if (audioEl) { audioEl.currentTime = 0; audioEl.play().catch(() => {}); }
			return;
		}
		const state = get(player);
		const sess = get(session);
		if (!state || !sess) return;
		const hasNext = state.queueIndex < state.queue.length - 1;
		if (mode === 'context') {
			// Loop: wrap around
			playAtIndex(hasNext ? state.queueIndex + 1 : 0, sess);
		} else if (hasNext) {
			// Always advance within the current context
			playAtIndex(state.queueIndex + 1, sess);
		} else if (get(settings).playRelated && state.contextType !== 'related') {
			// End of queue — continue with related songs if toggle is on
			startRelated();
		}
		// else: stop
	}

	function cycleRepeat() {
		const modes: RepeatMode[] = [null, 'context', 'song'];
		const cur = get(repeatMode);
		repeatMode.set(modes[(modes.indexOf(cur) + 1) % modes.length]);
	}

	async function startRelated() {
		const sess = get(session);
		const state = get(player);
		if (!sess || !state) return;
		const related = await getRelatedSongs(state.song.id, sess);
		if (related.length === 0) return;
		const { playTrack } = await import('$lib/player');
		playTrack(related[0], sess, related, 'related');
		settingsOpen = false;
	}

	function togglePlay() { if (!audioEl) return; playing ? audioEl.pause() : audioEl.play(); }

	function seek(e: MouseEvent) {
		if (!audioEl || !duration) return;
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		audioEl.currentTime = ((e.clientX - rect.left) / rect.width) * duration;
	}

	function fmt(s: number): string {
		if (!s || isNaN(s)) return '0:00';
		return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
	}

	const navItems = [
		{ href: '/',          label: 'Library',   icon: '♫' },
		{ href: '/search',    label: 'Search',    icon: '⌕' },
		{ href: '/playlists', label: 'Playlists', icon: '☰' },
		{ href: '/albums',    label: 'Albums',    icon: '◉' },
	];

	const hasNext = $derived($player ? $player.queueIndex < $player.queue.length - 1 : false);
	const hasPrev = $derived($player ? $player.queueIndex > 0 : false);
	const expandedTransform = $derived($playerExpanded ? `translateY(${dragOffset}px)` : 'translateY(100%)');
	const expandedTransition = $derived(isDragging ? 'none' : 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)');
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>limp</title>
</svelte:head>

<!-- svelte-ignore a11y_media_has_caption -->
<audio
	bind:this={audioEl}
	bind:currentTime
	bind:duration
	onplay={() => { playing = true; setupMediaSession(); }}
	onpause={() => playing = false}
	onended={onEnded}
	class="hidden"
></audio>

{#if !$session}
	{@render children()}
{:else}
	<div class="flex h-screen w-screen overflow-hidden bg-surface-900 text-surface-50">

		<!-- Sidebar (md+) -->
		<aside class="hidden md:flex flex-col w-56 shrink-0 bg-surface-800 border-r border-surface-700">
			<div class="p-5 pb-3">
				<span class="text-xl font-bold tracking-tight text-primary-400">limp</span>
			</div>
			<nav class="flex-1 px-2 py-2 space-y-1">
				{#each navItems as item}
					<a href={item.href}
						onclick={(e) => { e.preventDefault(); gotoTab(item.href); }}
						class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors
							{$page.url.pathname === item.href ? 'bg-primary-500/20 text-primary-300' : 'text-surface-300 hover:bg-surface-700 hover:text-surface-50'}"
					><span class="text-base">{item.icon}</span>{item.label}</a>
				{/each}
				{#if $session.user.is_admin}
					<a href="/admin"
						class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors
							{$page.url.pathname === '/admin' ? 'bg-primary-500/20 text-primary-300' : 'text-surface-300 hover:bg-surface-700 hover:text-surface-50'}"
					><span class="text-base">⚙</span>Admin</a>
				{/if}
			</nav>
			<div class="p-3 border-t border-surface-700">
				<div class="px-3 py-1.5 text-xs text-surface-500 truncate">{$session.user.username}</div>
				<button onclick={() => settingsOpen = true}
					class="w-full mt-1 flex items-center gap-2 px-3 py-2 text-sm rounded-lg text-surface-300 hover:bg-surface-700 hover:text-surface-50 transition-colors"
				><span>⚙</span>Settings</button>
			</div>
		</aside>

		<!-- Main content column -->
		<div class="flex-1 flex flex-col min-w-0 overflow-hidden">
			<div class="flex-1 flex flex-col overflow-hidden relative">

				<!-- Page content with slide transitions -->
				<main class="flex-1 relative overflow-hidden">
					{#key $page.url.pathname}
						<div
							class="absolute inset-0 overflow-y-auto"
							in:slideIn
							out:slideOut
						>
							{@render children()}
						</div>
					{/key}
				</main>

				<!-- Compact now-playing bar -->
				{#if $player}
					<div class="shrink-0 bg-surface-800 border-t border-surface-700 flex items-center gap-3 pr-3">
						<button
							onclick={() => playerExpanded.set(true)}
							class="flex-1 flex items-center gap-3 p-3 min-w-0 text-left"
							aria-label="Expand player"
						>
							{#if $player.artUrl}
								<img src={$player.artUrl} alt="art" class="h-12 w-12 rounded object-cover shrink-0" />
							{:else}
								<div class="h-12 w-12 rounded bg-surface-600 shrink-0 flex items-center justify-center text-surface-400 text-lg">♫</div>
							{/if}
							<div class="min-w-0">
								<div class="text-sm font-semibold truncate">{$player.song.title}</div>
								<div class="text-xs text-surface-400 truncate">{$player.song.artist}</div>
							</div>
						</button>
						{#if $player.loading}
							<div class="text-surface-400 text-sm animate-pulse px-2">Loading…</div>
						{:else}
							<button onclick={skipPrev} disabled={!hasPrev} class="p-2 text-surface-400 hover:text-surface-100 disabled:opacity-30 transition-colors">⏮</button>
							<button onclick={togglePlay} class="w-10 h-10 rounded-full bg-primary-500 hover:bg-primary-400 flex items-center justify-center text-white transition-colors shrink-0">
								{playing ? '⏸' : '▶'}
							</button>
							<button onclick={skipNext} disabled={!hasNext} class="p-2 text-surface-400 hover:text-surface-100 disabled:opacity-30 transition-colors">⏭</button>
						{/if}
					</div>
				{/if}

				<!-- Expanded player (always rendered when player exists, shown via transform) -->
				{#if $player}
					<div
						class="absolute inset-0 z-30 bg-surface-900 flex flex-col overflow-hidden"
						style:transform={expandedTransform}
						style:transition={expandedTransition}
						aria-hidden={!$playerExpanded}
					>
						<!-- Drag handle + context label -->
						<div
							bind:this={dragHandleEl}
							class="flex flex-col items-center pt-3 pb-1 shrink-0 cursor-grab select-none touch-none"
						>
							<div class="w-12 h-1.5 rounded-full bg-surface-600"></div>
							{#if $player.contextType}
								<span class="text-xs text-surface-500 uppercase tracking-widest mt-2">{$player.contextType}</span>
							{/if}
						</div>

						<!-- Album art -->
						<div class="flex-1 flex items-center justify-center px-8 py-2 min-h-0">
							{#if $player.artUrl}
								<img src={$player.artUrl} alt="album art" class="w-full max-w-sm aspect-square object-cover rounded-2xl shadow-2xl" />
							{:else}
								<div class="w-full max-w-sm aspect-square rounded-2xl bg-surface-700 flex items-center justify-center">
									<span class="text-8xl text-surface-500">♫</span>
								</div>
							{/if}
						</div>

						<!-- Song info -->
						<div class="px-8 pb-3 shrink-0">
							<div class="text-xl font-bold text-surface-50 truncate">{$player.song.title}</div>
							<div class="text-surface-400 truncate mt-0.5">
								{$player.song.artist}{$player.song.album ? ` · ${$player.song.album}` : ''}
							</div>
						</div>

						<!-- Progress bar -->
						<div class="px-8 pb-3 shrink-0">
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div class="h-1.5 bg-surface-700 rounded-full cursor-pointer" onclick={seek}>
								<div class="h-full bg-primary-500 rounded-full transition-none" style="width: {duration ? (currentTime / duration) * 100 : 0}%"></div>
							</div>
							<div class="flex justify-between text-xs text-surface-500 mt-1.5">
								<span>{fmt(currentTime)}</span>
								<span>{fmt(duration)}</span>
							</div>
						</div>

						<!-- Controls: repeat | prev | play/pause | next -->
						<div class="flex items-center justify-center gap-6 px-8 pb-10 shrink-0">
							<!-- Repeat toggle -->
							<button
								onclick={cycleRepeat}
								class="transition-colors {$repeatMode ? 'text-primary-400' : 'text-surface-600 hover:text-surface-400'}"
								aria-label="Repeat: {$repeatMode ?? 'off'}"
							>
								{#if $repeatMode === 'song'}
									<!-- Repeat one -->
									<svg class="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
										<path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
										<text x="12" y="14" text-anchor="middle" font-size="6" fill="currentColor">1</text>
									</svg>
								{:else}
									<!-- Repeat all -->
									<svg class="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
										<path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
									</svg>
								{/if}
							</button>

							<button onclick={skipPrev} disabled={!hasPrev} class="text-surface-300 hover:text-surface-50 disabled:opacity-30 transition-colors" aria-label="Previous">
								<svg class="w-8 h-8" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
							</button>

							<button onclick={togglePlay}
								class="w-16 h-16 rounded-full bg-primary-500 hover:bg-primary-400 flex items-center justify-center text-white transition-colors shadow-lg"
								aria-label={playing ? 'Pause' : 'Play'}
							>
								{#if $player.loading}
									<span class="animate-pulse text-2xl">…</span>
								{:else if playing}
									<svg class="w-7 h-7" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
								{:else}
									<svg class="w-7 h-7" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
								{/if}
							</button>

							<button onclick={skipNext} disabled={!hasNext} class="text-surface-300 hover:text-surface-50 disabled:opacity-30 transition-colors" aria-label="Next">
								<svg class="w-8 h-8" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zm2.5-6l5.5 3.9V8.1L8.5 12zM16 6v12h2V6h-2z"/></svg>
							</button>

							<!-- Download current song -->
							<button
								onclick={downloadCurrent}
								disabled={downloadingCurrent}
								class="transition-colors {downloadingCurrent ? 'text-surface-500 animate-pulse' : $offlineIds.has($player.song.id) ? 'text-primary-400' : 'text-surface-600 hover:text-surface-400'}"
								aria-label={$offlineIds.has($player.song.id) ? 'Downloaded' : 'Download'}
							>
								{#if $offlineIds.has($player.song.id)}
									<svg class="w-6 h-6" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>
								{:else}
									<svg class="w-6 h-6" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zm-8 2V5h2v6h1.17L12 13.17 9.83 11H11zm-6 7h14v2H5v-2z"/></svg>
								{/if}
							</button>
						</div>
					</div>
				{/if}
			</div>

			<!-- Bottom nav (mobile) -->
			<nav class="md:hidden shrink-0 bg-surface-800 border-t border-surface-700 flex">
				{#each navItems as item}
					<a href={item.href}
						onclick={(e) => { e.preventDefault(); gotoTab(item.href); }}
						class="flex-1 flex flex-col items-center py-2 gap-1 text-xs transition-colors
							{$page.url.pathname === item.href ? 'text-primary-400' : 'text-surface-400'}"
					>
						<span class="text-lg leading-none">{item.icon}</span>
						{item.label}
					</a>
				{/each}
				{#if $session.user.is_admin}
					<a href="/admin"
						class="flex-1 flex flex-col items-center py-2 gap-1 text-xs transition-colors
							{$page.url.pathname === '/admin' ? 'text-primary-400' : 'text-surface-400'}"
					><span class="text-lg leading-none">⚙</span>Admin</a>
				{/if}
				<button onclick={() => settingsOpen = true}
					class="flex-1 flex flex-col items-center py-2 gap-1 text-xs text-surface-400 hover:text-surface-200 transition-colors"
				><span class="text-lg leading-none">≡</span>Settings</button>
			</nav>
		</div>
	</div>

	<!-- Settings panel -->
	{#if settingsOpen}
		<button class="fixed inset-0 bg-black/50 z-40" onclick={() => settingsOpen = false} aria-label="Close settings"></button>
		<div class="fixed bottom-0 left-0 right-0 md:bottom-auto md:top-0 md:right-0 md:left-auto md:h-full md:w-80 bg-surface-800 border-t md:border-t-0 md:border-l border-surface-700 z-50 flex flex-col rounded-t-2xl md:rounded-none shadow-2xl">
			<div class="flex items-center justify-between p-5 border-b border-surface-700">
				<h2 class="text-lg font-semibold text-surface-50">Settings</h2>
				<button onclick={() => settingsOpen = false} class="text-surface-400 hover:text-surface-200 transition-colors text-xl leading-none">✕</button>
			</div>

			<div class="flex-1 p-5 space-y-2 overflow-y-auto">
				<p class="text-xs font-medium text-surface-500 uppercase tracking-wide pb-1">Playback</p>

				{#snippet toggle(label: string, desc: string, key: 'dataSaver' | 'extremeDataSaver' | 'playRelated')}
					<button onclick={() => settings.toggle(key)}
						class="w-full flex items-center justify-between p-4 rounded-xl bg-surface-700 hover:bg-surface-600 transition-colors text-left"
					>
						<div>
							<div class="text-sm font-medium text-surface-100">{label}</div>
							<div class="text-xs text-surface-400 mt-0.5">{desc}</div>
						</div>
						<div class="w-11 h-6 rounded-full transition-colors shrink-0 {$settings[key] ? 'bg-primary-500' : 'bg-surface-500'} relative ml-4">
							<div class="absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all {$settings[key] ? 'left-6' : 'left-1'}"></div>
						</div>
					</button>
				{/snippet}

				{@render toggle('Play related songs', 'After the queue ends, continue with songs from the same artist or album', 'playRelated')}
				{@render toggle('Data saver', 'Streams low-quality album art (200px)', 'dataSaver')}
				{@render toggle('Extreme data saver', 'No album art downloaded at all', 'extremeDataSaver')}

				{#if $settings.dataSaver || $settings.extremeDataSaver}
					<p class="text-xs text-surface-500 px-1">Takes effect on next play.</p>
				{/if}

				{#if $player}
					<div class="pt-2">
						<p class="text-xs font-medium text-surface-500 uppercase tracking-wide pb-2">Now playing</p>
						<button
							onclick={startRelated}
							class="w-full flex items-center gap-3 p-4 rounded-xl bg-surface-700 hover:bg-surface-600 transition-colors text-left"
						>
							<svg class="w-5 h-5 text-primary-400 shrink-0" viewBox="0 0 24 24" fill="currentColor">
								<path d="M12 3a9 9 0 100 18A9 9 0 0012 3zm-1 14v-8l5 4-5 4z"/>
							</svg>
							<div>
								<div class="text-sm font-medium text-surface-100">Play related songs now</div>
								<div class="text-xs text-surface-400 mt-0.5">Jump to songs from the same artist or album</div>
							</div>
						</button>
					</div>
				{/if}
			</div>

			<div class="p-5 border-t border-surface-700 space-y-3">
				{#if $offlineIds.size > 0}
					<button onclick={clearDownloads}
						class="w-full py-3 rounded-xl bg-surface-700 hover:bg-error-500/20 text-surface-300 hover:text-error-400 text-sm font-medium transition-colors"
					>Clear downloads ({$offlineIds.size} {$offlineIds.size === 1 ? 'song' : 'songs'})</button>
				{/if}
				{#if !isStandalone}
					<button onclick={installApp}
						class="w-full py-3 rounded-xl bg-primary-500 hover:bg-primary-400 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
					>
						<svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
							<path d="M19 9h-4V3H9v6H5l7 7 7-7zm-8 2V5h2v6h1.17L12 13.17 9.83 11H11zm-6 7h14v2H5v-2z"/>
						</svg>
						Install app
					</button>
				{/if}
				<div class="text-xs text-surface-500 truncate">Signed in as {$session.user.username}</div>
				<button onclick={() => { session.logout(); settingsOpen = false; goto('/login'); }}
					class="w-full py-3 rounded-xl bg-surface-700 hover:bg-error-500/20 text-surface-300 hover:text-error-400 text-sm font-medium transition-colors"
				>Logout</button>
			</div>
		</div>
	{/if}
{/if}
