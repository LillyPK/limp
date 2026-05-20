<script lang="ts">
	import { onMount } from 'svelte';
	import { session } from '$lib/session';
	import { goto } from '$app/navigation';
	import {
		adminListSongs, adminDeleteSong, adminUploadSong,
		adminListUsers, adminCreateUser, adminDeleteUser,
		listAlbums, adminCreateAlbum, adminDeleteAlbum,
		addSongToPlaylist, removeSongFromPlaylist, getPlaylistSongs,
		type Song, type User, type Playlist
	} from '$lib/api';

	let tab = $state<'upload' | 'songs' | 'users' | 'albums'>('upload');

	let songs = $state<Song[]>([]);
	let users = $state<User[]>([]);
	let albums = $state<Playlist[]>([]);
	let loading = $state(true);
	let error = $state('');

	// Upload
	let uploadTitle = $state('');
	let uploadAlbum = $state('');
	let uploadArtist = $state('');
	let songFile = $state<File | null>(null);
	let artFile = $state<File | null>(null);
	let uploading = $state(false);
	let uploadSuccess = $state('');

	// Users
	let newUsername = $state('');
	let newIsAdmin = $state(false);

	// Albums
	let newAlbumName = $state('');
	let albumSongs = $state<Record<number, Song[]>>({});

	onMount(async () => {
		if (!$session?.user.is_admin) { goto('/'); return; }
		try {
			[songs, users, albums] = await Promise.all([
				adminListSongs($session),
				adminListUsers($session),
				listAlbums($session)
			]);
		} catch (e) { error = String(e); }
		finally { loading = false; }
	});

	async function upload(e: SubmitEvent) {
		e.preventDefault();
		if (!$session || !songFile) return;
		uploading = true; error = ''; uploadSuccess = '';
		try {
			const song = await adminUploadSong(uploadTitle, uploadAlbum, uploadArtist, songFile, artFile, $session);
			songs = [...songs, song];
			uploadTitle = ''; uploadAlbum = ''; uploadArtist = ''; songFile = null; artFile = null;
			uploadSuccess = `"${song.title}" uploaded`;
		} catch (e) { error = String(e); }
		finally { uploading = false; }
	}

	async function deleteSong(song: Song) {
		if (!$session || !confirm(`Delete "${song.title}"?`)) return;
		await adminDeleteSong(song.id, $session);
		songs = songs.filter(s => s.id !== song.id);
	}

	async function createUser(e: SubmitEvent) {
		e.preventDefault();
		if (!$session || !newUsername.trim()) return;
		const user = await adminCreateUser(newUsername.trim(), newIsAdmin, $session);
		users = [...users, user];
		newUsername = ''; newIsAdmin = false;
	}

	async function createAlbum(e: SubmitEvent) {
		e.preventDefault();
		if (!$session || !newAlbumName.trim()) return;
		const album = await adminCreateAlbum(newAlbumName.trim(), $session);
		albums = [...albums, album];
		newAlbumName = '';
	}

	async function loadAlbumSongs(albumId: number) {
		if (!$session || albumSongs[albumId]) return;
		albumSongs[albumId] = await getPlaylistSongs(albumId, $session);
	}

	async function toggleSongInAlbum(albumId: number, songId: number) {
		if (!$session) return;
		const inAlbum = albumSongs[albumId]?.some(s => s.id === songId);
		if (inAlbum) await removeSongFromPlaylist(albumId, songId, $session);
		else await addSongToPlaylist(albumId, songId, $session);
		albumSongs[albumId] = await getPlaylistSongs(albumId, $session);
	}

	async function deleteUser(user: User) {
		if (!$session || !confirm(`Delete user "${user.username}"?`)) return;
		await adminDeleteUser(user.id, $session);
		users = users.filter(u => u.id !== user.id);
	}

	async function deleteAlbum(album: Playlist) {
		if (!$session || !confirm(`Delete album "${album.name}"?`)) return;
		await adminDeleteAlbum(album.id, $session);
		albums = albums.filter(a => a.id !== album.id);
	}

	// Minimal ID3v2 reader: extracts TIT2, TPE1, TALB text frames and APIC picture frame
	async function readMP3Meta(file: File): Promise<{
		title?: string; artist?: string; album?: string;
		image?: { data: Uint8Array; format: string }
	}> {
		const raw = new Uint8Array(await file.arrayBuffer());
		if (raw.length < 10 || String.fromCharCode(...raw.slice(0, 3)) !== 'ID3') return {};

		const ver = raw[3];
		const size = (raw[6] << 21) | (raw[7] << 14) | (raw[8] << 7) | raw[9]; // synchsafe
		const end = 10 + size;
		let off = 10;
		const result: Record<string, string> = {};
		let image: { data: Uint8Array; format: string } | undefined;

		while (off + 10 <= end && off + 10 <= raw.length) {
			const fid = String.fromCharCode(...raw.slice(off, off + 4));
			if (fid === '\0\0\0\0') break;
			const fsize = ver >= 4
				? (raw[off + 4] << 21) | (raw[off + 5] << 14) | (raw[off + 6] << 7) | raw[off + 7]
				: (raw[off + 4] << 24) | (raw[off + 5] << 16) | (raw[off + 6] << 8) | raw[off + 7];
			off += 10;
			if (fsize <= 0 || off + fsize > raw.length) break;
			const fdata = raw.slice(off, off + fsize);

			if (fid === 'TIT2' || fid === 'TPE1' || fid === 'TALB') {
				if (fdata.length > 1) {
					const enc = fdata[0];
					let endIdx = fdata.length;
					if (enc === 0) {
						const nl = fdata.indexOf(0, 1);
						if (nl > 0) endIdx = nl;
						result[fid] = new TextDecoder('latin1').decode(fdata.slice(1, endIdx));
					} else if (enc === 3) {
						const nl = fdata.indexOf(0, 1);
						if (nl > 0) endIdx = nl;
						result[fid] = new TextDecoder('utf-8').decode(fdata.slice(1, endIdx));
					} else {
						result[fid] = new TextDecoder('utf-16be').decode(fdata.slice(1));
						const n = result[fid].indexOf('\0');
						if (n >= 0) result[fid] = result[fid].slice(0, n);
					}
				}
			} else if (fid === 'APIC' && !image && fdata.length > 4) {
				const enc = fdata[0];
				let p = 1;
				let mimeEnd = p;
				while (mimeEnd < fdata.length && fdata[mimeEnd] !== 0) mimeEnd++;
				const mime = new TextDecoder().decode(fdata.slice(p, mimeEnd));
				p = mimeEnd + 2; // skip null + picture type byte
				let descEnd = p;
				if (enc === 0) while (descEnd < fdata.length && fdata[descEnd] !== 0) descEnd++;
				else while (descEnd < fdata.length - 1 && (fdata[descEnd] !== 0 || fdata[descEnd + 1] !== 0)) descEnd += 2;
				p = descEnd + (enc === 0 ? 1 : 2);
				if (p < fdata.length) {
					image = { data: fdata.slice(p), format: mime };
				}
			}

			off += fsize;
		}

		return {
			title: result.TIT2?.trim(),
			artist: result.TPE1?.trim(),
			album: result.TALB?.trim(),
			image
		};
	}

	async function onSongInput(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0] ?? null;
		songFile = file;
		if (!file) return;
		try {
			const meta = await readMP3Meta(file);
			if (meta.title && !uploadTitle) uploadTitle = meta.title;
			if (meta.artist && !uploadArtist) uploadArtist = meta.artist;
			if (meta.album && !uploadAlbum) uploadAlbum = meta.album;
			if (meta.image) {
				const ext = meta.image.format.split('/')[1] || 'jpg';
				artFile = new File([meta.image.data], `cover.${ext}`, { type: meta.image.format });
			}
		} catch { /* ignore read errors */ }
	}
</script>

<div class="p-4 md:p-6 space-y-5 max-w-2xl mx-auto">
	<h1 class="text-2xl font-bold text-surface-50">Admin</h1>

	<!-- Tabs -->
	<div class="flex gap-1 bg-surface-800 rounded-xl p-1">
		{#each [['upload','Upload'],['songs','Songs'],['users','Users'],['albums','Albums']] as [id, label]}
			<button
				onclick={() => tab = id as typeof tab}
				class="flex-1 py-2 text-sm font-medium rounded-lg transition-colors
					{tab === id ? 'bg-surface-600 text-surface-50' : 'text-surface-400 hover:text-surface-300'}"
			>{label}</button>
		{/each}
	</div>

	{#if loading}
		<div class="space-y-3">
			{#each { length: 3 } as _}
				<div class="h-14 bg-surface-800 rounded-xl animate-pulse"></div>
			{/each}
		</div>
	{:else}

		{#if tab === 'upload'}
			<form onsubmit={upload} class="bg-surface-800 rounded-2xl p-5 space-y-4">
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
					<label class="space-y-1.5">
						<span class="text-xs font-medium text-surface-400 uppercase tracking-wide">Title *</span>
						<input type="text" bind:value={uploadTitle} required class="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2.5 text-sm text-surface-50 focus:outline-none focus:border-primary-500" />
					</label>
					<label class="space-y-1.5">
						<span class="text-xs font-medium text-surface-400 uppercase tracking-wide">Artist</span>
						<input type="text" bind:value={uploadArtist} class="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2.5 text-sm text-surface-50 focus:outline-none focus:border-primary-500" />
					</label>
					<label class="space-y-1.5 sm:col-span-2">
						<span class="text-xs font-medium text-surface-400 uppercase tracking-wide">Album</span>
						<input type="text" bind:value={uploadAlbum} class="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2.5 text-sm text-surface-50 focus:outline-none focus:border-primary-500" />
					</label>
				</div>

				<div class="space-y-3">
					<label class="space-y-1.5 block">
						<span class="text-xs font-medium text-surface-400 uppercase tracking-wide">Song file *</span>
						<input
							type="file"
							accept="audio/*"
							onchange={onSongInput}
							required
							class="w-full text-sm text-surface-400 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-primary-500/20 file:text-primary-400 hover:file:bg-primary-500/30"
						/>
					</label>
					<label class="space-y-1.5 block">
						<span class="text-xs font-medium text-surface-400 uppercase tracking-wide">Album art</span>
						<input
							type="file"
							accept="image/*"
							onchange={(e) => artFile = (e.target as HTMLInputElement).files?.[0] ?? null}
							class="w-full text-sm text-surface-400 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-surface-600 file:text-surface-300 hover:file:bg-surface-500"
						/>
					</label>
				</div>

				{#if error}<p class="text-error-400 text-sm">{error}</p>{/if}
				{#if uploadSuccess}<p class="text-success-400 text-sm">✓ {uploadSuccess}</p>{/if}

				<button
					type="submit"
					disabled={uploading}
					class="w-full py-3 bg-primary-500 hover:bg-primary-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors"
				>
					{uploading ? 'Uploading…' : 'Upload'}
				</button>
			</form>
		{/if}

		{#if tab === 'songs'}
			<div class="space-y-2">
				{#if songs.length === 0}
					<p class="text-surface-500 text-sm text-center py-8">No songs yet</p>
				{:else}
					{#each songs as song (song.id)}
						<div class="flex items-center gap-3 p-3 bg-surface-800 rounded-xl">
							<div class="flex-1 min-w-0">
								<div class="text-sm font-medium text-surface-50 truncate">{song.title}</div>
								<div class="text-xs text-surface-400 truncate">{song.artist}{song.album ? ` · ${song.album}` : ''}</div>
							</div>
							<button onclick={() => deleteSong(song)} class="text-surface-500 hover:text-error-400 transition-colors text-sm px-2">✕</button>
						</div>
					{/each}
				{/if}
			</div>
		{/if}

		{#if tab === 'users'}
			<div class="space-y-4">
				<form onsubmit={createUser} class="bg-surface-800 rounded-2xl p-4 space-y-3">
					<h3 class="text-sm font-semibold text-surface-200">Create user</h3>
					<input
						type="text"
						placeholder="Username"
						bind:value={newUsername}
						required
						class="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2.5 text-sm text-surface-50 focus:outline-none focus:border-primary-500"
					/>
					<label class="flex items-center gap-2 text-sm text-surface-300 cursor-pointer">
						<input type="checkbox" bind:checked={newIsAdmin} class="rounded" />
						Admin
					</label>
					<button type="submit" class="w-full py-2.5 bg-primary-500 hover:bg-primary-400 text-white text-sm font-medium rounded-lg transition-colors">Create</button>
				</form>

				<ul class="space-y-2">
					{#each users as user (user.id)}
						<div class="flex items-center gap-3 p-3 bg-surface-800 rounded-xl">
							<div class="w-8 h-8 rounded-full bg-surface-600 flex items-center justify-center text-surface-300 text-sm shrink-0">
								{user.username[0].toUpperCase()}
							</div>
							<span class="flex-1 text-sm text-surface-200">{user.username}</span>
							{#if user.is_admin}
								<span class="text-xs px-2 py-0.5 rounded-full bg-primary-500/20 text-primary-400">admin</span>
							{/if}
							<button onclick={() => deleteUser(user)} class="text-surface-500 hover:text-error-400 transition-colors text-sm px-1 shrink-0">✕</button>
						</div>
					{/each}
				</ul>
			</div>
		{/if}

		{#if tab === 'albums'}
			<div class="space-y-4">
				<form onsubmit={createAlbum} class="flex gap-2">
					<input
						type="text"
						placeholder="New album name…"
						bind:value={newAlbumName}
						required
						class="flex-1 min-w-0 bg-surface-700 border border-surface-600 rounded-lg px-3 py-2.5 text-sm text-surface-50 focus:outline-none focus:border-primary-500"
					/>
					<button type="submit" class="px-4 py-2.5 bg-primary-500 hover:bg-primary-400 text-white text-sm font-medium rounded-lg transition-colors">Create</button>
				</form>

				<div class="space-y-3">
					{#each albums as album (album.id)}
						<details
							class="bg-surface-800 rounded-2xl overflow-hidden"
							ontoggle={(e) => { if ((e.target as HTMLDetailsElement).open) loadAlbumSongs(album.id); }}
						>
							<summary class="px-4 py-3 cursor-pointer text-sm font-medium text-surface-200 hover:text-surface-50 transition-colors list-none flex items-center justify-between">
								{album.name}
								<div class="flex items-center gap-2">
									<button onclick={(e) => { e.stopPropagation(); deleteAlbum(album); }} class="text-surface-500 hover:text-error-400 transition-colors text-sm px-1">✕</button>
									<span class="text-surface-500 text-xs">Manage ▾</span>
								</div>
							</summary>
							<div class="px-4 pb-3 space-y-1 border-t border-surface-700 pt-3 max-h-64 overflow-y-auto">
								{#each songs as song (song.id)}
									{@const inAlbum = albumSongs[album.id]?.some(s => s.id === song.id) ?? false}
									<div class="flex items-center gap-3 py-1.5">
										<span class="flex-1 text-sm text-surface-300 truncate">{song.title} <span class="text-surface-500">· {song.artist}</span></span>
										<button
											onclick={() => toggleSongInAlbum(album.id, song.id)}
											class="text-xs px-2 py-1 rounded transition-colors shrink-0
												{inAlbum ? 'bg-error-500/20 text-error-400 hover:bg-error-500/30' : 'bg-primary-500/20 text-primary-400 hover:bg-primary-500/30'}"
										>{inAlbum ? 'Remove' : 'Add'}</button>
									</div>
								{/each}
							</div>
						</details>
					{/each}
				</div>
			</div>
		{/if}

	{/if}
</div>
